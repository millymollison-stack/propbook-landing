import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

// David 2026-10-20: one-time (well, re-runnable) admin backfill. The
// account.updated webhook (see stripe-webhook/index.ts) keeps
// properties/profiles.stripe_account_status in sync GOING FORWARD for any
// property, automatically, now that the "Connected accounts"-scoped
// destination exists in Stripe. This function is only for properties that
// were connected BEFORE that destination existed, whose status might
// already be stale (active on Stripe, still "pending" in our DB) and have
// no reason to get a fresh account.updated event any time soon. Visiting
// this URL with the right key checks every connected property directly
// against Stripe and corrects any mismatch -- same fix David and Claude
// did by hand for ravenswortha14, applied to everyone at once.
//
// Not meant to run on a schedule -- it's a repair tool, safe to re-run
// whenever needed (e.g. after a bulk CSV import of properties), but the
// webhook is what should normally keep things in sync.
//
// GET https://jtzagpbdrqfifdisxipr.supabase.co/functions/v1/sync-stripe-account-statuses?key=<SYNC_SECRET>
const SYNC_SECRET = "UReMaVYsZXPvzWoKrUBYX4h369Uc1mBe";

export default Deno.serve({ verifyJwt: false }, async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, apikey",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("key") !== SYNC_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;
  const stripe = new Stripe(stripeKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, slug, stripe_account_id, stripe_account_status")
    .not("stripe_account_id", "is", null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: Array<{ slug: string; accountId: string; oldStatus: string | null; newStatus: string; changed: boolean; error?: string }> = [];

  for (const property of properties || []) {
    try {
      const account = await stripe.accounts.retrieve(property.stripe_account_id);
      const newStatus = (account.charges_enabled && account.payouts_enabled) ? "active" : "pending";
      const changed = newStatus !== property.stripe_account_status;

      if (changed) {
        await supabase.from("properties").update({ stripe_account_status: newStatus }).eq("id", property.id);
        await supabase.from("profiles").update({ stripe_account_status: newStatus }).eq("stripe_account_id", property.stripe_account_id);
      }

      results.push({
        slug: property.slug,
        accountId: property.stripe_account_id,
        oldStatus: property.stripe_account_status,
        newStatus,
        changed,
      });
    } catch (err: any) {
      // Don't let one bad/deleted Stripe account (e.g. an old test account
      // that got removed on Stripe's side) stop the rest of the batch.
      results.push({
        slug: property.slug,
        accountId: property.stripe_account_id,
        oldStatus: property.stripe_account_status,
        newStatus: "unknown",
        changed: false,
        error: err.message,
      });
    }
  }

  const summary = {
    checked: results.length,
    changed: results.filter(r => r.changed).length,
    errors: results.filter(r => r.error).length,
    results,
  };

  console.log("[sync-stripe-account-statuses]", JSON.stringify(summary));

  return new Response(JSON.stringify(summary, null, 2),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
