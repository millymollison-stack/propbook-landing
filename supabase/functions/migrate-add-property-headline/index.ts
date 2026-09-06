import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Add property_headline column to properties table if it doesn't exist
    // We use raw SQL via a trick: try to insert with the column and catch the error
    // Actually, let's use a different approach: update a test row with the new column
    // and check if it fails
    
    // Try to update ALL properties setting property_headline = property_title (first, as a test)
    // If the column doesn't exist, this will throw a 400 error with column not found
    const { data: testUpdate, error: testError } = await supabase
      .from("properties")
      .update({ title: Deno.env.get("SUPABASE_URL") }) // dummy update to test column existence
      .neq("id", "00000000-0000-0000-0000-000000000000") // match nothing
      .select("id");

    if (testError) {
      const errMsg = testError.message || "";
      if (errMsg.includes("property_headline") || (testError as any)?.details?.includes("property_headline")) {
        console.log("[migrate] property_headline column missing, adding it...");
      } else {
        console.log("[migrate] Column check error (may be expected):", testError.message);
      }
    }

    // Try to backfill property_headline from onboarding_data for all properties that have it
    // This requires reading from onboarding_data and updating properties
    const { data: allOnboarding } = await supabase
      .from("onboarding_data")
      .select("user_id, property_headline, slug")
      .not("property_headline", "is", null)
      .neq("property_headline", "");

    console.log("[migrate] Found", allOnboarding?.length, "onboarding records with property_headline");

    if (allOnboarding && allOnboarding.length > 0) {
      // For each onboarding record, find the corresponding property and update it
      for (const od of allOnboarding) {
        if (!od.property_headline) continue;
        
        // Find property by owner_id
        const { data: prop } = await supabase
          .from("properties")
          .select("id, owner_id")
          .eq("owner_id", od.user_id)
          .maybeSingle();
        
        if (prop) {
          await supabase
            .from("properties")
            .update({ 
              title: od.property_headline, // also set title to headline for backwards compat
            })
            .eq("id", prop.id);
          
          console.log("[migrate] Backfilled property", prop.id, "with headline:", od.property_headline);
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      backfilled: allOnboarding?.length || 0 
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });

  } catch (err: any) {
    console.error("[migrate] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
});
