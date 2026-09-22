import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

// Called when a host approves or denies a booking that used the auth-hold flow
// (create-payment-intent creates PaymentIntents with capture_method: "manual").
// - action "capture": charges the guest's already-authorized card (host approved).
// - action "cancel": releases the hold, guest is never charged (host denied, or a
//   hold is being abandoned). If the guest never got as far as authorizing a card
//   (no stripe_payment_intent_id yet, or the intent never reached requires_capture),
//   this is a no-op — the caller's own booking-status update still goes through.
//
// stripe-webhook's payment_intent.succeeded / payment_intent.canceled cases are the
// source of truth for payment_status; this function's own DB write is best-effort
// so the UI reflects the result immediately without waiting on the webhook round-trip.

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

    const { bookingId, action } = await req.json();
    if (!bookingId || !["capture", "cancel"].includes(action)) {
      throw new Error("Missing/invalid required parameters: bookingId and action ('capture'|'cancel')");
    }

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id, property_id, stripe_payment_intent_id, status")
      .eq("id", bookingId)
      .maybeSingle();
    if (bookingErr || !booking) throw new Error("Booking not found");

    const { data: property } = await supabase
      .from("properties")
      .select("owner_id")
      .eq("id", booking.property_id)
      .maybeSingle();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const isOwner = property?.owner_id === user.id;
    const isAdminRole = profile?.role === "admin" || profile?.role === "saas_admin";
    if (!isOwner && !isAdminRole) throw new Error("Forbidden: not this property's host");

    if (!booking.stripe_payment_intent_id) {
      // Nothing to capture/cancel yet (e.g. guest hasn't reached payment) — not an
      // error, the caller's own status update on the booking row still proceeds.
      return new Response(JSON.stringify({ skipped: true, reason: "no_payment_intent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const piId = booking.stripe_payment_intent_id;
    const pi = await stripe.paymentIntents.retrieve(piId);

    if (action === "capture") {
      if (pi.status === "succeeded") {
        return new Response(JSON.stringify({ success: true, status: pi.status, already: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (pi.status !== "requires_capture") {
        throw new Error(`Can't approve — guest hasn't completed payment authorization yet (payment status: ${pi.status})`);
      }
      const captured = await stripe.paymentIntents.capture(piId);
      // Best-effort immediate write; stripe-webhook's payment_intent.succeeded is the source of truth.
      await supabase.from("bookings").update({
        payment_status: "paid",
        payment_completed_at: new Date().toISOString(),
      }).eq("id", bookingId);
      return new Response(JSON.stringify({ success: true, status: captured.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // action === "cancel"
    if (pi.status === "canceled") {
      return new Response(JSON.stringify({ success: true, status: pi.status, already: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (pi.status === "succeeded") {
      throw new Error("Can't deny — this booking was already captured/charged. Use the refund action instead.");
    }
    const canceled = await stripe.paymentIntents.cancel(piId);
    await supabase.from("bookings").update({
      payment_status: "canceled",
    }).eq("id", bookingId);
    return new Response(JSON.stringify({ success: true, status: canceled.status }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("capture-booking-payment error:", error);
    return new Response(JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
