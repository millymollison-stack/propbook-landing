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

    // Verify admin role
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin") throw new Error("Forbidden");

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Fetch account, balance, and recent charges in parallel
    const [account, balance, charges, subscriptions] = await Promise.all([
      stripe.accounts.retrieve(),
      stripe.balance.retrieve(),
      stripe.charges.list({ limit: 5 }),
      stripe.subscriptions.list({ limit: 5, status: "active" }),
    ]);

    return new Response(
      JSON.stringify({
        account: {
          id: account.id,
          email: account.email,
          business_name: (account as any).business_profile?.name || account.email,
          country: account.country,
          default_currency: account.default_currency,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
        },
        balance: {
          available: balance.available.map(b => ({ amount: b.amount, currency: b.currency })),
          pending: balance.pending.map(b => ({ amount: b.amount, currency: b.currency })),
        },
        recent_charges: charges.data.map(c => ({
          id: c.id,
          amount: c.amount,
          currency: c.currency,
          status: c.status,
          description: c.description,
          created: c.created,
        })),
        subscriptions: subscriptions.data.map(s => ({
          id: s.id,
          status: s.status,
          current_period_end: s.current_period_end,
          plan: (s as any).items?.data?.[0]?.price?.nickname || 'Subscription',
          amount: (s as any).items?.data?.[0]?.price?.unit_amount || 0,
          interval: (s as any).items?.data?.[0]?.price?.recurring?.interval || 'month',
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
