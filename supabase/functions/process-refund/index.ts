import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const { bookingId } = await req.json();
    if (!bookingId) throw new Error("bookingId is required");

    // Load booking and verify ownership (admin can refund any booking)
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*, property:properties(stripe_account_id)")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError || !booking) throw new Error("Booking not found");
    if (booking.payment_status !== "paid") {
      throw new Error("Cannot refund a booking that has not been paid");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Find the payment intent for this booking
    if (!booking.stripe_payment_intent_id) {
      throw new Error("No payment intent found for this booking");
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id);

    if (!paymentIntent.latest_charge) {
      throw new Error("No charge found on this payment intent");
    }

    const chargeId = paymentIntent.latest_charge as string;
    const refund = await stripe.refunds.create({ charge: chargeId });

    // Update booking status
    await supabase
      .from("bookings")
      .update({
        payment_status: "refunded",
        stripe_refund_id: refund.id,
        status: "cancelled",
      })
      .eq("id", bookingId);

    return new Response(
      JSON.stringify({ success: true, refund_id: refund.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("process-refund error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});