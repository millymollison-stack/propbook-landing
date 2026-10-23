import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";

// David 2026-10-21: one-time setup function (same pattern as sync-stripe-account-statuses)
// to create the real Stripe Product + Price for the new Growth tier ($25/mo, up to 2
// property sites) -- stripe-subscription/index.ts needs a real price ID to check out
// against, and the only way to create one is server-side where STRIPE_SECRET_KEY lives.
// Run this ONCE, copy the priceId it returns into stripe-subscription/index.ts's price
// lookup, then this function has done its job (safe to leave deployed -- re-running it
// just creates a duplicate, inactive-looking product in the Dashboard, so don't re-run
// unless you actually want a second one).
const SETUP_SECRET = "1fKpbf92EioWoWGCmjPu_X8hmP-H4jTd";

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
  if (url.searchParams.get("key") !== SETUP_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });

    const product = await stripe.products.create({
      name: "PropBook Growth",
      description: "Up to 2 property sites, hosting, SEO, and support.",
    });

    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: 2500, // $25.00/mo
      recurring: { interval: "month" },
    });

    return new Response(JSON.stringify({
      success: true,
      productId: product.id,
      priceId: price.id,
      note: "Copy priceId into stripe-subscription/index.ts's plan === 'growth' branch.",
    }, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
