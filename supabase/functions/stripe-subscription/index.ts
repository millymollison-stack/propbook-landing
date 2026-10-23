import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
};


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Support both POST (body.action) and GET (?action= in URL query string)
    // The edge function is called with ?action=get via GET from AdminSidebarBundle,
    // so we must extract action from URL search params for GET requests.
    let body: any = {};
    try {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('application/json') && req.method !== 'GET') {
        body = await req.json();
      }
    } catch {
      // Body may be empty or not JSON — that's OK for GET requests
    }

    // Extract action: POST uses body.action, GET uses URL query param
    const urlAction = new URL(req.url).searchParams.get('action');
    const action = body.action || urlAction;

    // Decode userId from the Authorization JWT header (works for both GET and POST)
    const authHeader = req.headers.get('Authorization') || '';
    let headerUserId: string | null = null;
    try {
      const token = authHeader.replace('Bearer ', '').split('.')[1];
      headerUserId = JSON.parse(atob(token))?.sub || null;
    } catch { /* ignore malformed token */ }

    // ── Handle get action FIRST (no userId/slug required) ───────────────────
    // Called by AdminSidebarBundle to get subscription status from the user's profile.
    if (action === 'get') {
      const userId = body.userId || headerUserId;
      if (!userId) throw new Error("No userId provided and no session found");

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_subscription_status, stripe_subscription_plan, stripe_subscription_id, stripe_customer_id, stripe_subscription_amount, stripe_subscription_interval, stripe_subscription_period_end')
        .eq('id', userId)
        .maybeSingle();

      if (!profile || !profile.stripe_subscription_status) {
        return new Response(JSON.stringify({ subscription: null }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // David 2026-09-22: stripe_subscription_period_end is a Postgres `timestamptz`
      // column (stored by stripe-webhook as an ISO string, e.g. "2026-10-22 12:30:19+00"),
      // but the frontend's SubscriptionData.current_period_end is typed `number | null` and
      // rendered with date-fns's fromUnixTime(), which expects Unix SECONDS. Passing the raw
      // ISO string straight through made `fromUnixTime("2026-10-22T12:30:19+00:00")` compute
      // NaN (string coerced via `* 1000`), producing an Invalid Date that crashed the whole
      // Subscription section render with "RangeError: Invalid time value" (blank page via the
      // App ErrorBoundary) -- reported live on ipenemaa15. Convert back to Unix seconds here so
      // this endpoint actually returns what its own declared shape promises.
      const periodEndUnix = profile.stripe_subscription_period_end
        ? Math.floor(new Date(profile.stripe_subscription_period_end).getTime() / 1000)
        : null;

      return new Response(JSON.stringify({
        subscription: {
          id: profile.stripe_subscription_id,
          status: profile.stripe_subscription_status,
          plan: profile.stripe_subscription_plan,
          amount: profile.stripe_subscription_amount ?? 1000,
          interval: profile.stripe_subscription_interval ?? 'month',
          current_period_end: periodEndUnix,
          customer_id: profile.stripe_customer_id,
        }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Handle get_session action (verify Stripe checkout payment) ───────────
    // No userId/slug required — just verify session_id with Stripe
    if (action === 'get_session') {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
      const sessionId = body.session_id;
      if (!sessionId) throw new Error("Missing required field: session_id");

      const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
        headers: { "Authorization": `Bearer ${stripeKey}` },
      });
      if (!stripeRes.ok) {
        const errText = await stripeRes.text();
        console.error("[stripe-subscription] Stripe retrieve error:", errText);
        throw new Error(`Stripe error: ${errText}`);
      }
      const session = await stripeRes.json();
      console.log(`[stripe-subscription] Session ${sessionId} status: ${session.status}`);

      return new Response(
        JSON.stringify({
          status: session.status,
          subscription: {
            status: session.subscription_status || 'active',
            id: session.subscription,
            customer_id: session.customer,
            amount_total: session.amount_total,
            currency: session.currency,
          },
          subscription_id: session.subscription,
          customer_id: session.customer,
          sub_status: session.subscription_status || 'active',
          amount_total: session.amount_total,
          currency: session.currency,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Actions below need a userId; slug is optional metadata only ───────────
    // David: neither current caller (GetSite.tsx's old draft-checkout call, or
    // AdminSidebarBundle.tsx's handleSubscribeCheckout) actually sends `slug`,
    // yet this hard-required it -- every checkout request 400'd on "Missing
    // required fields: userId, slug" before ever reaching Stripe. That's the
    // real reason Publish/Subscribe couldn't engage Stripe tonight. Falling
    // back to the JWT's own subject (same as the `get` action above) when the
    // body doesn't carry userId either, and treating slug as optional metadata.
    const userId = body.userId || body.user_id || headerUserId;
    const slug = body.slug || '';
    const propertyId = body.propertyId || body.property_id;
    if (!userId) {
      throw new Error("Missing required field: userId");
    }

    // ── Handle create_checkout_session action (Stripe checkout) ──────────────
    // Both call sites (GetSite.tsx and AdminSidebarBundle.tsx) actually send
    // action: 'create_checkout' (no "_session") -- that mismatch is why every
    // checkout attempt fell through to "Unknown action" below and 400'd. Accepting
    // both names here rather than touching two client call sites.
    if (action === 'create_checkout_session' || action === 'create_checkout') {
      console.log(`[stripe-subscription] Checkout for user=${userId}, slug=${slug}, plan=${body.plan || 'starter'}`);
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

      // David 2026-10-21: "Once you have one site you can't get another with the same
      // login... open subscription should let you choose 2nd tier that allows 2 sites."
      // Dropped the old 'pro'/'agency' tiers -- PLANS (AdminSidebarBundle.tsx) never
      // offered them (pruned to Starter-only back on 2026-09-22, since they were
      // placeholder prices with no real Stripe Price behind them), so those branches
      // were unreachable dead code. 'growth' replaces them: $25/mo, up to 2 sites.
      //
      // GROWTH_PRICE_ID is a placeholder -- run setup-growth-price ONCE (a one-time
      // function, same pattern as sync-stripe-account-statuses), and paste the priceId
      // it returns in here before deploying this file, or every Growth checkout will
      // fail with an invalid-price error from Stripe.
      //
      // David 2026-10-22: Spotlight added the same way, $124.99/mo -- it's "Coming
      // Soon" (an inert, unclickable button) in both the app and the landing page, so
      // nothing calls this with plan: 'spotlight' yet. Wiring the real price now so
      // flipping Spotlight on later is just a UI change, not another round-trip here.
      //
      // David 2026-10-22 (later same day): prices revised again -- Starter $10->$14.99,
      // Growth $25->$24.99, Spotlight $124.99->$99.99. Starter is the one LIVE,
      // purchasable tier, so its real price has to move too or checkout would still
      // charge the old $10 while the UI shows $14.99. All three below are placeholders
      // -- run setup-revised-tier-prices ONCE and paste its three priceIds in here.
      // Existing Starter subscribers keep their original $10 price; this only affects
      // new checkouts.
      const plan = body.plan || 'starter';
      const STARTER_PRICE_ID = 'price_1UTSahK5ECFjIqP3rfWlWju9';
      const GROWTH_PRICE_ID = 'price_1UTSahK5ECFjIqP3FTtGEfxd';
      const SPOTLIGHT_PRICE_ID = 'price_1UTSahK5ECFjIqP3wjKsYFSa';
      const priceId = plan === 'growth' ? GROWTH_PRICE_ID
        : plan === 'spotlight' ? SPOTLIGHT_PRICE_ID
        : STARTER_PRICE_ID; // starter default

      // Use the return_url from the frontend if provided, otherwise fall back to propbook.pro.
      // Stripe will redirect the browser to this URL after payment.
      // Also strip trailing slash to avoid double-slash (e.g. http://localhost:5174/ + /?paid=true → //?paid=true)
      const baseUrl = body.return_url
        ? body.return_url.replace(/\?.*$/, '').replace(/\/$/, '')
        : 'https://www.propbook.pro';
      const successUrl = `${baseUrl}/?paid=true&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/?step=cancelled`;

      // David: AdminSidebarBundle.tsx's handleSubscribeCheckout never sends `email` at
      // all, so this was sending customer_email="" -- Stripe rejects an empty string
      // as an invalid email (it's fine with the field being absent entirely). Look the
      // real address up server-side from the authenticated user instead of trusting the
      // client to supply it.
      let customerEmail = body.email || '';
      if (!customerEmail && userId) {
        try {
          const { data: authUser } = await supabase.auth.admin.getUserById(userId);
          customerEmail = authUser?.user?.email || '';
        } catch (e) {
          console.error('[stripe-subscription] Could not look up user email:', e);
        }
      }

      const checkoutParams: Record<string, string> = {
        "success_url": successUrl,
        "cancel_url": cancelUrl,
        "mode": "subscription",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        "metadata[user_id]": userId,
        "metadata[slug]": slug,
        "metadata[plan]": plan,
        "allow_promotion_codes": "true",
        "billing_address_collection": "auto",
      };
      if (customerEmail) checkoutParams["customer_email"] = customerEmail;

      // Build Stripe checkout session
      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(checkoutParams).toString(),
      });

      if (!stripeRes.ok) {
        const errText = await stripeRes.text();
        console.error("[stripe-subscription] Stripe error:", errText);
        throw new Error(`Stripe error: ${errText}`);
      }

      const session = await stripeRes.json();
      console.log(`[stripe-subscription] Checkout session created: ${session.id}`);

      return new Response(
        JSON.stringify({ url: session.url, sessionId: session.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // David: this used to fall through into a "deploy action (original flow)" branch
    // (property clone + renderPropertyHtml + SSH upload to Hostinger) whenever `action`
    // didn't match one of the cases above. It always threw -- renderPropertyHtml referenced
    // at least seven undeclared variables -- and was only ever reached via a fetch from
    // stripe-webhook's checkout.session.completed handler that itself swallowed the error.
    // Real site creation goes through GetSite.tsx -> save-site-records instead. Confirmed
    // dead and deleted, along with renderPropertyHtml/uploadViaSSH and their helper
    // functions below, rather than fixed (2026-09-21).
    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error("[stripe-subscription] ❌ Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
