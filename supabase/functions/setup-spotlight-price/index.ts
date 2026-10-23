import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";

// David 2026-10-22: one-time setup function (same pattern as setup-growth-price)
// to create the real Stripe Product + Price for the new Spotlight tier ($124.99/mo,
// up to 3 property sites + Influencer/Advertising/Video features) -- Spotlight is
// shown in the app and on the landing page as "Coming Soon" (an inert, unclickable
// button, not wired to checkout) until David finishes the rest of what's needed to
// actually sell it. Run this ONCE, copy the priceId it returns into
// stripe-subscription/index.ts's price lookup, then this function has done its job.
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
      name: "PropBook Spotlight",
      description: "Up to 3 property sites, dedicated marketing & influencer outreach, advertising, property video.",
    });

    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: 12499, // $124.99/mo
      recurring: { interval: "month" },
    });

    return new Response(JSON.stringify({
      success: true,
      productId: product.id,
      priceId: price.id,
      note: "Copy priceId into stripe-subscription/index.ts's plan === 'spotlight' branch.",
    }, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
