import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

// David 2026-10-21: removed sendRequirementsEmail + its REQUIREMENT_LABELS map here --
// David: "I got x5 'Action needed' emails at every step of filling out the banking
// onboarding... Too many emails. Just make it one email and only when you get a
// booking." That's exactly the "IMPORTANT" email right below (fires once, only when an
// unverified property actually gets a held payment) -- this proactive nudge was a
// SEPARATE email that fired on every account.updated during onboarding. It had its own
// dedup guard (only re-sent when the past_due SET changed), but during active onboarding
// that set changes at every single step, so the guard didn't stop the spam -- it just
// meant every step got its own, allegedly-deduped email. Removed outright rather than
// re-tuned, per David's ask to only email on a booking. account.updated's job here is now
// just syncing stripe_account_status (see the case below) -- no email of its own.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");


// David 2026-10-20: "IMPORTANT" email -- nudges an unverified host the moment
// their first real held payment shows up, since that's the exact point where
// "verify or risk losing this payment" becomes literally true (an unverified
// property's charges never route through Connect -- see create-payment-intent
// -- so there is no payout to lose until a real hold exists). Fires once ever
// per property via properties.unverified_booking_notice_sent -- the goal is
// to get them to verify, not to spam them on every booking.
async function sendUnverifiedHostBookingEmail(to: string, hostName: string | null, propertyTitle: string, slug: string) {
  if (!RESEND_API_KEY || !to) return;
  const greeting = hostName?.trim() || "there";
  const propertyUrl = `https://propbook.pro/props/${slug}`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: "Surf House Baja <hello@updates.mollisondavid.com>",
        to: [to],
        subject: `IMPORTANT: Verify your account to receive this booking's payment`,
        html: `
          <h1>Hi ${greeting},</h1>
          <p>You just received a new booking request for <strong>${propertyTitle}</strong>.</p>
          <p>Before you can accept it and actually get paid, Stripe needs you to verify your account (a quick ID upload) -- this is required to receive payouts.</p>
          <p><a href="${propertyUrl}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Verify your account now</a></p>
          <p>Sign in, open your Profile, go to the Banking section, and click "Complete Account Setup."</p>
          <p style="margin-top:20px;padding:12px;background:#fff4f4;border:1px solid #f3c6c6;border-radius:6px;font-size:0.9em;color:#7a1f1f;">
            <strong>Please read:</strong> if you accept this booking before verifying your account, the payment cannot be transferred to you and you could lose it. Verify first, then accept.
          </p>
          <p>- The ${propertyTitle} Team</p>
        `,
      }),
    });
    if (!response.ok) console.error("[stripe-webhook] unverified-host booking email failed:", await response.text());
  } catch (err) {
    console.error("[stripe-webhook] unverified-host booking email error:", err);
  }
}

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

  // David 2026-10-20: added a SECOND Stripe webhook destination ("exquisite-
  // euphoria") scoped to "Connected accounts" so account.updated events for
  // a HOST's connected account (e.g. ravenswortha14 finishing ID
  // verification) actually get delivered here -- the original destination
  // is scoped to "Your account" only, which silently never receives
  // connected-account events no matter which event types are checked on it.
  // Stripe gives each destination its OWN signing secret, so this function
  // now has to be willing to verify against either one.
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
  const webhookSecretConnect = Deno.env.get("STRIPE_WEBHOOK_SECRET_CONNECT");
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
  } catch (firstErr: any) {
    // Didn't match the main destination's secret -- try the Connect
    // destination's secret before giving up, rather than assuming this
    // request is invalid/forged.
    if (webhookSecretConnect) {
      try {
        event = await stripe.webhooks.constructEventAsync(
          body, signature, webhookSecretConnect, undefined, cryptoProvider
        );
      } catch (secondErr: any) {
        console.error("[stripe-webhook] Signature verification FAILED (tried both secrets):", secondErr.message);
        return new Response(JSON.stringify({ error: `Webhook Error: ${secondErr.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      console.error("[stripe-webhook] Signature verification FAILED:", firstErr.message);
      return new Response(JSON.stringify({ error: `Webhook Error: ${firstErr.message}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
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

      // David: removed the old "trigger deploy" fetch to stripe-subscription here -- it
      // called into a dead code path (renderPropertyHtml, several undeclared variables,
      // always threw) that was silently swallowed by this try/catch and did nothing. The
      // real site-creation flow is GetSite.tsx -> save-site-records, unrelated to this
      // webhook. Confirmed dead, deleted rather than fixed (2026-09-21).
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

    // Fires once the guest's card is successfully authorized under the
    // auth-hold flow (create-payment-intent's capture_method: "manual") --
    // the hold is in place but no money has moved yet. Sets payment_status
    // to "authorized" so AdminSidebarBundle's "Card Held" badge (built
    // 2026-10-18, unused until now) shows a booking actually has a card on
    // file, instead of looking identical to one where the guest never
    // finished payment. Guarded to only move pending -> authorized so a
    // stray redelivery can't clobber a later paid/canceled/refunded state.
    case "payment_intent.amount_capturable_updated": {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.bookingId) {
        await supabase.from("bookings").update({
          payment_status: "authorized",
        }).eq("stripe_payment_intent_id", pi.id).eq("payment_status", "pending");
        console.log(`[stripe-webhook] payment_intent.amount_capturable_updated for bookingId=${pi.metadata.bookingId} -- card held`);

        const { data: heldBooking } = await supabase
          .from("bookings")
          .select("property_id")
          .eq("id", pi.metadata.bookingId)
          .maybeSingle();

        if (heldBooking?.property_id) {
          const { data: property } = await supabase
            .from("properties")
            .select("id, slug, title, owner_id, stripe_account_id, stripe_account_status, unverified_booking_notice_sent")
            .eq("id", heldBooking.property_id)
            .maybeSingle();

          if (property && !property.unverified_booking_notice_sent) {
            // David 2026-10-20: "I had already verified my account as we
            // discussed and got an email to update my banking info anyway.
            // I think that is because our database isn't updated... that's
            // a good reason to check the status before sending the email."
            // properties.stripe_account_status is only updated when Stripe's
            // account.updated webhook fires (see that case below) -- there
            // can be a lag, or a delivery can be missed. So check Stripe
            // directly here rather than trusting the possibly-stale DB
            // column, and self-heal the column either way while we're at it.
            let liveStatus = property.stripe_account_status;
            if (property.stripe_account_id) {
              try {
                const account = await stripe.accounts.retrieve(property.stripe_account_id);
                liveStatus = (account.charges_enabled && account.payouts_enabled) ? "active" : "pending";
                if (liveStatus !== property.stripe_account_status) {
                  await supabase.from("properties").update({ stripe_account_status: liveStatus }).eq("id", property.id);
                  await supabase.from("profiles").update({ stripe_account_status: liveStatus }).eq("stripe_account_id", property.stripe_account_id);
                  console.log(`[stripe-webhook] self-healed stale stripe_account_status for property ${property.id}: ${property.stripe_account_status} -> ${liveStatus}`);
                }
              } catch (err) {
                console.error("[stripe-webhook] failed to retrieve live Stripe account status, falling back to DB value:", err);
              }
            }

            if (liveStatus !== "active") {
              const { data: owner } = await supabase
                .from("profiles")
                .select("email, full_name")
                .eq("id", property.owner_id)
                .maybeSingle();
              if (owner?.email) {
                await sendUnverifiedHostBookingEmail(owner.email, owner.full_name, property.title || "your property", property.slug);
              }
              await supabase.from("properties").update({ unverified_booking_notice_sent: true }).eq("id", property.id);
            }
          }
        }
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

    // Auth-hold flow (capture_method: "manual"): fires when a hold is released --
    // either the host explicitly denied via capture-booking-payment (action: "cancel"),
    // or Stripe auto-released an authorization nobody acted on within its validity
    // window (~7 days for most cards). Only downgrades status away from "approved" if
    // it hadn't already been captured/approved through some other path, so this can't
    // clobber a booking that was separately approved and later legitimately refunded.
    case "payment_intent.canceled": {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.bookingId) {
        await supabase.from("bookings").update({
          payment_status: "canceled",
        }).eq("stripe_payment_intent_id", pi.id).neq("status", "approved");
        console.log(`[stripe-webhook] payment_intent.canceled for bookingId=${pi.metadata.bookingId} -- hold released`);
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

    // Keeps properties.stripe_account_status (and profiles.stripe_account_status) in sync
    // with the connected account's real Stripe status. Without this, stripe_account_status
    // is set to "pending" once at account creation (see stripe-connect/index.ts) and never
    // updated again — which means create-payment-intent's Connect-routing check
    // (`stripe_account_status !== "pending"`) never becomes true, so application_fee_amount /
    // transfer_data.destination never get applied even after a host finishes onboarding.
    // NOTE: this event must also be added to the webhook's selected events in the Stripe
    // Dashboard (Developers -> Webhooks) — this code change alone does not do that.
    case "account.updated": {
      // David 2026-10-21: this case used to also email the host every time Stripe's
      // past_due requirements list changed -- removed (see the comment up top near
      // RESEND_API_KEY). Just syncs stripe_account_status now, same as the one-time
      // backfill script (sync-stripe-account-statuses) and the self-heal in
      // payment_intent.amount_capturable_updated below use for the exact same check.
      const account = event.data.object as Stripe.Account;
      const status = (account.charges_enabled && account.payouts_enabled) ? "active" : "pending";
      await supabase.from("properties").update({ stripe_account_status: status }).eq("stripe_account_id", account.id);
      await supabase.from("profiles").update({ stripe_account_status: status }).eq("stripe_account_id", account.id);
      console.log(`[stripe-webhook] account.updated ${account.id}: charges_enabled=${account.charges_enabled}, payouts_enabled=${account.payouts_enabled}, status=${status}`);
      break;
    }

    default:
      console.log(`[stripe-webhook] Unhandled: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
