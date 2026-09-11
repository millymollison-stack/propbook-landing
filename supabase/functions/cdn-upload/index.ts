import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Deploy a PHP uploader to a temp slug, then use it to upload files to the CDN directory.
// Finally cleans up after itself.

const UPLOAD_PHP_URL = "https://www.propbook.pro/upload.php";
const DEPLOY_SECRET = Deno.env.get("DEPLOY_SECRET")!;

const UPLOADER_PHP = `<?php
// CDN uploader - deletes itself after use
header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  echo json_encode(['error' => 'POST only']);
  exit;
}
$secret = $_POST['secret'] ?? $_GET['secret'] ?? '';
if ($secret !== '${DEPLOY_SECRET}') {
  echo json_encode(['error' => 'unauthorized']);
  exit;
}
$filename = $_POST['filename'] ?? '';
$content = $_POST['content'] ?? '';
if (!$filename || !$content) {
  echo json_encode(['error' => 'missing filename or content']);
  exit;
}
$cdn_dir = '/home/u156866638/domains/propbook.pro/public_html/scripts/react-assets/assets';
if (!is_dir($cdn_dir)) {
  mkdir($cdn_dir, 0755, true);
}
$path = $cdn_dir . '/' . basename($filename);
$decoded = base64_decode($content);
if ($decoded === false) {
  echo json_encode(['error' => 'base64 decode failed']);
  exit;
}
$result = file_put_contents($path, $decoded);
if ($result === false) {
  echo json_encode(['error' => 'write failed', 'path' => $path]);
  exit;
}
echo json_encode(['success' => true, 'written' => $result, 'path' => $path, 'url' => 'https://www.propbook.pro/scripts/react-assets/assets/' . basename($filename)]);
@unlink(__FILE__); // self-destruct
`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200 });
  }

  try {
    const { filename, content } = await req.json();
    if (!filename || !content) {
      return new Response(JSON.stringify({ error: "Missing filename or content" }), { status: 400 });
    }

    // Deploy the uploader PHP to a temp slug
    const uploaderBase64 = btoa(unescape(encodeURIComponent(UPLOADER_PHP)));
    const tempSlug = 'cdnup-' + Math.random().toString(36).slice(2, 8);
    
    const deployResp = await fetch(UPLOAD_PHP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "PropBook-Deploy/1.0" },
      body: JSON.stringify({
        slug: tempSlug,
        secret: DEPLOY_SECRET,
        files: { 'upload-cdn.php': uploaderBase64 }
      })
    });

    const deployResult = await deployResp.json();
    if (!deployResp.ok || !deployResult.success) {
      return new Response(JSON.stringify({ error: "Failed to deploy uploader", detail: deployResult }), { status: 500 });
    }

    const uploaderUrl = `https://www.propbook.pro/props/${tempSlug}/upload-cdn.php`;
    
    // Use the uploader to write the actual file to the CDN directory
    const contentBase64 = btoa(unescape(encodeURIComponent(content)));
    const uploadResp = await fetch(uploaderUrl, {
      method: "POST",
      headers: { "User-Agent": "PropBook-Deploy/1.0" },
      body: new URLSearchParams({
        secret: DEPLOY_SECRET,
        filename: filename,
        content: contentBase64
      })
    });

    const uploadResult = await uploadResp.json();
    
    return new Response(JSON.stringify({ 
      success: true, 
      deploy: deployResult,
      upload: uploadResult,
      url: `https://www.propbook.pro/scripts/react-assets/assets/${filename}`
    }));
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
