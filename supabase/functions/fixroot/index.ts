import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const UPLOAD_PHP_URL = "https://www.propbook.pro/upload.php";
const DEPLOY_SECRET = Deno.env.get("DEPLOY_SECRET")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200 });
  }

  try {
    const { html } = await req.json();
    if (!html) return new Response(JSON.stringify({ error: "Missing html" }), { status: 400 });

    // Write to Hostinger root via upload.php
    // The slug "" means root path
    const uploadResp = await fetch(UPLOAD_PHP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "PropBook-Deploy/1.0" },
      body: JSON.stringify({
        slug: "__root",
        secret: DEPLOY_SECRET,
        files: { "index.html": btoa(unescape(encodeURIComponent(html))) }
      })
    });

    const result = await uploadResp.json();
    return new Response(JSON.stringify({ success: true, result }));
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
