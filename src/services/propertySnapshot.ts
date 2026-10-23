/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROPERTY DATA SNAPSHOT — the ONE place that reads a property for publishing.
 * ═════════════════════════════════════════════════════════
 *
 * David, 2026-09-22. Read this before touching anything related to what a
 * published property page shows.
 *
 * THE RULE: the database is the only source of truth. A property page is a
 * REPUBLISHABLE VIEW of the database, not a place with its own separate
 * memory. Every property page loads instantly from a JSON blob baked into
 * its HTML at publish time (`window.__PROPERTY_DATA__` — see
 * `injectPropertyDataIntoHtml` below), and that blob must always be exactly
 * what a fresh, complete read of the database says right now. Two bugs this
 * session both came from breaking that rule:
 *
 *   1. Home.tsx's own hand-rolled reconstruction of the baked object forgot
 *      to read `property_headline` at all — so the owner's own site kept
 *      showing the @handle instead of their real headline, forever, no
 *      matter how many times they saved it.
 *   2. The publish function's baked `images` list came from the legacy
 *      `properties.images` text array instead of the `property_images`
 *      table (the real source of truth for image order + is_background /
 *      is_featured / is_main flags), so a background image picked in the
 *      gallery would vanish again on the very next republish.
 *
 * Both happened because "what goes into a published page" was scattered —
 * partially hand-built in `siteDuplicationService.ts`, partially
 * re-hand-built in `Home.tsx`, partially re-hand-built again in
 * `CustomerSite.tsx`. Nothing forced those three copies to agree, so they
 * quietly drifted apart. This file exists to stop that from happening again.
 *
 * HOW TO USE THIS FILE:
 *
 *   - Publishing a property (Publish / Go Live button)? Call
 *     `fetchPropertyDataSnapshot(propertyId)` to get a complete, fresh read
 *     of that property (and its images) from the database, then
 *     `injectPropertyDataIntoHtml(html, snapshot, siteUrl)` to bake it into
 *     the page. Do NOT hand-build the `window.__PROPERTY_DATA__` object
 *     anywhere else. `siteDuplicationService.ts`'s `duplicateSiteAfterPayment`
 *     is the one real caller today.
 *
 *   - Reading `window.__PROPERTY_DATA__` on the client (Home.tsx,
 *     CustomerSite.tsx's fast paths)? Treat it as a `PropertyDataSnapshot`
 *     (import the type from here) so a missing field is at least visible in
 *     one place, and read `propertyImages` (not just the flat `images`
 *     array) if you need is_background/is_featured/is_main — a freshly
 *     republished page already has the right flags baked in, no follow-up
 *     fetch required.
 *
 *   - Adding a new property field that a published page should show? Add it
 *     to `PropertyDataSnapshot` below, map it in
 *     `fetchPropertyDataSnapshot()`, and grep the codebase for
 *     `__PROPERTY_DATA__` to update every reader. Three places, every time,
 *     no exceptions — that grep is cheap; a silently-stale field is not.
 *
 *   - Note this is a NECESSARY but not SUFFICIENT fix for staleness: this
 *     file guarantees a *republish* bakes a fully-fresh snapshot. It does
 *     NOT make an ordinary edit (save headline, toggle a background image)
 *     retroactively update an already-published page's baked HTML — that
 *     would require regenerating the HTML on every single field edit, which
 *     nobody has asked for. What already-published pages do instead is a
 *     background correction fetch on load (see the "David 2026-09-22:
 *     window.__PROPERTY_DATA__ is baked..." comments in Home.tsx and
 *     CustomerSite.tsx) — that's the belt to this file's suspenders.
 */

import { supabase } from '../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────

export interface PropertyImageSnapshot {
  id: string;
  url: string;
  position: number;
  is_featured: boolean;
  is_main: boolean;
  is_background: boolean;
}

export interface PropertyDataSnapshot {
  id: string;
  slug: string;
  title: string;
  name: string;
  description: string;
  property_title: string | null;
  property_headline: string | null;
  property_intro: string | null;
  hero_image: string;
  /** Flat, ordered URL list — kept for back-compat with existing readers. */
  images: string[];
  /** Full property_images rows, in order — the real source of truth for
   *  which images are featured/main/background. Prefer this over `images`
   *  for anything that needs to know WHICH image is which. */
  propertyImages: PropertyImageSnapshot[];
  address: string;
  location: string;
  bedrooms: number | null;
  beds: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  price_per_night: number | null;
  rating: number | null;
  reviews: number | null;
  brand_color: string | null;
  font_accent: string | null;
  property_details: string | null;
  activities: string | null;
  local_area: string | null;
  getting_there: string | null;
  amenities: string[] | null;
  host_name: string | null;
  email: string | null;
  owner_id: string | null;
  // SEO fields (sidebar's SEO section)
  custom_page_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
  google_business_url: string | null;
  robots_noindex: boolean | null;
  google_verification: string | null;
}

// ── The single read ─────────────────────────────────────────────────────

/**
 * Fetches EVERYTHING a published property page needs, straight from the
 * database, right now. No sessionStorage, no caller-supplied overrides, no
 * "trust what we already have in memory" — a full `properties` row plus the
 * full ordered `property_images` rows. This is deliberately the only
 * function in the codebase allowed to build a `PropertyDataSnapshot`.
 *
 * Throws if the property can't be found — publishing a property that
 * doesn't exist is a bug worth surfacing loudly, not a reason to bake an
 * empty page.
 */
export async function fetchPropertyDataSnapshot(propertyId: string): Promise<PropertyDataSnapshot> {
  const [{ data: prop, error: propErr }, { data: imgRows, error: imgErr }] = await Promise.all([
    supabase.from('properties').select('*').eq('id', propertyId).single(),
    supabase.from('property_images').select('*').eq('property_id', propertyId).order('position'),
  ]);

  if (propErr || !prop) {
    throw new Error(`fetchPropertyDataSnapshot: could not load property ${propertyId}: ${propErr?.message || 'not found'}`);
  }
  if (imgErr) {
    // Images failing to load isn't a reason to abort a publish -- fall back
    // to the legacy properties.images array below, same as every existing
    // reader already does when property_images has zero rows.
    console.warn(`fetchPropertyDataSnapshot: property_images fetch failed for ${propertyId}:`, imgErr.message);
  }

  const propertyImages: PropertyImageSnapshot[] = (imgRows || []).map((row: any) => ({
    id: row.id,
    url: row.url,
    position: row.position,
    is_featured: !!row.is_featured,
    is_main: !!row.is_main,
    is_background: !!row.is_background,
  }));

  // property_images is the source of truth once a property has rows in it
  // (real ids + is_featured/is_main/is_background flags). Only fall back to
  // the legacy properties.images text array when it has none yet -- e.g. an
  // Airbnb-scraped site whose images haven't been promoted into the table
  // (see CustomerSite.tsx's handleImageUpdate for that promotion path).
  const images = propertyImages.length > 0
    ? propertyImages.map(img => img.url)
    : (prop.images || []);

  return {
    id: prop.id,
    slug: prop.slug || '',
    title: prop.title || prop.name || '',
    name: prop.name || prop.title || '',
    description: prop.description || '',
    property_title: prop.property_title ?? null,
    // property_headline is THE canonical headline field (see the
    // consolidation work elsewhere this session) -- property_title and
    // title are fallbacks only, for a property that predates it.
    property_headline: prop.property_headline ?? prop.property_title ?? prop.title ?? null,
    property_intro: prop.property_intro || '',
    hero_image: prop.hero_image || images[0] || '',
    images,
    propertyImages,
    address: prop.address || '',
    location: prop.address || '',
    bedrooms: prop.bedrooms ?? null,
    beds: prop.beds ?? null,
    bathrooms: prop.bathrooms ?? null,
    max_guests: prop.max_guests ?? null,
    price_per_night: prop.price_per_night ?? null,
    rating: prop.rating ?? null,
    reviews: prop.reviews ?? null,
    brand_color: prop.brand_color ?? null,
    font_accent: prop.font_accent ?? null,
    property_details: prop.property_details ?? null,
    activities: prop.activities ?? null,
    local_area: prop.local_area ?? null,
    getting_there: prop.getting_there ?? null,
    amenities: prop.amenities ?? null,
    host_name: prop.host_name ?? null,
    email: prop.email ?? null,
    owner_id: prop.owner_id ?? null,
    custom_page_title: prop.custom_page_title ?? null,
    meta_description: prop.meta_description ?? null,
    og_image_url: prop.og_image_url ?? null,
    google_business_url: prop.google_business_url ?? null,
    robots_noindex: prop.robots_noindex ?? null,
    google_verification: prop.google_verification ?? null,
  };
}

// ── Baking the snapshot into HTML ───────────────────────────────────────

/**
 * Bakes a PropertyDataSnapshot into a property's static HTML: fills in the
 * {{TOKEN}} SEO placeholders and injects `window.__PROPERTY_DATA__` before
 * `</head>` so it's available before the React bundle mounts. The HTML
 * template itself (SPA_TEMPLATE in siteDuplicationService.ts) is fine as-is
 * -- this only owns the data that goes INTO it.
 */
export function injectPropertyDataIntoHtml(html: string, snapshot: PropertyDataSnapshot, siteUrl: string): string {
  const pageTitle = snapshot.custom_page_title || snapshot.name || snapshot.title || snapshot.slug;
  const metaDesc = snapshot.meta_description || (snapshot.description || '').slice(0, 160);
  const ogTitle = snapshot.custom_page_title || snapshot.property_headline || snapshot.name || snapshot.title || '';
  const ogDesc = snapshot.meta_description || (snapshot.description || '').slice(0, 200);
  const ogImage = snapshot.og_image_url || snapshot.hero_image || '';
  const noindexTag = snapshot.robots_noindex
    ? '<meta name="robots" content="noindex, nofollow" />'
    : '';
  const googleVerifyTag = snapshot.google_verification
    ? `<meta name="google-site-verification" content="${snapshot.google_verification}" />`
    : '';

  let out = html;
  out = out.replace(/\{\{PAGE_TITLE\}\}/g, pageTitle);
  out = out.replace(/\{\{META_DESCRIPTION\}\}/g, metaDesc);
  out = out.replace(/\{\{OG_TITLE\}\}/g, ogTitle);
  out = out.replace(/\{\{OG_DESCRIPTION\}\}/g, ogDesc);
  out = out.replace(/\{\{OG_IMAGE\}\}/g, ogImage);
  out = out.replace(/\{\{CANONICAL_URL\}\}/g, siteUrl);
  out = out.replace(/\{\{NOINDEX\}\}/g, noindexTag);
  out = out.replace(/\{\{GOOGLE_VERIFY\}\}/g, googleVerifyTag);

  const dataScript = `<script>window.__PROPERTY_DATA__ = ${JSON.stringify(snapshot).replace(/</g, '\\u003c')};<\/script>`;
  // Inject before </head> so it executes before the React module loads.
  out = out.replace('</head>', `${dataScript}</head>`);
  // Remove the template's placeholder body script entirely -- the real data
  // is now in <head>. Without this, the body placeholder would overwrite the
  // <head> data with the literal string '__PROPERTY_DATA__'.
  out = out.replace(/<script>window\.__PROPERTY_DATA__\s*=\s*'__PROPERTY_DATA__';?<\/script>/g, '');
  return out;
}
