import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";

// David 2026-10-22: "I know I have changed the prices. Can we do that on this
// and the landing page." -- Starter (the only LIVE, purchasable tier) moves
// from $10 to $14.99/mo, Growth from $25 to $24.99/mo, Spotlight from $124.99
// to $99.99/mo. Growth and Spotlight are still "Coming Soon" (inert buttons,
// no checkout reachable), but Starter is real and sold today, so its checkout
// price has to actually match what's now displayed or a subscriber would be
// shown $14.99 and charged the old $10 price. One-time setup function (same
// pattern as setup-growth-price / setup-spotlight-price), creates all three
// new Prices in one run instead of three separate round-trips. Existing
// subscribers on the old $10 Starter price are NOT affected -- Stripe price
// changes only apply going forward, to new checkouts using the new price id.
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

    const tiers = [
      { key: "starter", name: "PropBook Starter", amount: 1499, desc: "1 property site, hosting, AI SEO, Analytics." },
      { key: "growth", name: "PropBook Growth", amount: 2499, desc: "Starter +, 2nd property site, own domain, Marketing, Social." },
      { key: "spotlight", name: "PropBook Spotlight", amount: 9999, desc: "Growth +, 3rd property site, Influencer, Advertising, Videos." },
    ];

    const results: Record<string, { productId: string; priceId: string }> = {};
    for (const tier of tiers) {
      const product = await stripe.products.create({ name: tier.name, description: tier.desc });
      const price = await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: tier.amount,
        recurring: { interval: "month" },
      });
      results[tier.key] = { productId: product.id, priceId: price.id };
    }

    return new Response(JSON.stringify({
      success: true,
      prices: results,
      note: "Copy each priceId into stripe-subscription/index.ts's matching *_PRICE_ID constant.",
    }, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
