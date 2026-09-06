import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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
    const paddleSecretKey = Deno.env.get("PADDLE_SECRET_KEY");
    if (!paddleSecretKey) {
      return new Response(JSON.stringify({ error: "Paddle secret key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify calling user's JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { transaction_id, plan } = body;
    if (!transaction_id) throw new Error("Missing transaction_id");

    console.log(`[paddle-verification] transaction_id=${transaction_id}, plan=${plan}, user=${user.id}`);

    // ── Verify transaction with Paddle API ─────────────────────────────────
    const paddleRes = await fetch(`https://api.paddle.com/transactions/${transaction_id}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${paddleSecretKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!paddleRes.ok) {
      const errText = await paddleRes.text();
      console.error(`[paddle-verification] Paddle API error: ${paddleRes.status} ${errText}`);
      throw new Error(`Paddle API error: ${paddleRes.status}`);
    }

    const transaction = await paddleRes.json();
    console.log(`[paddle-verification] Transaction status: ${transaction.status}`);

    // Check if transaction is billed (success)
    if (transaction.status !== "billed" && transaction.status !== "completed") {
      return new Response(JSON.stringify({ 
        error: "Payment not confirmed", 
        status: transaction.status 
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the customer email matches
    const customerEmail = transaction.custom_data?.email || transaction.customer?.email;
    if (customerEmail && customerEmail.toLowerCase() !== user.email.toLowerCase()) {
      console.warn(`[paddle-verification] Email mismatch: expected ${user.email}, got ${customerEmail}`);
    }

    // ── Update profile with subscription ──────────────────────────────────
    const profileUpdate: Record<string, any> = {
      paddle_subscription_status: "active",
      paddle_plan: plan || "starter",
      paddle_transaction_id: transaction_id,
    };

    const { error: updateError } = await supabase
      .from("profiles")
      .update(profileUpdate)
      .eq("id", user.id);

    if (updateError) {
      console.error(`[paddle-verification] Profile update failed:`, updateError);
      throw new Error("Failed to update profile");
    }

    console.log(`[paddle-verification] Profile updated for user ${user.id}`);

    return new Response(JSON.stringify({ 
      success: true, 
      status: "active",
      transaction_id,
      plan: plan || "starter",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[paddle-verification]", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});