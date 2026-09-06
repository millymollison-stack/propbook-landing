import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.11.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PLATFORM_FEE_PERCENT = 0.02; // 2%

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

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      // User not authenticated or token expired/invalid — return empty account rather than crashing
      return new Response(JSON.stringify({ account: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // GET — return connect account data + balance for the user's property
    if (req.method === "GET") {
      // Find the property owned by this user
      // First try property owned by user
      const { data: property } = await supabase
        .from("properties")
        .select("id, stripe_account_id, stripe_account_status")
        .eq("owner_id", user.id)
        .maybeSingle();


      let accountId = property?.stripe_account_id;

      // Fallback: check profile
      if (!accountId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("stripe_account_id")
          .eq("id", user.id)
          .maybeSingle();
        accountId = profile?.stripe_account_id || null;
      }


      // NOTE: The old "orphaned property" fallback was removed — it could pick up
      // any user's Stripe account from properties with null owner_id, causing the wrong
      // account to show in the Banking section. Stripe account must now be tied to
      // either the user's property (owner_id = user.id) or their profile.

      if (!accountId) {
        return new Response(JSON.stringify({ account: null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const [account, balance] = await Promise.all([
        stripe.accounts.retrieve(accountId),
        stripe.balance.retrieve({ stripeAccount: accountId }),
      ]);

      // Fetch bank account details
      let bankAccount: { bank_name: string; last4: string; account_holder_name: string } | null = null;
      try {
        const externalAccounts = await stripe.accounts.listExternalAccounts(accountId, { object: 'bank_account', limit: 1 });
        if (externalAccounts.data.length > 0) {
          const bank = externalAccounts.data[0] as any;
          bankAccount = {
            bank_name: bank.bank_name,
            last4: bank.last4,
            account_holder_name: bank.account_holder_name,
          };
        }
      } catch {
        // Non-fatal — bank account info is optional
      }

      const available = balance.available.find(b => b.currency === "usd")?.amount ?? 0;
      const pending = balance.pending.find(b => b.currency === "usd")?.amount ?? 0;

      return new Response(
        JSON.stringify({
          account_id: account.id,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          details_submitted: account.details_submitted,
          business_name: (account as any).business_profile?.name || account.email || "",
          email: account.email || "",
          available_balance: available,
          pending_balance: pending,
          currency: "usd",
          bank_account: bankAccount,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST
    const body = await req.json();
    const { action, return_url } = body;

    if (action === "create_account_link") {
      // Find or validate property ownership
      const { data: property } = await supabase
        .from("properties")
        .select("id, stripe_account_id, title")
        .eq("owner_id", user.id)
        .maybeSingle();

      let accountId = property?.stripe_account_id;

      if (!accountId) {
        // Create a new Express account scoped to this property/user
        const account = await stripe.accounts.create({
          type: "express",
          country: "US",
          email: user.email,
          business_profile: {
            name: property?.title || undefined,
            url: undefined,
          },
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            user_id: user.id,
            property_id: property?.id || "",
          },
        });
        accountId = account.id;

        // Store on the property row so it is property-scoped
        if (property?.id) {
          await supabase
            .from("properties")
            .update({ stripe_account_id: accountId, stripe_account_status: "pending" })
            .eq("id", property.id);
        }

        // Also keep a copy on the profile for backwards-compat lookup
        await supabase
          .from("profiles")
          .update({ stripe_account_id: accountId, stripe_account_status: "pending" })
          .eq("id", user.id);
      }

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: return_url || `${Deno.env.get("SUPABASE_URL")}/`,
        return_url: return_url || `${Deno.env.get("SUPABASE_URL")}/`,
        type: "account_onboarding",
      });

      return new Response(
        JSON.stringify({ url: accountLink.url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "payout") {
      // Resolve account from property
      const { data: property } = await supabase
        .from("properties")
        .select("id, stripe_account_id")
        .eq("owner_id", user.id)
        .maybeSingle();

      const accountId = property?.stripe_account_id;
      if (!accountId) throw new Error("No connected Stripe account found");

      const balance = await stripe.balance.retrieve({ stripeAccount: accountId });
      const available = balance.available.find(b => b.currency === "usd")?.amount ?? 0;
      if (available <= 0) throw new Error("No available balance to pay out");

      const fee = Math.round(available * PLATFORM_FEE_PERCENT);
      const payoutAmount = available - fee;

      // Best-effort: transfer 2% platform fee to the platform's own Stripe account
      if (fee > 0) {
        await stripe.transfers.create(
          { amount: fee, currency: "usd", destination: "self" },
          { stripeAccount: accountId }
        ).catch(() => {
          // Non-fatal — payout proceeds even if fee transfer fails
        });
      }

      const payout = await stripe.payouts.create(
        { amount: payoutAmount, currency: "usd" },
        { stripeAccount: accountId }
      );

      return new Response(
        JSON.stringify({ payout_id: payout.id, amount: payoutAmount, fee }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get_dashboard_link") {
      const { data: property } = await supabase
        .from("properties")
        .select("stripe_account_id")
        .eq("owner_id", user.id)
        .maybeSingle();

      const accountId = property?.stripe_account_id;
      if (!accountId) throw new Error("No connected Stripe account");

      const loginLink = await stripe.accounts.createLoginLink(accountId);
      return new Response(
        JSON.stringify({ url: loginLink.url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "create_onboarding_session") {
      // Find or create the Stripe Connect Express account for this user
      const { data: property } = await supabase
        .from("properties")
        .select("id, stripe_account_id, title")
        .eq("owner_id", user.id)
        .maybeSingle();


      let accountId = property?.stripe_account_id;

      if (!accountId) {
        // Create a new Express account scoped to this property/user
        const account = await stripe.accounts.create({
          type: "express",
          country: "US",
          email: user.email,
          business_profile: {
            name: property?.title || undefined,
          },
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            user_id: user.id,
            property_id: property?.id || "",
          },
        });
        accountId = account.id;

        if (property?.id) {
          await supabase
            .from("properties")
            .update({ stripe_account_id: accountId, stripe_account_status: "pending" })
            .eq("id", property.id);
        }
        await supabase
          .from("profiles")
          .update({ stripe_account_id: accountId, stripe_account_status: "pending" })
          .eq("id", user.id);
      }

      // Create an AccountLink for embedded onboarding
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: body.return_url || `${supabaseUrl}/`,
        return_url: body.return_url || `${supabaseUrl}/`,
        type: "account_onboarding",
      });

      // Return the AccountLink URL for Stripe's hosted Connect onboarding redirect
      return new Response(
        JSON.stringify({ url: accountLink.url, account_id: accountId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Unknown action");
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
