import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey",
  };
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { user_id, property_id } = await req.json();
    if (!user_id) return new Response(JSON.stringify({ error: "Missing user_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Upgrade role to admin and set website_live
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update({ role: "admin", website_live: true })
      .eq("id", user_id)
      .select("id, role, website_live")
      .single();

    let propertyResult = null;
    if (property_id) {
      const { data: prop } = await supabase
        .from("properties")
        .update({ status: "active" })
        .eq("id", property_id)
        .select("id, status")
        .single();
      propertyResult = prop;
    } else {
      // Find property by owner_id and activate it
      const { data: prop } = await supabase
        .from("properties")
        .update({ status: "active" })
        .eq("owner_id", user_id)
        .select("id, status")
        .maybeSingle();
      propertyResult = prop;
    }

    console.log(`[upgrade-user] user_id=${user_id} -> role=${profile?.role}, website_live=${profile?.website_live}, property=${propertyResult?.id} status=${propertyResult?.status}`);

    return new Response(JSON.stringify({ success: true, profile, property: propertyResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("[upgrade-user] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
