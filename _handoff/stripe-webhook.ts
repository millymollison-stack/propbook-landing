import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

// David 2026-10-20: "automate pass along" -- surfaces Stripe's own outstanding
// Connect requirements (the "Provide an identity document" style asks) as an
// email to the host, instead of David having to notice them in the Stripe
// Dashboard and hand-generate a remediation link himself. Mirrors the
// friendly-label map in src/components/StripeConnectSetup.tsx (duplicated,
// not shared -- different runtimes, and it's a short list) so the email and
// the in-app UI describe the same requirement the same way.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const REQUIREMENT_LABELS: Record<string, string> = {
  "individual.verification.document": "A photo ID (driver's license, passport, or state ID)",
  "individual.verification.additional_document": "A second form of ID",
  "individual.id_number": "Your SSN or ID number",
  "individual.dob.day": "Your date of birth",
  "individual.dob.month": "Your date of birth",
  "individual.dob.year": "Your date of birth",
  "individual.address.line1": "Your home address",
  "individual.address.city": "Your home address",
  "individual.address.state": "Your home address",
  "individual.address.postal_code": "Your home address",
  "individual.phone": "Your phone number",
  "individual.email": "Your email address",
  "individual.first_name": "Your legal first name",
  "individual.last_name": "Your legal last name",
  "external_account": "A bank account to receive payouts",
  "tos_acceptance.date": "Accepting Stripe's terms of service",
  "business_profile.url": "A website or description of your rental business",
  "business_profile.mcc": "Your business category",
  "company.tax_id": "Your business tax ID (EIN)",
  "company.verification.document": "A business verification document",
};

function friendlyRequirement(code: string): string {
  if (REQUIREMENT_LABELS[code]) return REQUIREMENT_LABELS[code];
  // Fallback: humanize an unmapped code (e.g. "company.owners_provided" -> "Company owners provided")
  const last = code.split(".").pop() || code;
  const words = last.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function sendRequirementsEmail(to: string, hostName: string | null, propertyTitle: string, pastDue: string[]) {
  if (!RESEND_API_KEY || !to || pastDue.length === 0) return;
  const greeting = hostName?.trim() || "there";
  const items = [...new Set(pastDue.map(friendlyRequirement))];
  const listHtml = items.map(i => `<li>${i}</li>`).join("");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: "Surf House Baja <hello@updates.mollisondavid.com>",
        to: [to],
        subject: `Action needed to receive payouts for ${propertyTitle}`,
        html: `
          <h1>Hi ${greeting},</h1>
          <p>Stripe needs a bit more information before <strong>${propertyTitle}</strong> can receive booking payouts:</p>
          <ul>${listHtml}</ul>
          <p>Head back to your property's Banking section and click "Complete Account Setup" to finish this -- it only asks for what's listed above.</p>
          <p>- The ${propertyTitle} Team</p>
        `,
      }),
    });
    if (!response.ok) console.error("[stripe-webhook] requirements email failed:", await response.text());
  } catch (err) {
    console.error("[stripe-webhook] requirements email error:", err);
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
      const account = event.data.object as Stripe.Account;
      const status = (account.charges_enabled && account.payouts_enabled) ? "active" : "pending";
      await supabase.from("properties").update({ stripe_account_status: status }).eq("stripe_account_id", account.id);
      await supabase.from("profiles").update({ stripe_account_status: status }).eq("stripe_account_id", account.id);
      console.log(`[stripe-webhook] account.updated ${account.id}: charges_enabled=${account.charges_enabled}, payouts_enabled=${account.payouts_enabled}, status=${status}`);

      // David 2026-10-20: "automate pass along" -- only email when the set of
      // past_due items actually CHANGES (not on every account.updated, which
      // Stripe fires for all sorts of minor account changes -- would spam the
      // host otherwise). stripe_requirements_notified on the property row
      // remembers what was last emailed about.
      const pastDue = account.requirements?.past_due || [];
      const { data: property } = await supabase
        .from("properties")
        .select("id, title, owner_id, stripe_requirements_notified")
        .eq("stripe_account_id", account.id)
        .maybeSingle();

      if (property) {
        const previouslyNotified: string[] = property.stripe_requirements_notified || [];
        const isNewSet = pastDue.length > 0 &&
          (pastDue.length !== previouslyNotified.length || pastDue.some((r: string) => !previouslyNotified.includes(r)));

        if (isNewSet) {
          const { data: owner } = await supabase
            .from("profiles")
            .select("email, full_name")
            .eq("id", property.owner_id)
            .maybeSingle();
          if (owner?.email) {
            await sendRequirementsEmail(owner.email, owner.full_name, property.title || "your property", pastDue);
          }
          await supabase.from("properties").update({ stripe_requirements_notified: pastDue }).eq("id", property.id);
        } else if (pastDue.length === 0 && previouslyNotified.length > 0) {
          // Everything got resolved -- clear the memory so a future new requirement notifies again.
          await supabase.from("properties").update({ stripe_requirements_notified: [] }).eq("id", property.id);
        }
      }
      break;
    }

    default:
      console.log(`[stripe-webhook] Unhandled: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
