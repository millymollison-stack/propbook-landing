/**
 * deployReact.ts — Build React app locally and upload to Hostinger
 *
 * This runs on the Mac Mini browser after the user clicks "Publish" in the sidebar.
 * Steps:
 *  1. Run `VITE_BASE_PATH=/props/{slug}/ npm run build` locally
 *  2. Zip dist/ to a temp file
 *  3. POST the zip to deploy-react-upload.php on Hostinger (which extracts it)
 *  4. Return the deployed site URL
 *
 * The Supabase property status update is handled separately by the deploy-site edge function.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { join as pathJoin, dirname } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);

const PROJECT_ROOT = pathJoin(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEPLOY_TOKEN = process.env.DEPLOY_SECRET || '';
const UPLOAD_URL = 'https://www.propbook.pro/scripts/deploy-react-upload.php';
export interface DeployReactOptions {
  slug: string;
  propertyId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  onProgress?: (msg: string) => void;
}

export async function deployReactApp(opts: DeployReactOptions): Promise<string> {
  const { slug, propertyId, supabaseUrl, supabaseAnonKey, onProgress } = opts;
  const basePath = `/props/${slug}/`;
  const siteUrl = `https://www.propbook.pro/props/${slug}`;

  onProgress?.(`Building React app for /props/${slug}/...`);

  // Step 1: Build with correct base path
  const buildEnv = {
    ...process.env,
    VITE_BASE_PATH: basePath,
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_ANON_KEY: supabaseAnonKey,
    GENERATE_SOURCEMAP: 'false',
  };

  const buildCmd = `cd '${PROJECT_ROOT}' && VITE_BASE_PATH='${basePath}' VITE_SUPABASE_URL='${supabaseUrl}' VITE_SUPABASE_ANON_KEY='${supabaseAnonKey}' GENERATE_SOURCEMAP='false' npm run build`;
  console.log('[deployReact] Running build:', buildCmd.slice(0, 100), '...');

  try {
    execSync(buildCmd, {
      encoding: 'utf8',
      stdio: 'pipe',
      env: buildEnv,
    });
  } catch (err: any) {
    throw new Error(`Build failed: ${err.message}`);
  }

  const distDir = pathJoin(PROJECT_ROOT, 'dist');
  if (!existsSync(distDir)) {
    throw new Error('dist/ directory not found after build');
  }

  onProgress?.('Creating deployment package...');

  // Step 2: Zip dist/ contents
  const tmpDir = mkdtempSync(pathJoin(tmpdir(), 'propbook-deploy-'));
  const zipPath = pathJoin(tmpDir, `dist-${slug}.zip`);

  try {
    const { execSync: exec } = require('child_process');
    // Create zip of dist/ contents (not the dist/ directory itself)
    exec(`cd '${distDir}' && zip -r '${zipPath}' . -x '*.map'`, {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: distDir,
    });
    console.log('[deployReact] Zip created:', zipPath, 'size:', require('fs').statSync(zipPath).size);
  } catch (err: any) {
    throw new Error(`Failed to create zip: ${err.message}`);
  }

  onProgress?.('Uploading to server...');

  // Step 3: Upload zip to Hostinger via the PHP upload script
  const formData = new FormData();
  formData.append('secret', DEPLOY_TOKEN);
  formData.append('slug', slug);
  formData.append('property_id', propertyId);

  // Read zip as a File-like Blob
  const zipBuffer = require('fs').readFileSync(zipPath);
  const zipBlob = new Blob([zipBuffer], { type: 'application/zip' });
  formData.append('zip_file', zipBlob, `dist-${slug}.zip`);

  let uploadResult: any;
  try {
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      body: formData,
    });
    const text = await res.text();
    console.log('[deployReact] Upload response status:', res.status);
    console.log('[deployReact] Upload response body (first 500):', text.slice(0, 500));

    // Parse the last JSON line (PHP may output multiple JSON lines)
    const lines = text.trim().split('\n');
    const lastJsonLine = lines[lines.length - 1];
    uploadResult = JSON.parse(lastJsonLine);

    if (!uploadResult.success) {
      throw new Error(`Upload failed: ${uploadResult.error || 'unknown error'}`);
    }
  } catch (err: any) {
    throw new Error(`Upload failed: ${err.message}`);
  }

  onProgress?.('Deploy complete!');

  // Clean up temp zip
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  return uploadResult.siteUrl || siteUrl;
}
