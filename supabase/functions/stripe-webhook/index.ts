import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

// verifyJwt: false disables the platform JWT gate so Stripe webhooks (no Supabase JWT) can reach this handler.
// Stripe's own stripe-signature header is verified inside with stripe.webhooks.constructEventAsync.
export default Deno.serve({ verifyJwt: false }, async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, apikey",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set");
    return new Response(JSON.stringify({ error: "STRIPE_WEBHOOK_SECRET not set" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) {
    console.error("[stripe-webhook] Missing Stripe-Signature header");
    return new Response(JSON.stringify({ error: "Missing Stripe-Signature header" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;
  const stripe = new Stripe(stripeKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  // Must use .text() for raw body — Stripe signature verification depends on exact bytes
  const body = await req.text();
  console.log("[stripe-webhook] Body len:", body.length, "sig:", signature.slice(0, 20));

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature, webhookSecret, undefined, cryptoProvider
    );
  } catch (err: any) {
    console.error("[stripe-webhook] Signature verification FAILED:", err.message);
    return new Response(JSON.stringify({ error: `Webhook Error: ${err.message}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  console.log("[stripe-webhook] ✅ Verified event:", event.type, "id:", event.id);

  // Admin client — webhook is trusted internal code, bypasses RLS
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  switch (event.type) {

    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") break;

      const userId = session.metadata?.user_id;
      const email  = session.metadata?.email || session.customer_email;
      const plan   = session.metadata?.plan;
      const subId  = session.subscription as string | null;
      const slug   = session.metadata?.slug;
      const customerId = session.customer as string | null;

      // Always save stripe_customer_id immediately so customer.subscription.created
      // can find the profile later (subscription may not be attached yet at this point)
      const baseUpdate: any = { stripe_customer_id: customerId };
      if (userId) {
        await supabase.from("profiles").update(baseUpdate).eq("id", userId);
        console.log(`[stripe-webhook] Saved stripe_customer_id=${customerId} for userId=${userId}`);
      } else if (email) {
        await supabase.from("profiles").update(baseUpdate).eq("email", email);
        console.log(`[stripe-webhook] Saved stripe_customer_id=${customerId} for email=${email}`);
      }

      if (!subId) { console.log("[stripe-webhook] No subId yet — customer_id saved, will complete via customer.subscription.created"); break; }

      const sub = await stripe.subscriptions.retrieve(subId);
      const item = (sub as any).items?.data?.[0];
      const totalMonthly = (sub as any).items?.data?.reduce(
        (sum: number, i: any) => sum + (i.price?.unit_amount || 0), 0
      ) ?? item?.price?.unit_amount ?? 0;

      const profileUpdate = {
        stripe_subscription_id: subId,
        stripe_subscription_status: sub.status,
        stripe_subscription_plan: plan || null,
        stripe_subscription_amount: totalMonthly,
        stripe_subscription_interval: "month",
        stripe_subscription_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      };

      if (userId) {
        await supabase.from("profiles").update(profileUpdate).eq("id", userId);
        console.log(`[stripe-webhook] Profile updated for userId=${userId}`);
      } else if (email) {
        await supabase.from("profiles").update(profileUpdate).eq("email", email);
        console.log(`[stripe-webhook] Profile updated for email=${email}`);
      }

      // Trigger deploy if slug provided
      if (userId && slug) {
        console.log(`[stripe-webhook] Triggering deploy for slug=${slug}`);
        try {
          const deployRes = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-subscription`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ userId, slug }),
            }
          );
          const deployData = await deployRes.json();
          console.log(`[stripe-webhook] Deploy result:`, JSON.stringify(deployData));
        } catch (deployErr: any) {
          console.error(`[stripe-webhook] Deploy error: ${deployErr.message}`);
        }
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const totalMonthly = (sub as any).items?.data?.reduce(
        (sum: number, i: any) => sum + (i.price?.unit_amount || 0), 0
      ) ?? 0;
      await supabase.from("profiles").update({
        stripe_subscription_status: sub.status,
        stripe_subscription_id: sub.id,
        stripe_subscription_amount: totalMonthly,
        stripe_subscription_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      }).eq("stripe_customer_id", sub.customer as string);
      console.log(`[stripe-webhook] Subscription ${event.type} for customer=${sub.customer}, status=${sub.status}`);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await supabase.from("profiles").update({
        stripe_subscription_status: "cancelled",
        stripe_subscription_id: null,
      }).eq("stripe_customer_id", sub.customer as string);
      console.log(`[stripe-webhook] Subscription deleted`);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.subscription) {
        await supabase.from("profiles").update({
          stripe_subscription_status: "past_due",
        }).eq("stripe_customer_id", invoice.customer as string);
      }
      break;
    }

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.bookingId) {
        await supabase.from("bookings").update({
          status: "approved",
          payment_status: "paid",
          payment_completed_at: new Date().toISOString(),
        }).eq("stripe_payment_intent_id", pi.id);
      }
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.bookingId) {
        await supabase.from("bookings").update({
          payment_status: "failed",
        }).eq("stripe_payment_intent_id", pi.id);
      }
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const piId = charge.payment_intent as string;
      if (piId) {
        await supabase.from("bookings").update({
          payment_status: "refunded",
          stripe_refund_id: charge.refunds?.data[0]?.id || null,
        }).eq("stripe_payment_intent_id", piId);
      }
      break;
    }

    default:
      console.log(`[stripe-webhook] Unhandled: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
