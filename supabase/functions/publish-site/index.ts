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

    const { propertyId, slug, htmlContent } = await req.json();
    if (!propertyId || !slug) {
      throw new Error("Missing propertyId or slug");
    }

    // Verify this property belongs to the user
    const { data: property } = await supabase
      .from("properties")
      .select("id, owner_id, stripe_account_id")
      .eq("id", propertyId)
      .maybeSingle();

    if (!property) throw new Error("Property not found");
    if (property.owner_id !== user.id) throw new Error("Not authorized for this property");

    const HOSTINGER_USER = "u805830916";
    const HOSTINGER_HOST = "82.29.86.252";
    const HOSTINGER_PORT = "65002";
    const HOSTINGER_PASS = Deno.env.get("HOSTINGER_SSH_PASS") || "Clawbot12!";
    const DEST_PATH = `/home/${HOSTINGER_USER}/domains/propbook.pro/public_html/props/${slug}`;

    // Step 1: Create directory on Hostinger
    const mkdirCmd = `mkdir -p "${DEST_PATH}" && echo "DIR_OK"`;
    const mkdirRes = await runSSH(mkdirCmd, HOSTINGER_USER, HOSTINGER_HOST, HOSTINGER_PORT, HOSTINGER_PASS);
    console.log("mkdir:", mkdirRes);

    // Step 2: Write HTML via SFTP (pipe through stdin)
    const writeRes = await runSFTPPut(htmlContent, DEST_PATH + "/index.html", HOSTINGER_USER, HOSTINGER_HOST, HOSTINGER_PORT, HOSTINGER_PASS);
    console.log("sftp write:", writeRes);

    // Step 3: Mark property as active in Supabase
    await supabase
      .from("properties")
      .update({
        status: "active",
        site_url: `https://propbook.pro/props/${slug}`,
        server_ip: HOSTINGER_HOST,
        folder_path: DEST_PATH,
      })
      .eq("id", propertyId);

    return new Response(
      JSON.stringify({ success: true, siteUrl: `https://propbook.pro/props/${slug}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("publish-site error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── SSH helper ───────────────────────────────────────────────────────────────
async function runSSH(
  cmd: string,
  user: string,
  host: string,
  port: string,
  pass: string
): Promise<string> {
  const fullCmd = [
    "sshpass",
    `-p '${pass}'`,
    "ssh",
    "-o", "StrictHostKeyChecking=no",
    "-p", port,
    `${user}@${host}`,
    `"${cmd}"`,
  ].join(" ");

  const proc = Deno.run({
    cmd: fullCmd.split(" "),
    stdout: "piped",
    stderr: "piped",
  });
  const [stdout, stderr] = await Promise.all([proc.output(), proc.stderrOutput()]);
  const status = await proc.status();
  if (!status.success) {
    throw new Error(`SSH failed: ${new TextDecoder().decode(stderr)}`);
  }
  return new TextDecoder().decode(stdout).trim();
}

// ─── SFTP put helper (writes content to remote file via stdin) ───────────────
async function runSFTPPut(
  content: string,
  remotePath: string,
  user: string,
  host: string,
  port: string,
  pass: string
): Promise<string> {
  const sftpCmd = [
    "sshpass",
    `-p '${pass}'`,
    "sftp",
    "-o", "StrictHostKeyChecking=no",
    "-P", port,
    `${user}@${host}`,
  ];

  const proc = Deno.run({
    cmd: sftpCmd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });

  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode(`put /dev/stdin "${remotePath}"\nbye\n`));
  writer.releaseLock();

  const [stdout, stderr] = await Promise.all([proc.output(), proc.stderrOutput()]);
  const status = await proc.status();
  if (!status.success) {
    throw new Error(`SFTP failed: ${new TextDecoder().decode(stderr)}`);
  }
  return new TextDecoder().decode(stdout).trim();
}
