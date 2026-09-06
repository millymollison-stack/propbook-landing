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

    // Gate to saas_admin only
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.role !== "saas_admin") throw new Error("Forbidden: saas_admin only");

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "overview";

    // ── overview: platform balance + all connected account summaries ─────────
    if (action === "overview") {
      // Platform's own balance
      const [platformBalance, allProperties] = await Promise.all([
        stripe.balance.retrieve(),
        supabase
          .from("properties")
          .select("id, title, slug, owner_id, stripe_account_id, stripe_account_status")
          .not("stripe_account_id", "is", null),
      ]);

      const properties = allProperties.data || [];

      // Fetch balance for each connected account in parallel
      const accountSummaries = await Promise.all(
        properties.map(async (prop: any) => {
          try {
            const [account, balance, charges] = await Promise.all([
              stripe.accounts.retrieve(prop.stripe_account_id),
              stripe.balance.retrieve({ stripeAccount: prop.stripe_account_id }),
              stripe.charges.list(
                { limit: 5, created: { gte: Math.floor(Date.now() / 1000) - 86400 * 30 } },
                { stripeAccount: prop.stripe_account_id }
              ),
            ]);

            const available = balance.available.find((b: any) => b.currency === "usd")?.amount ?? 0;
            const pending = balance.pending.find((b: any) => b.currency === "usd")?.amount ?? 0;
            const monthlyVolume = charges.data.reduce((sum: number, c: any) => sum + (c.captured ? c.amount : 0), 0);
            const platformFees = charges.data.reduce((sum: number, c: any) => sum + (c.application_fee_amount || 0), 0);

            return {
              property_id: prop.id,
              property_title: prop.title,
              property_slug: prop.slug,
              stripe_account_id: prop.stripe_account_id,
              charges_enabled: account.charges_enabled,
              payouts_enabled: account.payouts_enabled,
              details_submitted: account.details_submitted,
              business_name: (account as any).business_profile?.name || account.email || "",
              email: account.email || "",
              available_balance: available,
              pending_balance: pending,
              monthly_volume: monthlyVolume,
              platform_fees_collected: platformFees,
              error: null,
            };
          } catch (err: any) {
            return {
              property_id: prop.id,
              property_title: prop.title,
              property_slug: prop.slug,
              stripe_account_id: prop.stripe_account_id,
              charges_enabled: false,
              payouts_enabled: false,
              details_submitted: false,
              business_name: "",
              email: "",
              available_balance: 0,
              pending_balance: 0,
              monthly_volume: 0,
              platform_fees_collected: 0,
              error: err.message,
            };
          }
        })
      );

      // Also pull platform-level charges (payments not routed to a connect account)
      const platformCharges = await stripe.charges.list({
        limit: 10,
        created: { gte: Math.floor(Date.now() / 1000) - 86400 * 30 },
      });

      const platformFeeTotal = accountSummaries.reduce(
        (sum: number, a: any) => sum + a.platform_fees_collected,
        0
      );

      return new Response(
        JSON.stringify({
          platform_balance: {
            available: platformBalance.available.find((b: any) => b.currency === "usd")?.amount ?? 0,
            pending: platformBalance.pending.find((b: any) => b.currency === "usd")?.amount ?? 0,
          },
          platform_fees_30d: platformFeeTotal,
          total_accounts: accountSummaries.length,
          accounts: accountSummaries,
          recent_platform_charges: platformCharges.data.map((c: any) => ({
            id: c.id,
            amount: c.amount,
            currency: c.currency,
            status: c.status,
            description: c.description,
            created: c.created,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── account_detail: full charge list for one connected account ───────────
    if (action === "account_detail") {
      const accountId = url.searchParams.get("account_id");
      if (!accountId) throw new Error("account_id required");

      const limit = parseInt(url.searchParams.get("limit") || "50");

      const [account, balance, charges, payouts] = await Promise.all([
        stripe.accounts.retrieve(accountId),
        stripe.balance.retrieve({ stripeAccount: accountId }),
        stripe.charges.list({ limit }, { stripeAccount: accountId }),
        stripe.payouts.list({ limit: 20 }, { stripeAccount: accountId }),
      ]);

      const available = balance.available.find((b: any) => b.currency === "usd")?.amount ?? 0;
      const pending = balance.pending.find((b: any) => b.currency === "usd")?.amount ?? 0;

      return new Response(
        JSON.stringify({
          account: {
            id: account.id,
            business_name: (account as any).business_profile?.name || account.email,
            email: account.email,
            charges_enabled: account.charges_enabled,
            payouts_enabled: account.payouts_enabled,
            country: account.country,
            default_currency: account.default_currency,
          },
          balance: { available, pending },
          charges: charges.data.map((c: any) => ({
            id: c.id,
            amount: c.amount,
            amount_captured: c.amount_captured,
            application_fee_amount: c.application_fee_amount,
            currency: c.currency,
            status: c.status,
            captured: c.captured,
            refunded: c.refunded,
            description: c.description,
            receipt_email: c.receipt_email,
            created: c.created,
            metadata: c.metadata,
          })),
          payouts: payouts.data.map((p: any) => ({
            id: p.id,
            amount: p.amount,
            currency: p.currency,
            status: p.status,
            arrival_date: p.arrival_date,
            created: p.created,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── bookings: cross-reference our DB bookings with Stripe ───────────────
    if (action === "bookings") {
      const { data: bookings } = await supabase
        .from("bookings")
        .select("*, property:properties(title, slug, stripe_account_id), user:profiles(email, full_name)")
        .order("created_at", { ascending: false })
        .limit(100);

      return new Response(
        JSON.stringify({ bookings: bookings || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error: any) {
    console.error("stripe-admin error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: error.message.includes("Forbidden") ? 403 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
