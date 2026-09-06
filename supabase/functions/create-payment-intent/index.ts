import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PLATFORM_FEE_PERCENT = 0.02; // 2% kept by platform

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not configured");

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { bookingId, amount, rentalAmount, propertyTitle, dates } = await req.json();
    if (!bookingId || !amount) throw new Error("Missing required parameters: bookingId and amount");

    // Load booking and verify ownership
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*, profiles(email, full_name)")
      .eq("id", bookingId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (bookingError || !booking) throw new Error("Booking not found or unauthorized");

    // Find the Stripe Connect account for this property
    const { data: property } = await supabase
      .from("properties")
      .select("id, stripe_account_id, stripe_account_status, title")
      .eq("id", booking.property_id)
      .maybeSingle();

    const connectedAccountId = property?.stripe_account_id;
    const amountInCents = Math.round(amount * 100);
    // Fee is calculated on the rental subtotal (before the 2% gross-up), so the
    // platform always receives exactly 2% of the base rental price.
    const baseRental = rentalAmount ?? booking.total_price;
    const platformFeeInCents = Math.round(baseRental * 100 * PLATFORM_FEE_PERCENT);

    // Build PaymentIntent params — if the property has a connected account,
    // route the payment through it so funds land directly in their balance.
    const intentParams: Stripe.PaymentIntentCreateParams = {
      amount: amountInCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        bookingId,
        userId: user.id,
        propertyId: booking.property_id,
        propertyTitle: propertyTitle || property?.title || "Property Rental",
        dates: dates || "",
        platformFee: platformFeeInCents.toString(),
        connectedAccountId: connectedAccountId || "",
      },
    };

    // Only add Connect routing when the account is set up and charges-enabled
    if (connectedAccountId && property?.stripe_account_status !== "pending") {
      intentParams.application_fee_amount = platformFeeInCents;
      intentParams.transfer_data = { destination: connectedAccountId };
    }

    const paymentIntent = await stripe.paymentIntents.create(intentParams);

    // Record intent on the booking row
    await supabase
      .from("bookings")
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        payment_status: "pending",
        amount_paid: amountInCents,
        payment_created_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-payment-intent error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
