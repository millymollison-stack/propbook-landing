#!/usr/bin/env node
// Redeploy: update window.__PROPERTY_DATA__ + bundle URLs in each property's index.html
// Uses /dev/ for CSS + JS bundles

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname2, '..');
const JS_FILE = path.join(ROOT, 'src', 'dist', 'assets', 'index.js');
const CSS_FILE = path.join(ROOT, 'src', 'dist', 'assets', 'index.css');

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0emFncGJkcnFmaWZkaXN4aXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ3MzUyODUsImV4cCI6MjA2MDMxMTI4NX0.uWqc82Hb-qnRq4H9kg5IPykUosm9VvU2s6e8mOalkR0';
const UPLOAD_URL = 'https://www.propbook.pro/upload.php';
const DEPLOY_SECRET = 'propbook-deploy-2026';
const BUNDLE_VERSION = '1788726316593';
const BUNDLE_JS = 'index.js';
const BUNDLE_CSS = 'index.css';

// Properties from Supabase query
const PROPERTIES = [
  { slug: 'surf-house-baja', id: 'efa8d280-afee-4971-9145-d591740f484d' },
  { slug: 'vijaya-valley', id: 'c7628c80-36c0-459f-a501-469999efd11e' },
  { slug: 'ipanemaa4', id: 'ef2cdcd6-4381-4ccf-8c15-efcccac0448e' },
  { slug: 'ravesnwortha1', id: '860d265b-37bd-4367-a9ea-21214a00733c' },
  { slug: 'casa-vilosel', id: 'c20f0e7e-d882-4232-abf3-78bce344b912' },
  { slug: 'surfhousebaja', id: '4a888d6a-2fef-4fb1-9973-76ae5ee5e3a1' },
  { slug: 'your-summertime-hideaway-in-bohemian-botafogo', id: '6e023e3c-ecce-4435-914a-3d7c4816092f' },
  { slug: 'test', id: '65249fed-e34f-43a5-bc55-71d8d1752075' },
  { slug: 'pedacg53', id: 'f89e1e7a-d79f-4046-a12d-6e9016e57777' },
  { slug: 'chaletb2', id: 'cce4c684-ffaf-4349-81b0-a0e4886ad6d7' },
  { slug: 'ravenswor-b1', id: 'a6603efa-a0e7-451c-83c2-5658a19d78d1' },
];

function postJson(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: 'propbook.pro', path: '/upload.php', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchProp(id) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'jtzagpbdrqfifdisxipr.supabase.co',
      path: `/rest/v1/properties?id=eq.${id}&select=*`,
      headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
    };
    https.get(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`Fetch error: ${d.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function buildIndexHtml(p) {
  const pd = {
    id: p.id, slug: p.slug,
    title: p.title || p.name || p.slug,
    name: p.name || p.title || '',
    description: p.description || '',
    property_title: p.property_title || p.title || null,
    property_headline: p.property_headline || p.property_title || p.title || null,
    property_intro: p.property_intro || '',
    hero_image: p.hero_image || '', images: p.images || [],
    address: p.address || '', location: p.location || p.address || '',
    bedrooms: p.bedrooms ?? null, beds: p.beds ?? null, bathrooms: p.bathrooms ?? null,
    max_guests: p.max_guests ?? null, price_per_night: p.price_per_night ?? null,
    rating: p.rating ?? null, reviews: p.reviews ?? null,
    brand_color: p.brand_color || null, font_accent: p.font_accent || null,
    property_details: p.property_details || null, activities: p.activities || null,
    local_area: p.local_area || null, getting_there: p.getting_there || null,
    host_name: p.host_name || null, email: p.email || null,
    owner_id: p.owner_id || null,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pd.property_headline || pd.title || '@' + p.slug}</title>
  <link rel="stylesheet" href="${BUNDLE_CSS}?v=${BUNDLE_VERSION}" />
  <script>window.__PROPERTY_DATA__ = ${JSON.stringify(pd)};</script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${BUNDLE_JS}?v=${BUNDLE_VERSION}"></script>
</body>
</html>`;
}

function buildHtaccess(slug) {
  return `RewriteEngine On
RewriteBase /
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ /props/${slug}/index.html [L]`;
}

async function deploy(prop) {
  const props = await fetchProp(prop.id);
  const p = props[0];
  if (!p) { console.error(`  ❌ Property not found: ${prop.id}`); return; }
  console.log(`  ✓ "${p.name}", owner_id=${p.owner_id}`);

  const indexHtml = buildIndexHtml(p);
  const htaccess = buildHtaccess(p.slug);

  const res = await postJson({
    secret: DEPLOY_SECRET,
    slug: prop.slug,
    files: {
      'index.html': Buffer.from(indexHtml).toString('base64'),
      '.htaccess': Buffer.from(htaccess).toString('base64'),
      [BUNDLE_JS]: Buffer.from(fs.readFileSync(JS_FILE)).toString('base64'),
      [BUNDLE_CSS]: Buffer.from(fs.readFileSync(CSS_FILE)).toString('base64'),
    },
  });

  console.log(`  ✓ ${res.written} files → ${res.siteUrl}`);
}

async function main() {
  console.log('Redeploying all property sites with /dev/ bundle paths...\n');

  for (const prop of PROPERTIES) {
    process.stdout.write(`[${prop.slug}] `);
    try {
      await deploy(prop);
    } catch (e) {
      console.error(`❌ ${e.message}`);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
