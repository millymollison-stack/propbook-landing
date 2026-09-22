/**
 * deployService.ts
 * Browser-based deploy: POSTs pre-built dist/ files to Hostinger PHP upload receiver
 * 
 * Flow:
 * 1. Browser fetches the pre-built dist/ from the template on Hostinger
 * 2. Browser POSTs each file to upload.php on Hostinger via HTTPS
 * 3. PHP writes files to props/{slug}/
 * 4. Browser marks property as active in Supabase
 */


const DEPLOY_SECRET = import.meta.env.VITE_DEPLOY_SECRET_DEPRECATED || '';
const UPLOAD_URL = 'https://propbook.pro/upload.php';

export interface DeployResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Deploy the pre-built SPA to Hostinger by posting files via HTTPS
 * Uses the browser's File System Access API to read the dist/ folder
 */
export async function deploySiteToHostinger(
  slug: string,
  propertyId: string,
  onProgress?: (percent: number, message: string) => void
): Promise<DeployResult> {
  try {
    onProgress?.(10, 'Preparing files...');

    // Fetch the template from Hostinger _templates/migration/
    const templateIndexUrl = `https://propbook.pro/_templates/migration/index.html`;
    const indexRes = await fetch(templateIndexUrl);
    if (!indexRes.ok) {
      return { success: false, error: `Could not fetch template from ${templateIndexUrl}` };
    }

    // Get the list of files by fetching the directory listing via a manifest
    // Since we can't list directories over HTTP, we use a known manifest

    onProgress?.(20, 'Connecting to server...');

    // POST files to upload.php as base64 JSON
    const filesPayload: Record<string, string> = {};

    // Fetch all known template files
    const fileUrls = [
      'index.html',
      'assets/index-BMpMzdBB.css',
      'assets/browser-VzoYYI-d.js',
      'assets/siteDuplicationService-CBNxMwBB.js',
      'assets/index-BS8RYSdb.js',
      'template/template.html',
      'template/surfhousebaja-main.jpg',
    ];

    for (let i = 0; i < fileUrls.length; i++) {
      const url = fileUrls[i];
      onProgress?.(20 + Math.floor((i / fileUrls.length) * 50), `Fetching ${url}...`);
      try {
        const res = await fetch(`https://propbook.pro/_templates/migration/${url}`);
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          filesPayload[url] = arrayBufferToBase64(buffer);
        }
      } catch (e) {
        console.warn(`Failed to fetch ${url}:`, e);
      }
    }

    onProgress?.(70, 'Uploading files to server...');

    const response = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        propertyId,
        secret: DEPLOY_SECRET,
        files: filesPayload,
      }),
    });

    onProgress?.(90, 'Finalizing...');

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Upload failed: ${response.status} ${errorText}` };
    }

    const result = await response.json();
    if (!result.success) {
      return { success: false, error: result.error || 'Upload failed' };
    }

    // Mark property as active in Supabase -- routed through the update-property edge
    // function (which does the privileged write server-side) instead of a direct PATCH
    // to /rest/v1/properties using the service_role key from the browser.
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    await fetch(
      `${supabaseUrl}/functions/v1/update-property`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ id: propertyId, is_live: true }),
      }
    );

    onProgress?.(100, 'Done!');
    return { success: true, url: `https://propbook.pro/props/${slug}/` };
  } catch (err) {
    console.error('[deploySiteToHostinger] Error:', err);
    return { success: false, error: String(err) };
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
