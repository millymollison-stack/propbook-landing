/**
 * SiteDuplicationService — creates a new customer site after Stripe payment
 *
 * TWO-BUTTON PUBLISH FLOW:
 *
 *  Button 1 — "Save Site"
 *    → createNewSiteRecords() — creates property + profile + onboarding records
 *    → status: 'draft', site_url: null — NOT live yet
 *    → Stripe Connect account wired to property so booking payments route correctly
 *
 *  Button 2 — "Go Live"
 *    → generateSiteHtml() — replaces {{PLACEHOLDER}} tokens with scraped data
 *    → rsyncToHostinger() — copies generated HTML to Hostinger /props/{slug}/
 *    → marks property status: 'active', site_url set — site is now live
 *
 * Hostinger SSH: u805830916@82.29.86.252 port 65002
 */

import { BUNDLE_VERSION } from './bundle-versions';

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
}

export interface NewSiteData {
  email: string;
  userId: string;
  userStripeAccountId?: string | null;
  bookingsEmail: string;
  websiteName: string;
  websiteDesc: string;
  propertyTitle: string;  // headline — replaces {{PROPERTY_TITLE}} in template
  slug?: string;  // optional explicit slug — if not provided, one is generated from websiteName
  propertyId?: string;  // set at publish time so React app can use it immediately
  planChoice: 'starter' | 'pro' | 'agency';
  hostingChoice: 'our' | 'own';
  extras: { seo: boolean; ads: boolean; analytics: boolean; social: boolean };
  scrapedData: ScrapedData | null;
  designChoice: string;
  bankChoice: string;
  brand_color?: string | null;
  font_accent?: string | null;
  // SEO fields fetched at publish time from Supabase
  seoData?: {
    meta_description?: string;
    og_image_url?: string;
    google_business_url?: string;
    robots_noindex?: boolean;
    custom_page_title?: string;
    google_verification?: string;
  };
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
// ─────────────────────────────────────────────
export function generateSiteHtml(template: string, data: NewSiteData, _jsBundle?: string, _cssBundle?: string): string {
  const s = data.scrapedData;
  const price = s?.price ? s.price.replace(/[^0-9.]/g, '') : '150';
  const heroImage = s?.hero_image || '/template/surfhousebaja-main.jpg';
  const images = s?.images?.length
    ? s.images.map((img: string) => `<img src="${img}" alt="${s.title}" loading="lazy" />`).join('\n')
    : `<img src="${heroImage}" alt="${s?.title || data.websiteName}" loading="lazy" />`;

  return template
    .replace(/\{\{BRAND_NAME\}\}/g, data.websiteName)
    .replace(/\{\{TITLE\}\}/g, s?.title || data.websiteName)
    .replace(/\{\{LOCATION\}\}/g, s?.location || '')
    .replace(/\{\{PRICE\}\}/g, price)
    .replace(/\{\{DESCRIPTION\}\}/g, data.websiteDesc || s?.description || '')
    .replace(/\{\{HERO_IMAGE\}\}/g, heroImage)
    .replace(/\{\{IMAGES\}\}/g, images)
    .replace(/\{\{REVIEW_COUNT\}\}/g, String(s?.reviews ?? 0))
    .replace(/\{\{GUESTS\}\}/g, String(s?.guests ?? 8))
    .replace(/\{\{BEDROOMS\}\}/g, String(s?.bedrooms ?? 2))
    .replace(/\{\{BEDS\}\}/g, String(s?.beds ?? 3))
    .replace(/\{\{BATHS\}\}/g, String(s?.baths ?? 1))
    .replace(/\{\{RATING\}\}/g, String(s?.rating ?? '4.8'))
    .replace(/\{\{HOST_NAME\}\}/g, s?.host_name || 'Property Manager');
}

// ─────────────────────────────────────────────
// STATIC HTML — Generate the full template.html with ALL tokens filled
// This is the SEO-friendly static landing page with property data baked in.
// The React app for booking/editing is deployed alongside at /app/.
// ─────────────────────────────────────────────
export function generateTemplateHtml(template: string, data: NewSiteData, supabaseUrl?: string, supabaseAnonKey?: string, jsBundle?: string, builtAt?: string, cssBundle?: string): string {
  const s = data.scrapedData;
  const version = builtAt || '1'; // CDN cache-busting version

  // Primary images
  const img1 = s?.images?.[0] || s?.hero_image || '';
  const img2 = s?.images?.[1] || img1;
  const img3 = s?.images?.[2] || img1;
  const img4 = s?.images?.[3] || img1;
  const img5 = s?.images?.[4] || img1;
  const img6 = s?.images?.[5] || img1;

  // Price — strip non-numeric chars
  const pricePerNight = s?.price ? s.price.replace(/[^0-9.]/g, '') : '150';

  // Rating + reviews
  const rating = s?.rating?.toString() || '4.8';
  const reviewCount = String(s?.reviews ?? 0);

  // Property basics
  // User-edited values from popup fields take priority over raw scrape data
  const title = data.websiteName || s?.title || '';
  const address = s?.location || '';
  const propertyIntro = data.websiteDesc || s?.description || '';

  // Brand/contact (not in scraped data — use defaults)
  const contactEmail = data.email || 'hello@propbook.pro';
  const brandHandle = '@' + data.slug || '@property';
  const currentUrl = `https://www.propbook.pro/props/${data.slug}`;

  // Amenity list (parsed from description keywords if available)
  const bedrooms = String(s?.bedrooms ?? 2);
  const beds = String(s?.beds ?? 3);
  const baths = String(s?.baths ?? 1);
  const guests = String(s?.guests ?? 8);

  // These tokens exist in template.html but aren't in scraped data — use empty/default
  const gettingThere = '';
  const localArea = '';
  const latitude = '';
  const longitude = '';
  const amenitiesBgImage = img1; // reuse first image as ambient bg
  const reviewsBgImage = img2 || img1;
  const dropdownsBgImage = img3 || img1;

  // Property data for React app — baked into HTML so it loads instantly without Supabase fetch
  const propertyDataJson = JSON.stringify({
    id: data.propertyId || '',
    title,
    address,
    description: propertyIntro,
    hero_image: img1,
    images: [img1, img2, img3, img4, img5, img6].filter(Boolean),
    bedrooms,
    beds,
    bathrooms: baths,
    max_guests: guests,
    price_per_night: pricePerNight,
    rating,
    reviews: reviewCount,
    location: address,
    slug: data.slug,
    site_url: currentUrl,
    name: brandHandle,
  }).replace(/</g, '\\u003c');

  // SEO fields — user-configured takes priority, fall back to scraped data
  const seo = data.seoData || {};
  const metaDesc = seo.meta_description || propertyIntro.slice(0, 160);
  const ogImage = seo.og_image_url || img1;
  const robotsContent = seo.robots_noindex ? 'noindex, follow' : 'index, follow';
  const customTitle = seo.custom_page_title || `${title} | ${brandHandle}`;
  const googleVerif = seo.google_verification || '';
  const googleBusinessUrl = seo.google_business_url || '';

  // Full SEO meta tags — injected at <!--SEO_TAGS--> or after <title>
  const seoBlock = `
    <title>${customTitle}</title>
    ${googleVerif ? `<meta name="google-site-verification" content="${googleVerif}">` : ''}
    <meta name="description" content="${metaDesc}">
    <meta name="keywords" content="vacation rental,holiday home,${address},short term rental,Airbnb alternative">
    <meta name="robots" content="${robotsContent}">
    <link rel="canonical" href="${currentUrl}">
    <!-- Open Graph -->
    <meta property="og:type" content="website">
    <meta property="og:title" content="${customTitle}">
    <meta property="og:description" content="${metaDesc}">
    <meta property="og:url" content="${currentUrl}">
    <meta property="og:site_name" content="${brandHandle}">
    <meta property="og:image" content="${ogImage}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:locale" content="en_US">
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${customTitle}">
    <meta name="twitter:description" content="${metaDesc}">
    <meta name="twitter:image" content="${ogImage}">
    <meta name="twitter:site" content="@propbookpro">
    <!-- Product / Schema.org structured data -->
    <script type="application/ld+json">
${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "VacationRental",
      "name": title,
      "description": propertyIntro,
      "url": currentUrl,
      "image": [ogImage, img2, img3].filter(Boolean),
      "address": { "@type": "PostalAddress", "addressLocality": address },
      "geo": latitude && longitude ? { "@type": "GeoCoordinates", "latitude": parseFloat(latitude), "longitude": parseFloat(longitude) } : undefined,
      "numberOfRooms": parseInt(bedrooms) || undefined,
      "bedCount": parseInt(beds) || undefined,
      "amenityFeature": [
        { "@type": "LocationFeatureSpecification", "name": "Bedrooms", "value": parseInt(bedrooms) || 2 },
        { "@type": "LocationFeatureSpecification", "name": "Bathrooms", "value": parseInt(baths) || 1 },
        { "@type": "LocationFeatureSpecification", "name": "Max Guests", "value": parseInt(guests) || 8 },
      ],
      "aggregateRating": reviewCount !== '0' ? {
        "@type": "AggregateRating",
        "ratingValue": rating,
        "reviewCount": parseInt(reviewCount) || 0,
        "bestRating": "5",
      } : undefined,
      "priceRange": `$${pricePerNight}`,
      "telephone": contactEmail,
      ...(googleBusinessUrl ? { "url": googleBusinessUrl } : {}),
    }, null, 2)}
    </script>`;

  // Inject SEO tags at the placeholder, or after <title> if placeholder not present
  if (template.includes('<!--SEO_TAGS-->')) {
    template = template.replace('<!--SEO_TAGS-->', seoBlock);
  } else {
    // Fallback: inject after the <title> tag
    const titleTag = /<title>[^<]*<\/title>/i;
    if (titleTag.test(template)) {
      template = template.replace(titleTag, `$&\n    ${seoBlock.trim()}`);
    }
  }

  return template
    .replace(/\{\{TITLE\}\}/g, title)
    .replace(/\{\{ADDRESS\}\}/g, address)
    .replace(/\{\{PRICE_PER_NIGHT\}\}/g, pricePerNight)
    .replace(/\{\{PROPERTY_TITLE\}\}/g, data.propertyTitle || title)
    .replace(/\{\{PROPERTY_INTRO\}\}/g, propertyIntro)
    .replace(/\{\{DESCRIPTION\}\}/g, propertyIntro)
    .replace(/\{\{IMAGE_1\}\}/g, img1)
    .replace(/\{\{IMAGE_2\}\}/g, img2)
    .replace(/\{\{IMAGE_3\}\}/g, img3)
    .replace(/\{\{IMAGE_4\}\}/g, img4)
    .replace(/\{\{IMAGE_5\}\}/g, img5)
    .replace(/\{\{IMAGE_6\}\}/g, img6)
    .replace(/\{\{IMAGE_SIDE_A\}\}/g, img2 || img1)
    .replace(/\{\{IMAGE_SIDE_B\}\}/g, img3 || img1)
    .replace(/\{\{HERO_IMAGE\}\}/g, img1)
    .replace(/\{\{RATING\}\}/g, rating)
    .replace(/\{\{REVIEW_COUNT\}\}/g, reviewCount)
    .replace(/\{\{AMENITIES_BG_IMAGE\}\}/g, amenitiesBgImage)
    .replace(/\{\{REVIEWS_BG_IMAGE\}\}/g, reviewsBgImage)
    .replace(/\{\{DROPDOWNS_BG_IMAGE\}\}/g, dropdownsBgImage)
    .replace(/\{\{GETTING_THERE\}\}/g, gettingThere)
    .replace(/\{\{LOCAL_AREA\}\}/g, localArea)
    .replace(/\{\{CONTACT_EMAIL\}\}/g, contactEmail)
    .replace(/\{\{CURRENT_URL\}\}/g, currentUrl)
    .replace(/\{\{BRAND_HANDLE\}\}/g, brandHandle)
    .replace(/\{\{LATITUDE\}\}/g, latitude)
    .replace(/\{\{LONGITUDE\}\}/g, longitude)
    // Supabase config (for the React app that runs in static template)
    .replace(/\{\{SUPABASE_URL\}\}/g, supabaseUrl || import.meta.env.VITE_SUPABASE_URL || 'https://jtzagpbdrqfifdisxipr.supabase.co')
    .replace(/\{\{SUPABASE_ANON_KEY\}\}/g, supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || '')
    // Replace <!--APP_JS--> with minimal React shell.
    // - Bakes property data into window.__PROPERTY_DATA__ for instant render (no Supabase round-trip)
    // - Captures ?book=true and ?paid=true into sessionStorage before React mounts
    // - React bundle served from CDN so it works from any /props/{slug}/ path
    // - No hiding CSS needed — published page is React-only, no duplicate static sections
    .replace('<!--APP_JS-->', `<link rel="stylesheet" href="https://propbook.pro/props/_dev/${cssBundle || jsBundle?.replace(/\.js$/, '.css') || ''}?v=${BUNDLE_VERSION}">
<div id="root"><!-- React mounts here --></div>
<script>
window.__PROPERTY_DATA__ = ${propertyDataJson};
(function() {
  var params = new URLSearchParams(window.location.search);
  if (params.has('book')) {
    sessionStorage.setItem('scroll_to_booking', '1');
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  }
  if (params.has('paid') && params.has('session_id')) {
    sessionStorage.setItem('stripe_session_id', params.get('session_id'));
    sessionStorage.setItem('stripe_paid_flag', 'true');
    window.history.replaceState({}, '', window.location.pathname);
  }
})();
</script>
<script type="module" crossorigin src="https://propbook.pro/props/_dev/${jsBundle}?v=${version}"></script>`);
}

// David 2026-09-22: removed dead code here -- createNewSiteRecords(),
// duplicateSiteAfterPayment(), and sendNewSiteEmail() used to be duplicated in this
// file, but nothing imported them from here (only generateTemplateHtml() above is
// actually used from templateHelpers.ts -- confirmed via grep across src/).
// The live versions of all three are in src/services/siteDuplicationService.ts.
// A stale, unreachable duplicate like this is exactly the kind of thing that turns
// into a real bug the moment someone imports the wrong one by mistake -- see
// claude/stability-plan-2026-09-22.md.
