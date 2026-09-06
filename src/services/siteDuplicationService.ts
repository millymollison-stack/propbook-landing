/**
 * SiteDuplicationService — creates a new customer site after Stripe payment
 *
 * PUBLISH FLOW:
 *
 *  Button 1 — "Save Site"
 *    → createNewSiteRecords() — creates property + profile + onboarding records
 *    → status: 'draft', site_url: null — NOT live yet
 *
 *  Button 2 — "Go Live"
 *    → duplicateSiteAfterPayment() — copies clean React SPA to /props/{slug}/
 *    → marks property status: 'active', site_url set — site is now live
 *
 * Deploy mechanism: calls deploy-site edge function → upload.php server-side (no CORS).
 * The SPA HTML is built in-browser, sent to the edge function, which uploads
 * it via upload.php. SEO files are included in the same request.
 */

import { supabase, supabaseAdmin } from '../lib/supabase';
import { createSlug } from './slugService';

// Embedded SPA template — avoids CORS issues when deploying from the browser
const SPA_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Libre+Baskerville:wght@400;700&family=Oswald:wght@400;500;600;700&family=Sintony:wght@400;700&family=Raleway:wght@400;500;600;700&family=Nixie+One&family=Oleo+Script:wght@400;700&family=Unbounded:wght@400;500;600;700;800;900&family=Urbanist:wght@400;500;600;700&family=Barrio&family=Advent+Pro:wght@400;500;600;700&family=DM+Serif+Display&family=Fraunces:wght@400;700&family=Archivo+Black&display=swap" rel="stylesheet">
    <script>
(function() {
  var saved = localStorage.getItem("site-brand-color");
  if (saved) {
    try {
      var c = JSON.parse(saved);
      document.documentElement.style.setProperty("--brand", c.brand);
      document.documentElement.style.setProperty("--brand-hover", c.brandHover);
      document.documentElement.style.setProperty("--brand-disabled", c.brandDisabled);
    } catch(e) {}
  }
  var savedFont = localStorage.getItem("site-font-accent");
  if (savedFont) {
    document.documentElement.style.setProperty("--font-accent", "'" + savedFont + "', serif");
  }
})();
</script>
    <script>
// If ?paid=true (Stripe return), redirect to main propbook.pro to handle the migration
(function() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('paid') === 'true') {
    var sessionId = params.get('session_id');
    var returnUrl = window.location.href; // Remember where we came from
    sessionStorage.setItem('migration_return_url', returnUrl);
    var redirectUrl = 'https://www.propbook.pro/?paid=true';
    if (sessionId) redirectUrl += '&session_id=' + encodeURIComponent(sessionId);
    window.location.replace(redirectUrl);
    return;
  }
})();
</script>
    <style>:root{--brand:#C47756;--brand-hover:#B5684A;--brand-disabled:#D4A393;--font-accent:'Playfair Display',serif}</style>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{PAGE_TITLE}}</title>
    <meta name="description" content="{{META_DESCRIPTION}}" />
    <meta property="og:title" content="{{OG_TITLE}}" />
    <meta property="og:description" content="{{OG_DESCRIPTION}}" />
    <meta property="og:image" content="{{OG_IMAGE}}" />
    <meta property="og:url" content="{{CANONICAL_URL}}" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{{OG_TITLE}}" />
    <meta name="twitter:description" content="{{OG_DESCRIPTION}}" />
    <meta name="twitter:image" content="{{OG_IMAGE}}" />
    <link rel="canonical" href="{{CANONICAL_URL}}" />
{{NOINDEX}}{{GOOGLE_VERIFY}}
    <link rel="stylesheet" href="//propbook.pro/dev/assets/index.css" />
    <script>
    // Expose sidebar openers on window so static HTML buttons can call them
    window.__openGuestSidebar = function() {
      var evt = new CustomEvent('open-guest-sidebar');
      document.dispatchEvent(evt);
    };
    window.__openAdminSidebar = function() {
      var evt = new CustomEvent('open-admin-sidebar');
      document.dispatchEvent(evt);
    };
    window.__openLoginModal = function() {
      var evt = new CustomEvent('open-login-modal');
      document.dispatchEvent(evt);
    };
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/dev/assets/index.js"></script>
  </body>
</html>`;

// ─────────────────────────────────────────────
// SEO FILE GENERATORS
// ─────────────────────────────────────────────

export interface PropertySeoData {
  title: string;
  description: string;
  address: string;
  location: string;
  bedrooms: number | null;
  beds: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  price_per_night: number | null;
  images: string[];
  slug: string;
  site_url: string;
}

export interface SeoFileToggles {
  generate_robots_txt: boolean;
  generate_sitemap_xml: boolean;
  generate_llms_txt: boolean;
  generate_faq_ai_txt: boolean;
}

/** Generate robots.txt for a property site */
export function generateRobotsTxt(slug: string, siteUrl: string): string {
  return `User-agent: *
Allow: /
Disallow: /api/

# AI / LLM crawlers
User-agent: ChatGPT-User
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: PerplexityBot
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
}

/** Generate sitemap.xml for a property site */
export function generateSitemapXml(prop: PropertySeoData): string {
  const now = new Date().toISOString().split('T')[0];
  const loc = prop.site_url || `https://www.propbook.pro/props/${prop.slug}`;
  const price = prop.price_per_night ? ` from $${prop.price_per_night}/night` : '';
  const descSnippet = prop.description ? prop.description.slice(0, 120).replace(/<[^>]+>/g, '') : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${loc}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

/** Generate llms.txt — plain-text description for LLMs */
export function generateLlmsTxt(prop: PropertySeoData): string {
  const title = prop.title || 'Vacation Rental Property';
  const location = prop.address || prop.location || 'Location TBD';
  const desc = prop.description || '';
  const bedrooms = prop.bedrooms ?? '?';
  const beds = prop.beds ?? '?';
  const baths = prop.bathrooms ?? '?';
  const maxGuests = prop.max_guests ?? '?';
  const price = prop.price_per_night ? `$${prop.price_per_night}` : 'TBD';
  const images = prop.images && prop.images.length > 0 ? prop.images.slice(0, 3) : [];

  const lines = [
    `# ${title}`,
    ``,
    `## About This Property`,
    desc || 'A vacation rental property listed on PropBook.',
    ``,
    `## Location`,
    location,
    ``,
    `## Property Details`,
    `- Bedrooms: ${bedrooms}`,
    `- Beds: ${beds}`,
    `- Bathrooms: ${baths}`,
    `- Maximum Guests: ${maxGuests}`,
    ``,
    `## Pricing`,
    `From ${price} per night`,
    ``,
    `## How to Book`,
    `Visit the property website to check availability and make a booking directly.`,
    ``,
    `## Contact`,
    `Book through the property listing page or contact the host via the website.`,
  ];

  if (images.length > 0) {
    lines.push(``);
    lines.push(`## Images`);
    images.forEach((img, i) => {
      lines.push(`[Property Image ${i + 1}] ${img}`);
    });
  }

  return lines.join('\n');
}

/** Generate faq-ai.txt — FAQ Q&A pairs for AI crawlers */
export function generateFaqAiTxt(prop: PropertySeoData): string {
  const title = prop.title || 'this property';
  const bedrooms = prop.bedrooms ?? '?';
  const beds = prop.beds ?? '?';
  const baths = prop.bathrooms ?? '?';
  const maxGuests = prop.max_guests ?? '?';
  const location = prop.address || prop.location || 'the property location';
  const price = prop.price_per_night ? `$${prop.price_per_night}` : 'TBD';

  return `FAQ — ${title}

Q: What type of property is this?
A: This is a vacation rental property located in ${location}. It is listed on PropBook, a direct booking platform for vacation rentals.

Q: How many bedrooms and guests does ${title} accommodate?
A: The property has ${bedrooms} bedroom(s), ${beds} bed(s), ${baths} bathroom(ies), and can accommodate up to ${maxGuests} guest(s).

Q: What is the price per night?
A: Nightly rates start from ${price}. Final pricing depends on the season and length of stay.

Q: What amenities are available?
A: The property includes amenities such as a kitchen, WiFi, air conditioning, and more. Check the property listing for the full amenities list.

Q: What are the check-in and check-out times?
A: Standard check-in is at 3:00 PM and check-out is at 11:00 AM. These times may vary — contact the host for specific arrangements.

Q: Is there a cancellation policy?
A: Yes. The cancellation policy is set by the host and is displayed on the property booking page. Please review it before confirming your reservation.

Q: How do I book ${title}?
A: You can book directly through the property website. Select your dates, review the house rules and cancellation policy, and complete the booking with secure payment.

Q: Are pets allowed?
A: Pet policies vary by property. Please check the property listing or contact the host directly to confirm whether pets are permitted.
`;
}


export interface ScrapedData {
  title: string;
  location: string;
  description: string;
  hero_image: string;
  images: string[];
  guests: number | null;
  bedrooms: number | null;
  beds: number | null;
  baths: number | null;
  rating: number | null;
  reviews: number | null;
  host_name: string | null;
  price: string;

  property_headline: string;}

export interface NewSiteData {
  email: string;
  userId: string;
  userStripeAccountId?: string;
  bookingsEmail: string;
  websiteName: string;
  websiteDesc: string;
  propertyHeadline?: string;  // full property headline (no 12-char limit)
  propertyTitle?: string;  // headline for {{PROPERTY_TITLE}} template token
  slug?: string;  // optional explicit slug — if not provided, one is generated from websiteName
  planChoice: 'starter' | 'pro' | 'agency';
  hostingChoice: 'our' | 'own';
  extras: { seo: boolean; ads: boolean; analytics: boolean; social: boolean };
  scrapedData: ScrapedData | null;
  designChoice: string;
  bankChoice: string;
  // SEO fields (from admin sidebar SEO panel)
  customPageTitle?: string;
  metaDescription?: string;
  ogImageUrl?: string;
  googleVerification?: string;
  robotsNoindex?: boolean;
}

// ─────────────────────────────────────────────
// STEP 1 — Read template.html from the src/public template folder
// ─────────────────────────────────────────────
export async function loadTemplateHtml(): Promise<string> {
  const res = await fetch('/template/template.html');
  if (!res.ok) throw new Error(`Failed to load template.html: ${res.status}`);
  return res.text();
}

// ─────────────────────────────────────────────
// STEP 2 — Generate HTML by replacing placeholders
// Template tokens: {{BRAND_HANDLE}} {{TITLE}} {{ADDRESS}} {{PRICE_PER_NIGHT}}
//   {{DESCRIPTION}} {{PROPERTY_INTRO}} {{IMAGE_1}}..{{IMAGE_20}} {{IMAGE_SIDE_A}}
//   {{IMAGE_SIDE_B}} {{IMAGE_6}} {{CONTACT_EMAIL}} {{YEAR}} {{RATING}} {{REVIEW_COUNT}}
//   {{BEDROOMS}} {{BEDS}} {{BATHROOMS}} {{MAX_GUESTS}} {{LOCAL_AREA}}
//   {{ACTIVITIES}} {{GETTING_THERE}} {{BRAND_COLOR}} {{PROPERTY_ID}} {{SLUG}}
// ─────────────────────────────────────────────
export function generateSiteHtml(template: string, data: NewSiteData): string {
  const s = data.scrapedData;
  const slug = data.slug || data.websiteName.toLowerCase().replace(/\s+/g, '');
  const price = s?.price ? s.price.replace(/[^0-9.]/g, '') : '150';
  const heroImage = s?.hero_image || '';
  const images = s?.images || [];

  // PROPERTY_INTRO = short teaser — user's edited description takes priority over raw scrape
  const fullDesc = data.websiteDesc || s?.description || '';
  const firstPeriod = fullDesc.indexOf('.');
  const propertyIntro = firstPeriod > 5 && firstPeriod < 100
    ? fullDesc.slice(0, firstPeriod + 1)
    : (fullDesc.slice(0, 60) + (fullDesc[60] ? '...' : ''));

  let html = template;
  html = html.replace(/\{\{BRAND_HANDLE\}\}/g, `@${slug}`);
  html = html.replace(/\{\{BRAND_NAME\}\}/g, data.websiteName);
  html = html.replace(/\{\{TITLE\}\}/g, data.websiteName || s?.title || '');
  // H1 headline: user's property headline field takes priority over scraped text
  const headline = data.propertyHeadline || s?.property_intro || s?.title || data.websiteName;
  html = html.replace(/\{\{PROPERTY_TITLE\}\}/g, headline);
  html = html.replace(/\{\{ADDRESS\}\}/g, s?.location || '');
  html = html.replace(/\{\{LOCATION\}\}/g, s?.location || '');
  html = html.replace(/\{\{PRICE_PER_NIGHT\}\}/g, price);
  html = html.replace(/\{\{PRICE\}\}/g, price);
  // User's edited description takes priority over raw scraped text
  html = html.replace(/\{\{DESCRIPTION\}\}/g, data.websiteDesc || s?.description || '');
  html = html.replace(/\{\{PROPERTY_INTRO\}\}/g, propertyIntro);
  html = html.replace(/\{\{HERO_IMAGE\}\}/g, heroImage);

  // SEO meta tags
  const siteUrl = `https://www.propbook.pro/props/${slug}`;
  const pageTitle = data.customPageTitle || data.websiteName || '';
  const metaDesc = data.metaDescription || (data.websiteDesc || s?.description || '').slice(0, 160);
  const ogTitle = data.customPageTitle || data.propertyHeadline || data.websiteName || '';
  const ogDesc = data.metaDescription || (data.websiteDesc || s?.description || '').slice(0, 200);
  const ogImage = data.ogImageUrl || heroImage || '';
  html = html.replace(/\{\{PAGE_TITLE\}\}/g, pageTitle);
  html = html.replace(/\{\{META_DESCRIPTION\}\}/g, metaDesc);
  html = html.replace(/\{\{OG_TITLE\}\}/g, ogTitle);
  html = html.replace(/\{\{OG_DESCRIPTION\}\}/g, ogDesc);
  html = html.replace(/\{\{OG_IMAGE\}\}/g, ogImage);
  html = html.replace(/\{\{CANONICAL_URL\}\}/g, siteUrl);
  // Conditional: noindex meta tag
  html = html.replace(/\{\{NOINDEX\}\}/g, data.robotsNoindex ? '<meta name="robots" content="noindex, nofollow" />' : '');
  // Google site verification meta tag
  html = html.replace(/\{\{GOOGLE_VERIFY\}\}/g, data.googleVerification ? `<meta name="google-site-verification" content="${data.googleVerification}" />` : '');
  html = html.replace(/\{\{REVIEW_COUNT\}\}/g, String(s?.reviews ?? 0));
  html = html.replace(/\{\{GUESTS\}\}/g, String(s?.guests ?? 8));
  html = html.replace(/\{\{BEDROOMS\}\}/g, String(s?.bedrooms ?? 2));
  html = html.replace(/\{\{BEDS\}\}/g, String(s?.beds ?? 3));
  html = html.replace(/\{\{BATHS\}\}/g, String(s?.baths ?? 1));
  html = html.replace(/\{\{RATING\}\}/g, String(s?.rating ?? '4.8'));
  html = html.replace(/\{\{HOST_NAME\}\}/g, s?.host_name || 'Property Manager');
  html = html.replace(/\{\{CONTACT_EMAIL\}\}/g, data.email || '');
  html = html.replace(/\{\{YEAR\}\}/g, new Date().getFullYear().toString());
  // Individual image slots
  for (let i = 1; i <= 20; i++) {
    html = html.replace(new RegExp(`\\{\\{IMAGE_${i}\\}\\}`, 'g'), images[i - 1] || '');
  }
  html = html.replace(/\{\{IMAGE_SIDE_A\}\}/g, images[1] || images[0] || '');
  html = html.replace(/\{\{IMAGE_SIDE_B\}\}/g, images[2] || images[0] || '');
  html = html.replace(/\{\{IMAGE_6\}\}/g, images[5] || images[0] || '');
  html = html.replace(/\{\{AMENITIES\}\}/g, '');
  html = html.replace(/\{\{ACTIVITIES\}\}/g, '');
  html = html.replace(/\{\{LOCAL_AREA\}\}/g, '');
  html = html.replace(/\{\{GETTING_THERE\}\}/g, '');
  html = html.replace(/\{\{BRAND_COLOR\}\}/g, '#C47756');
  html = html.replace(/\{\{PROPERTY_ID\}\}/g, '');
  html = html.replace(/\{\{SLUG\}\}/g, slug);
  return html;
}

// ─────────────────────────────────────────────
// STEP 3a — Create Supabase records via Edge Function (Button 1: Save Site)
// ─────────────────────────────────────────────
export async function createNewSiteRecords(data: NewSiteData): Promise<{
  propertyId: string;
  siteUrl: string;
  slug: string;
}> {
  const slug = data.slug || createSlug(data.websiteName);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  console.log('[createNewSiteRecords] INPUT slug:', data.slug, '-> final slug:', slug);
  console.log('[createNewSiteRecords] INPUT websiteName:', data.websiteName);
  console.log('[createNewSiteRecords] INPUT scrapedData.title:', data.scrapedData?.title);
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(`Supabase env not configured: VITE_SUPABASE_URL=${supabaseUrl}, VITE_SUPABASE_ANON_KEY=${supabaseAnonKey}`);
  }

  let res;
  // Strip leading @ to avoid double-@ in stored name (e.g. @RavesnworthA1 → @ravesnwortha1)
  const websiteNameClean = (data.websiteName || '').replace(/^@+/, '');
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/save-site-records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        // title: user's typed Website Name field — NOT scraped raw title
        title: data.websiteName,
        // propertyTitle: user's Property Headline field — the sentence they typed or saw in preview
        propertyTitle: data.propertyHeadline || data.scrapedData?.title || data.websiteName,
        propertyHeadline: data.propertyHeadline || '',
        name: websiteNameClean ? `@${websiteNameClean.toLowerCase().replace(/\s+/g, '')}` : `@${slug}`,
        slug,
        // description: user's edited Property Description field — NOT the raw scrape copy
        description: data.websiteDesc || data.scrapedData?.description,
        location: data.scrapedData?.location || '',
        maxGuests: data.scrapedData?.guests || 8,
        bedrooms: data.scrapedData?.bedrooms || 2,
        beds: data.scrapedData?.beds || 3,
        baths: data.scrapedData?.baths || 1,
        pricePerNight: data.scrapedData?.price
          ? parseFloat(data.scrapedData.price.replace(/[^0-9.]/g, ''))
          : 150,
        heroImage: data.scrapedData?.hero_image || '',
        images: data.scrapedData?.images || [],
        stripeAccountId: data.userStripeAccountId || null,
        stripeAccountStatus: data.userStripeAccountId ? 'active' : null,
        userId: data.userId,
      }),
    });
    const result = await res.json();
    if (!res.ok || result.error) {
      throw new Error(`Property insert failed: ${result.error || res.statusText}`);
    }
    const { propertyId } = result;
    return { propertyId, siteUrl: `https://www.propbook.pro/props/${slug}`, slug };
  } catch (err) {
    console.error('[createNewSiteRecords] Error:', err);
    throw err;
  }
}

// ─────────────────────────────────────────────
// STEP 3b — Push HTML to Hostinger + activate site (Button 2: Go Live)
// ─────────────────────────────────────────────
export async function goLiveSite(propertyId: string, slug: string, html: string): Promise<string> {
  const hostingerDir = `/home/u805830916/domains/propbook.pro/public_html/props/${slug}`;

  const mkdirRes = await new Promise<string>((resolve, reject) => {
    const { exec } = require('child_process');
    const cmd = `sshpass -p 'Clawbot12!' ssh -o StrictHostKeyChecking=no -p 65002 u805830916@82.29.86.252 "mkdir -p '${hostingerDir}' && echo DIR_OK"`;
    exec(cmd, (err: Error | null, stdout: string, stderr: string) => {
      if (err) reject(new Error(`mkdir SSH failed: ${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
  console.log('[goLive] mkdir:', mkdirRes);

  const sftpCmd = `sshpass -p 'Clawbot12!' sftp -o StrictHostKeyChecking=no -P 65002 u805830916@82.29.86.252 <<'SFTP_EOF'\nput /dev/stdin "${hostingerDir}/index.html"\nbye\nSFTP_EOF`;

  await new Promise<void>((resolve, reject) => {
    const { exec: exec2 } = require('child_process');
    const p = exec2(sftpCmd);
    if (!p.stdin) { reject(new Error('No stdin')); return; }
    p.stdin.write(html, (err: Error | null) => {
      if (err) { reject(err); return; }
      p.stdin.end();
    });
    let stderr = '';
    p.stderr?.on('data', (d: string) => (stderr += d));
    p.on('close', (code: number) => {
      if (code !== 0) reject(new Error(`SFTP write failed: ${stderr}`));
      else resolve();
    });
  });
  console.log('[goLive] HTML written');

  await supabaseAdmin
    .from('properties')
    .update({
      status: 'active',
      site_url: `https://www.propbook.pro/props/${slug}`,
      server_ip: '82.29.86.252',
      folder_path: hostingerDir,
    })
    .eq('id', propertyId);

  console.log(`[goLive] Site live: https://www.propbook.pro/props/${slug}`);
  return `https://www.propbook.pro/props/${slug}`;
}

// ─────────────────────────────────────────────
// STEP 4 (React) — Deploy React template to Hostinger
// Reads template files from the app origin, injects config, pushes via SFTP
// ─────────────────────────────────────────────
export async function deployReactTemplate(
  propertyId: string,
  slug: string,
  supabaseUrl: string,
  supabaseAnonKey: string
): Promise<string> {
  const hostingerDir = `/home/u805830916/domains/propbook.pro/public_html/props/${slug}`;
  const siteUrl = `https://www.propbook.pro/props/${slug}`;
  const githubRawBase = 'https://raw.githubusercontent.com/millymollison-stack/surfhousebaja/main/src/public/template';

  console.log(`[deployReactTemplate] 🚀 Deploying React template for slug=${slug}`);

  // 1. Ensure directory exists on Hostinger
  await new Promise<void>((resolve, reject) => {
    const { exec } = require('child_process');
    const cmd = `sshpass -p 'Clawbot12!' ssh -o StrictHostKeyChecking=no -p 65002 u805830916@82.29.86.252 "mkdir -p '${hostingerDir}' && echo DIR_OK"`;
    exec(cmd, (err: Error | null, stdout: string, stderr: string) => {
      if (err) reject(new Error(`mkdir SSH failed: ${stderr || err.message}`));
      else resolve();
    });
  });

  // 2. Fetch template files from GitHub raw content (always available after push)
  const [indexHtml, appJs, stylesCss] = await Promise.all([
    fetch(`${githubRawBase}/index.html`).then(r => { if (!r.ok) throw new Error('index.html not found in GitHub'); return r.text(); }),
    fetch(`${githubRawBase}/app.js`).then(r => { if (!r.ok) throw new Error('app.js not found in GitHub'); return r.text(); }),
    fetch(`${githubRawBase}/styles.css`).then(r => { if (!r.ok) throw new Error('styles.css not found in GitHub'); return r.text(); }),
  ]);

  // 3. Inject config into index.html
  const configuredHtml = indexHtml
    .replace('{{SUPABASE_URL}}', supabaseUrl)
    .replace('{{SUPABASE_ANON_KEY}}', supabaseAnonKey)
    .replace('{{PROPERTY_SLUG}}', slug);

  // 4. Push all 3 files via SFTP
  const sftpCmd = `sshpass -p 'Clawbot12!' sftp -o StrictHostKeyChecking=no -P 65002 u805830916@82.29.86.252 <<'SFTP_EOF'
put /dev/stdin "${hostingerDir}/index.html"
put /dev/stdin "${hostingerDir}/app.js"
put /dev/stdin "${hostingerDir}/styles.css"
bye
SFTP_EOF`;

  await new Promise<void>((resolve, reject) => {
    const { exec: exec2 } = require('child_process');
    const p = exec2(sftpCmd);
    if (!p.stdin) { reject(new Error('No stdin')); return; }
    // Write index.html, app.js, styles.css sequentially
    p.stdin.write(configuredHtml, (err: Error | null) => {
      if (err) { reject(err); return; }
    });
    p.stdin.write(appJs, (err: Error | null) => {
      if (err) { reject(err); return; }
    });
    p.stdin.write(stylesCss, (err: Error | null) => {
      if (err) { reject(err); return; }
    });
    p.stdin.end();
    let stderr = '';
    p.stderr?.on('data', (d: string) => (stderr += d));
    p.on('close', (code: number) => {
      if (code !== 0) reject(new Error(`SFTP write failed: ${stderr}`));
      else resolve();
    });
  });

  console.log('[deployReactTemplate] ✅ All files written to Hostinger');

  // 5b. Chmod to 644 so LiteSpeed web server can serve them
  await new Promise<void>((resolve, reject) => {
    const { exec } = require('child_process');
    const cmd = `sshpass -p 'Clawbot12!' ssh -o StrictHostKeyChecking=no -p 65002 u805830916@82.29.86.252 "chmod 644 '${hostingerDir}/index.html' '${hostingerDir}/app.js' '${hostingerDir}/styles.css' && echo CHMOD_OK"`;
    exec(cmd, (err: Error | null, _stdout: string, stderr: string) => {
      if (err) reject(new Error(`chmod failed: ${stderr || err.message}`));
      else resolve();
    });
  });
  console.log('[deployReactTemplate] ✅ File permissions set to 644');

  // 5. Update property record
  await supabaseAdmin
    .from('properties')
    .update({
      status: 'active',
      site_url: siteUrl,
      server_ip: '82.29.86.252',
      folder_path: hostingerDir,
    })
    .eq('id', propertyId);


  console.log(`[deployReactTemplate] ✅ Site live: ${siteUrl}`);
  return siteUrl;
}

// ─────────────────────────────────────────────
// STEP 4 — Deploy to Hostinger via edge function
// Calls deploy-site edge function which triggers deploy-react-upload.php
// on Hostinger (which SSHs to Mac Mini to run deploy-react-property.mjs).
// Falls back to browser-based upload via upload.php + CDN React bundle
// if the edge function signals needsBrowserDeploy.
// ─────────────────────────────────────────────
export async function duplicateSiteAfterPayment(
  slug: string,
  propertyId: string,
  seoFileToggles?: SeoFileToggles
): Promise<{ slug: string; propertyId: string; deployUrl: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const siteUrl = `https://www.propbook.pro/props/${slug}`;
  const DEPLOY_SECRET = 'propbook-deploy-2026';
  const UPLOAD_PHP_URL = 'https://www.propbook.pro/upload.php';

  console.log('[duplicateSiteAfterPayment] 🚀 Deploying clean SPA for slug:', slug);

  // Step 1: Get property data from Supabase
  const { data: prop } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .single();

  if (!prop) throw new Error('Property not found');

  // Step 2: Use the embedded SPA template (avoids CORS when deploying from browser)
  let spaHtml = SPA_TEMPLATE;

  // Step 3: Replace SEO meta tag tokens in the template
  const pageTitle = (prop as any).custom_page_title || prop.name || prop.title || slug;
  const metaDesc = (prop as any).meta_description || (prop.description || '').slice(0, 160);
  const ogTitle = (prop as any).custom_page_title || (prop as any).property_headline || prop.name || prop.title || '';
  const ogDesc = (prop as any).meta_description || (prop.description || '').slice(0, 200);
  const ogImage = (prop as any).og_image_url || prop.hero_image || '';
  const canonicalUrl = siteUrl;
  const noindexTag = (prop as any).robots_noindex
    ? '<meta name="robots" content="noindex, nofollow" />'
    : '';
  const googleVerifyTag = (prop as any).google_verification
    ? `<meta name="google-site-verification" content="${(prop as any).google_verification}" />`
    : '';

  spaHtml = spaHtml.replace(/\{\{PAGE_TITLE\}\}/g, pageTitle);
  spaHtml = spaHtml.replace(/\{\{META_DESCRIPTION\}\}/g, metaDesc);
  spaHtml = spaHtml.replace(/\{\{OG_TITLE\}\}/g, ogTitle);
  spaHtml = spaHtml.replace(/\{\{OG_DESCRIPTION\}\}/g, ogDesc);
  spaHtml = spaHtml.replace(/\{\{OG_IMAGE\}\}/g, ogImage);
  spaHtml = spaHtml.replace(/\{\{CANONICAL_URL\}\}/g, canonicalUrl);
  spaHtml = spaHtml.replace(/\{\{NOINDEX\}\}/g, noindexTag);
  spaHtml = spaHtml.replace(/\{\{GOOGLE_VERIFY\}\}/g, googleVerifyTag);

  // Step 4: Inject window.__PROPERTY_DATA__ for instant first render
  // This gives CustomerSite.tsx the fast-path data without a Supabase round-trip
  const propertyData = {
    id: prop.id,
    slug: prop.slug || slug,
    title: prop.title || prop.name || slug,
    name: prop.name || prop.title || '',
    description: prop.description || '',
    property_title: (prop as any).property_title || prop.title || null,
    property_headline: (prop as any).property_headline || (prop as any).property_title || prop.title || null,
    property_intro: (prop as any).property_intro || '',
    hero_image: prop.hero_image || '',
    images: prop.images || [],
    address: prop.address || '',
    location: prop.location || prop.address || '',
    bedrooms: prop.bedrooms ?? null,
    beds: prop.beds ?? null,
    bathrooms: prop.bathrooms ?? null,
    max_guests: prop.max_guests ?? null,
    price_per_night: prop.price_per_night ?? null,
    rating: prop.rating ?? null,
    reviews: prop.reviews ?? null,
    brand_color: (prop as any).brand_color || null,
    font_accent: (prop as any).font_accent || null,
    property_details: (prop as any).property_details || null,
    activities: (prop as any).activities || null,
    local_area: (prop as any).local_area || null,
    getting_there: (prop as any).getting_there || null,
    host_name: (prop as any).host_name || null,
    email: prop.email || null,
    owner_id: prop.owner_id || null,
  };

  const dataScript = `<script>window.__PROPERTY_DATA__ = ${JSON.stringify(propertyData)};<\/script>`;
  // Inject before <head> so it executes before React module loads
  // Inject after </head> so script executes before React module
  spaHtml = spaHtml.replace('</head>', `${dataScript}</head>`);
  // Remove any placeholder body script tag entirely — the real data is now in <head>
  // This avoids double-assignment where the body script overwrites the <head> data with the string '__PROPERTY_DATA__'
  spaHtml = spaHtml.replace(/<script>window\.__PROPERTY_DATA__\s*=\s*'__PROPERTY_DATA__';?<\/script>/g, '');

  // ── Build SEO files ─────────────────────────────────────────────────────
  const encodeBase64 = (str: string) => btoa(unescape(encodeURIComponent(str)));
  const toggles: SeoFileToggles = {
    generate_robots_txt: true,
    generate_sitemap_xml: true,
    generate_llms_txt: true,
    generate_faq_ai_txt: true,
    ...seoFileToggles,
  };
  const seoFiles: Record<string, string> = {};
  if (toggles.generate_robots_txt) { try { seoFiles['robots.txt'] = generateRobotsTxt(slug, siteUrl); } catch {} }
  if (toggles.generate_sitemap_xml) {
    try { const d: PropertySeoData = { title: prop.title||prop.name||slug, description: prop.description||'', address: prop.address||'', location: (prop as any).location||prop.address||'', bedrooms: prop.bedrooms??null, beds: prop.beds??null, bathrooms: prop.bathrooms??null, max_guests: prop.max_guests??null, price_per_night: prop.price_per_night??null, images: prop.images||[], slug, site_url: siteUrl }; seoFiles['sitemap.xml'] = generateSitemapXml(d); } catch {}
  }
  if (toggles.generate_llms_txt) {
    try { const d: PropertySeoData = { title: prop.title||prop.name||slug, description: prop.description||'', address: prop.address||'', location: (prop as any).location||prop.address||'', bedrooms: prop.bedrooms??null, beds: prop.beds??null, bathrooms: prop.bathrooms??null, max_guests: prop.max_guests??null, price_per_night: prop.price_per_night??null, images: prop.images||[], slug, site_url: siteUrl }; seoFiles['llms.txt'] = generateLlmsTxt(d); } catch {}
  }
  if (toggles.generate_faq_ai_txt) {
    try { const d: PropertySeoData = { title: prop.title||prop.name||slug, description: prop.description||'', address: prop.address||'', location: (prop as any).location||prop.address||'', bedrooms: prop.bedrooms??null, beds: prop.beds??null, bathrooms: prop.bathrooms??null, max_guests: prop.max_guests??null, price_per_night: prop.price_per_night??null, images: prop.images||[], slug, site_url: siteUrl }; seoFiles['faq-ai.txt'] = generateFaqAiTxt(d); } catch {}
  }

  // Step 4: Route through deploy-site edge function (server-side, no CORS)
  // The edge function calls upload.php internally, bypassing the browser CORS restriction
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  // Bundles are pre-deployed on the server at /dev/assets/index.js and /dev/assets/index.css
  const bundleFiles: Record<string, string> = {};

  const deployRes = await fetch(`${supabaseUrl}/functions/v1/deploy-site`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      propertyId,
      slug,
      prebuiltHtml: encodeBase64(spaHtml),
      seoFiles: Object.fromEntries(Object.entries(seoFiles).map(([k, v]) => [k, encodeBase64(v)])),
      bundles: bundleFiles,
    }),
  });

  if (!deployRes.ok) {
    const text = await deployRes.text().catch(() => deployRes.statusText);
    throw new Error(`deploy-site HTTP ${deployRes.status}: ${text}`);
  }
  const deployData = await deployRes.json();
  if (!deployData.success) throw new Error(`Deploy failed: ${deployData.error || 'unknown'}`);

  console.log(`[duplicateSiteAfterPayment] ✅ Deployed via ${deployData.deployed_via} — ${deployData.siteUrl}`);
  return { slug, propertyId, deployUrl: deployData.siteUrl || siteUrl };
}

export async function sendNewSiteEmail(data: NewSiteData, siteUrl: string): Promise<void> {
  try {
    await supabase.functions.invoke('send-booking-email', {
      body: {
        type: 'new_site_created',
        user: { email: data.email, full_name: data.websiteName },
        property: { title: data.scrapedData?.title || data.websiteName },
        booking: null,
        adminEmail: data.bookingsEmail || data.email,
        adminName: data.websiteName,
        siteUrl,
        message: `Your site is live at: ${siteUrl}`,
      },
    });
  } catch (err) {
    console.warn('Confirmation email error:', err);
  }
}
