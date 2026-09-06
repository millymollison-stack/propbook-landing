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

import { supabaseAdmin } from '../lib/supabase';

const DEPLOY_SECRET = 'propbook-deploy-2026';
const UPLOAD_URL = 'https://propbook.pro/upload.php';

export interface DeployResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Recursively read a directory and return all files as base64 + path pairs
 */
async function readDirAsFiles(dir: FileSystemDirectoryHandle, basePath = ''): Promise<Array<{ path: string; data: ArrayBuffer }>> {
  const files: Array<{ path: string; data: ArrayBuffer }> = [];
  for await (const entry of dir.values()) {
    const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      const subFiles = await readDirAsFiles(entry as FileSystemDirectoryHandle, fullPath);
      files.push(...subFiles);
    } else {
      const file = await (entry as FileSystemFileHandle).getFile();
      files.push({ path: fullPath, data: await file.arrayBuffer() });
    }
  }
  return files;
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
    const manifestRes = await fetch(`https://propbook.pro/_templates/migration/manifest.json`).catch(() => null);
    const manifest = manifestRes?.ok ? await manifestRes.json() : null;

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

    // Mark property as active in Supabase
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

    await fetch(
      `${supabaseUrl}/rest/v1/properties?id=eq.${propertyId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ is_live: true }),
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
