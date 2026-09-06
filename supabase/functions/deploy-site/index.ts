import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Used to authenticate deploy-react.php calls (simple shared secret)
const DEPLOY_SECRET = Deno.env.get("DEPLOY_SECRET") || "propbook-deploy-2026";
const UPLOAD_PHP_URL = "https://propbook.pro/upload.php";
const DEPLOY_PHP_URL = "https://propbook.pro/scripts/deploy-react-upload.php";

// Cloudflare cache purge
const CF_ZONE_ID = "27e6d05a1f8dd1e69ae9ebfdd9872558";
const CF_API_TOKEN = Deno.env.get("CF_API_TOKEN") || "";

async function purgeCloudflareCache(urls: string[]): Promise<void> {
  if (!CF_API_TOKEN || urls.length === 0) return;
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files: urls }),
    });
    const data = await res.json();
    if (data.success) {
      console.log(`[cache-purge] ✅ Purged ${urls.length} URL(s)`);
    } else {
      console.warn(`[cache-purge] ⚠️ Failed:`, data.errors);
    }
  } catch (e: any) {
    console.error("[cache-purge] ❌ Error:", e.message);
  }
}

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

    const {
      propertyId,
      slug,
      // Optional pre-built files from browser (base64 encoded)
      // Sent when browser built the SPA itself and just needs server-side upload
      prebuiltHtml,
      seoFiles, // Record<string, base64string>
    } = await req.json();
    if (!propertyId || !slug) throw new Error("Missing propertyId or slug");

    // Verify property belongs to user
    const { data: property } = await supabase
      .from("properties")
      .select("id, owner_id, status")
      .eq("id", propertyId)
      .maybeSingle();
    if (!property) throw new Error("Property not found");
    if (property.owner_id !== user.id) throw new Error("Not authorized");

    const siteUrl = `https://www.propbook.pro/props/${slug}`;

    // ── Step 1: Use browser-provided pre-built HTML (generated from current SPA_TEMPLATE) ──
    // Browser has the latest code — always prefer its HTML over the Mac Mini build
    let deployResult: { success: boolean; siteUrl: string; error?: string } | null = null;
    let browserUploadOk = false;

    if (prebuiltHtml || seoFiles) {
      console.log("[deploy-site] Uploading browser-provided pre-built files via upload.php...");
      try {
        const files: Record<string, string> = {};
        if (prebuiltHtml) files["index.html"] = prebuiltHtml;
        if (seoFiles) {
          for (const [name, content] of Object.entries(seoFiles)) {
            files[name] = content as string;
          }
        }
        const uploadRes = await fetch(UPLOAD_PHP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: DEPLOY_SECRET, slug, files }),
        });
        const uploadData = await uploadRes.json().catch(() => null);
        if (uploadData?.success) {
          console.log("[deploy-site] ✅ Pre-built files uploaded successfully");
          // Purge Cloudflare cache for shared CSS/JS so all sites get fresh files
          await purgeCloudflareCache([
            "https://www.propbook.pro/dev/index.css",
            "https://www.propbook.pro/dev/index-BWUGJmZY.js",
          ]);
          browserUploadOk = true;
          deployResult = { success: true, siteUrl };
        } else {
          console.warn("[deploy-site] Pre-built file upload failed:", uploadData?.error);
        }
      } catch (err: any) {
        console.error("[deploy-site] Pre-built upload threw:", err.message);
      }
    }

    // ── Step 2: Only try Mac Mini build if no browser HTML was provided ──
    if (!deployResult?.success) {
      console.log(`[deploy-site] No browser HTML — trying Mac Mini build for slug=${slug}...`);
      try {
        const deployRes = await fetch(DEPLOY_PHP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: DEPLOY_SECRET,
            slug,
            property_id: propertyId,
          }),
        });

        const deployText = await deployRes.text();
        console.log(`[deploy-site] deploy-react-upload.php response (${deployRes.status}):`, deployText.slice(0, 300));

        // Parse the last JSON line (PHP may output multiple status lines)
        const lines = deployText.trim().split("\n");
        const lastJsonLine = lines[lines.length - 1];
        try {
          deployResult = JSON.parse(lastJsonLine);
        } catch {
          deployResult = { success: false, siteUrl, error: `Invalid PHP response: ${deployText.slice(0, 200)}` };
        }

        if (deployResult?.success) {
          console.log(`[deploy-site] ✅ Deploy via PHP succeeded: ${deployResult.siteUrl}`);
          // Purge Cloudflare cache for shared CSS/JS so all sites get fresh files
          await purgeCloudflareCache([
            "https://www.propbook.pro/dev/index.css",
            "https://www.propbook.pro/dev/index-BWUGJmZY.js",
          ]);
        } else {
          console.warn(`[deploy-site] ⚠️ PHP deploy failed: ${deployResult?.error}`);
        }
      } catch (fetchErr: any) {
        console.error("[deploy-site] PHP fetch error:", fetchErr.message);
      }
    }

    // ── Step 3: Update Supabase property status ──────────────────────────────
    const finalSiteUrl = deployResult?.siteUrl || siteUrl;
    const { error: updateErr } = await supabase
      .from("properties")
      .update({
        status: "active",
        site_url: finalSiteUrl,
      })
      .eq("id", propertyId);

    if (updateErr) {
      console.error("[deploy-site] ⚠️ Property status update failed:", updateErr.message);
    }

    console.log(`[deploy-site] ✅ Done for slug=${slug}, siteUrl=${finalSiteUrl}`);

    return new Response(
      JSON.stringify({
        success: !!deployResult?.success,
        siteUrl: finalSiteUrl,
        slug,
        propertyId,
        deployed_via: deployResult?.success
          ? (browserUploadOk ? "browser-prebuilt-upload" : "deploy-react-upload.php")
          : "none",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[deploy-site] ❌ Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
