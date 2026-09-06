import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const { propertyId, slug } = await req.json();
    if (!propertyId || !slug) throw new Error("Missing propertyId or slug");

    console.log(`[deploy-react] 🚀 slug=${slug} propertyId=${propertyId}`);

    // Verify property belongs to user
    const { data: property } = await supabase
      .from("properties")
      .select("id, owner_id, status")
      .eq("id", propertyId)
      .maybeSingle();
    if (!property) throw new Error("Property not found");
    if (property.owner_id !== user.id) throw new Error("Not your property");

    const siteUrl = `https://www.propbook.pro/props/${slug}`;

    // Return deploy credentials — browser will build locally and upload to PHP endpoint
    return new Response(
      JSON.stringify({
        success: true,
        deployUrl: "https://www.propbook.pro/scripts/deploy.php",
        propertyId,
        slug,
        siteUrl,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[deploy-react] ❌ Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
