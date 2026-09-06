import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
};

const SOURCE_PROPERTY_ID = "efa8d280-afee-4971-9145-d591740f484d";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Support both POST (body.action) and GET (?action= in URL query string)
    // The edge function is called with ?action=get via GET from AdminSidebarBundle,
    // so we must extract action from URL search params for GET requests.
    let body: any = {};
    try {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('application/json') && req.method !== 'GET') {
        body = await req.json();
      }
    } catch {
      // Body may be empty or not JSON — that's OK for GET requests
    }

    // Extract action: POST uses body.action, GET uses URL query param
    const urlAction = new URL(req.url).searchParams.get('action');
    const action = body.action || urlAction;

    // Decode userId from the Authorization JWT header (works for both GET and POST)
    const authHeader = req.headers.get('Authorization') || '';
    let headerUserId: string | null = null;
    try {
      const token = authHeader.replace('Bearer ', '').split('.')[1];
      headerUserId = JSON.parse(atob(token))?.sub || null;
    } catch { /* ignore malformed token */ }

    // ── Handle get action FIRST (no userId/slug required) ───────────────────
    // Called by AdminSidebarBundle to get subscription status from the user's profile.
    if (action === 'get') {
      const userId = body.userId || headerUserId;
      if (!userId) throw new Error("No userId provided and no session found");

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_subscription_status, stripe_subscription_plan, stripe_subscription_id, stripe_customer_id, stripe_subscription_amount, stripe_subscription_interval, stripe_subscription_period_end')
        .eq('id', userId)
        .maybeSingle();

      if (!profile || !profile.stripe_subscription_status) {
        return new Response(JSON.stringify({ subscription: null }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({
        subscription: {
          id: profile.stripe_subscription_id,
          status: profile.stripe_subscription_status,
          plan: profile.stripe_subscription_plan,
          amount: profile.stripe_subscription_amount ?? 1000,
          interval: profile.stripe_subscription_interval ?? 'month',
          current_period_end: profile.stripe_subscription_period_end,
          customer_id: profile.stripe_customer_id,
        }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Handle get_session action (verify Stripe checkout payment) ───────────
    // No userId/slug required — just verify session_id with Stripe
    if (action === 'get_session') {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
      const sessionId = body.session_id;
      if (!sessionId) throw new Error("Missing required field: session_id");

      const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
        headers: { "Authorization": `Bearer ${stripeKey}` },
      });
      if (!stripeRes.ok) {
        const errText = await stripeRes.text();
        console.error("[stripe-subscription] Stripe retrieve error:", errText);
        throw new Error(`Stripe error: ${errText}`);
      }
      const session = await stripeRes.json();
      console.log(`[stripe-subscription] Session ${sessionId} status: ${session.status}`);

      return new Response(
        JSON.stringify({
          status: session.status,
          subscription: {
            status: session.subscription_status || 'active',
            id: session.subscription,
            customer_id: session.customer,
            amount_total: session.amount_total,
            currency: session.currency,
          },
          subscription_id: session.subscription,
          customer_id: session.customer,
          sub_status: session.subscription_status || 'active',
          amount_total: session.amount_total,
          currency: session.currency,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Actions below require userId + slug ───────────────────────────────────
    const userId = body.userId || body.user_id;
    const slug = body.slug;
    const propertyId = body.propertyId || body.property_id;
    if (!userId || !slug) {
      throw new Error("Missing required fields: userId, slug");
    }

    // ── Handle create_checkout_session action (Stripe checkout) ──────────────
    if (action === 'create_checkout_session') {
      console.log(`[stripe-subscription] Checkout for user=${userId}, slug=${slug}, plan=${body.plan || 'starter'}`);
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

      const plan = body.plan || 'starter';
      const priceId = plan === 'pro' ? 'price_1TfPfEK5ECFjIqP3XR3pnWBk'
        : plan === 'agency' ? 'price_1TfPi0K5ECFjIqP3vq3VucLv'
        : 'price_1TfPVpK5ECFjIqP3YR6XPpEG'; // starter default

      // Use the return_url from the frontend if provided, otherwise fall back to propbook.pro.
      // Stripe will redirect the browser to this URL after payment.
      // Also strip trailing slash to avoid double-slash (e.g. http://localhost:5174/ + /?paid=true → //?paid=true)
      const baseUrl = body.return_url
        ? body.return_url.replace(/\?.*$/, '').replace(/\/$/, '')
        : 'https://www.propbook.pro';
      const successUrl = `${baseUrl}/?paid=true&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/?step=cancelled`;

      // Build Stripe checkout session
      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          "success_url": successUrl,
          "cancel_url": cancelUrl,
          "mode": "subscription",
          "line_items[0][price]": priceId,
          "line_items[0][quantity]": "1",
          "customer_email": body.email || "",
          "metadata[user_id]": userId,
          "metadata[slug]": slug,
          "metadata[plan]": plan,
          "allow_promotion_codes": "true",
          "billing_address_collection": "auto",
        }).toString(),
      });

      if (!stripeRes.ok) {
        const errText = await stripeRes.text();
        console.error("[stripe-subscription] Stripe error:", errText);
        throw new Error(`Stripe error: ${errText}`);
      }

      const session = await stripeRes.json();
      console.log(`[stripe-subscription] Checkout session created: ${session.id}`);

      return new Response(
        JSON.stringify({ url: session.url, sessionId: session.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Handle deploy action (original flow) ─────────────────────────────────
    console.log(`[stripe-subscription] Deploy for user=${userId}, slug=${slug}`);

    // ── Step 1: Fetch source property ───────────────────────────────────────
    const { data: sourceProperty } = await supabase
      .from("properties")
      .select("*")
      .eq("id", SOURCE_PROPERTY_ID)
      .maybeSingle();

    if (!sourceProperty) throw new Error(`Source property ${SOURCE_PROPERTY_ID} not found`);

    // ── Step 2: Create or use existing property ──────────────────────────────
    let targetPropertyId = propertyId;

    if (!targetPropertyId) {
      const { data: newProp, error: createError } = await supabase
        .from("properties")
        .insert({
          title: sourceProperty.property_title || sourceProperty.title || 'Untitled Property',
          slug,
          owner_id: userId,
          description: sourceProperty.property_intro || sourceProperty.description || '',
          address: sourceProperty.address || '',
          max_guests: sourceProperty.max_guests || 8,
          bedrooms: sourceProperty.bedrooms || 2,
          bathrooms: sourceProperty.bathrooms || 1,
          beds: sourceProperty.beds || 3,
          price_per_night: sourceProperty.price_per_night || 150,
          hero_image: sourceProperty.hero_image || '',
          images: sourceProperty.images || [],
          property_details: sourceProperty.property_details || null,
          property_intro: sourceProperty.property_intro || null,
          activities: sourceProperty.activities || null,
          local_area: sourceProperty.local_area || null,
          getting_there: sourceProperty.getting_there || null,
          brand_color: sourceProperty.brand_color || '#C47756',
          font_accent: sourceProperty.font_accent || null,
          status: 'active',
        })
        .select("id")
        .single();

      if (createError) throw new Error(`Failed to create property: ${createError.message}`);
      targetPropertyId = newProp.id;
    }

    // ── Step 3: Copy images ──────────────────────────────────────────────────
    const { data: sourceImages } = await supabase
      .from("property_images")
      .select("*")
      .eq("property_id", SOURCE_PROPERTY_ID)
      .order("position");

    if (sourceImages && sourceImages.length > 0) {
      await supabase.from("property_images").delete().eq("property_id", targetPropertyId);
      const newImageRows = sourceImages.map((img: any, idx: number) => ({
        property_id: targetPropertyId,
        url: img.url,
        caption: img.caption || null,
        position: img.position || idx + 1,
        is_featured: idx === 0,
        is_main: idx === 0,
      }));
      await supabase.from("property_images").insert(newImageRows);
      console.log(`[stripe-subscription] Copied ${sourceImages.length} images`);
    }

    // ── Step 4: Fetch merged property ───────────────────────────────────────
    const { data: newProperty } = await supabase
      .from("properties")
      .select("*")
      .eq("id", targetPropertyId)
      .single();

    const { data: propertyImages } = await supabase
      .from("property_images")
      .select("url,position")
      .eq("property_id", targetPropertyId)
      .order("position");

    // ── Step 5: Render HTML ──────────────────────────────────────────────────
    const renderedHtml = await renderPropertyHtml(newProperty, propertyImages || []);
    console.log(`[stripe-subscription] Rendered: ${renderedHtml.length} bytes`);

    // ── Step 6: Upload to Hostinger via SSH heredoc ─────────────────────────
    const siteUrl = await uploadViaSSH(slug, renderedHtml);
    console.log(`[stripe-subscription] Uploaded to: ${siteUrl}`);

    // ── Step 7: Update property record ──────────────────────────────────────
    await supabase
      .from("properties")
      .update({ site_url: siteUrl, status: 'active' })
      .eq("id", targetPropertyId);

    console.log(`[stripe-subscription] ✅ Done: ${siteUrl}`);

    return new Response(
      JSON.stringify({ success: true, propertyId: targetPropertyId, siteUrl, slug }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[stripe-subscription] ❌ Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Render HTML ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseImages(imagesJson) {
  if (!imagesJson) return [];
  if (Array.isArray(imagesJson)) return imagesJson;
  try {
    const parsed = JSON.parse(imagesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function renderStars(rating) {
  const r = parseFloat(rating || 0);
  const full = Math.floor(r);
  const half = r - full >= 0.5;
  let html = '';
  for (let i = 0; i < 5; i++) {
    if (i < full) {
      html += '<svg viewBox="0 0 24 24" fill="#FBBF24" stroke="#FBBF24" stroke-width="1"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    } else if (i === full && half) {
      html += '<svg viewBox="0 0 24 24" fill="#FBBF24" stroke="#FBBF24" stroke-width="1"><defs><linearGradient id="h"><stop offset="50%" stop-color="#FBBF24"/><stop offset="50%" stop-color="transparent"/></linearGradient></defs><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="url(#h)"/></svg>';
    } else {
      html += '<svg viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="1"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    }
  }
  return html;
}

function renderAmenityIcon(name) {
  const icons: Record<string, string> = {
    'wifi': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>',
    'pool': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12c.6.5 1.2 1 2.5 1C7 13 7 11 9.5 11s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2c.6 0 1.2-.5 2.5-1"/><path d="M2 17c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2c.6 0 1.2-.5 2.5-1"/><path d="M2 7c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2c.6 0 1.2-.5 2.5-1"/></svg>',
    'kitchen': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 11h18M3 11v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M3 11l2-9h14l2 9M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    'ac': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707"/><circle cx="12" cy="12" r="4"/></svg>',
    'washer': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="6"/><path d="M3 12h18"/></svg>',
    'tv': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="15" rx="2"/><path d="M7 19h10M12 15v4"/></svg>',
    'parking': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>',
    'hot tub': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 16c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z"/><path d="M12 6v2M8 9h8M12 2v1M2 12h1M22 12h-1M4.22 4.22l.71.71M19.07 4.22l-.71.71M4.22 19.78l.71-.71M19.07 19.78l-.71-.71"/></svg>',
    'beach': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-3-3.87M3 21h18M9 9a3 3 0 1 1 6 0M9 9l-5 5"/><circle cx="12" cy="7" r="4"/></svg>',
    'surfboard': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l4 20-4-1-4 1 4-20z"/></svg>',
    'fire pit': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 21c-4 0-6-2-6-6 0-3 2-5 4-7 0 2 1 3 2 3s2-1 2-3c2 2 4 4 4 7 0 4-2 6-6 6z"/></svg>',
    'default': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>',
  };
  const key = Object.keys(icons).find(k => name.toLowerCase().includes(k));
  return icons[key] || icons['default'];
}

function renderAmenities(amenitiesStr) {
  if (!amenitiesStr) return '';
  let list;
  if (Array.isArray(amenitiesStr)) list = amenitiesStr;
  else if (typeof amenitiesStr === 'string') {
    try { list = JSON.parse(amenitiesStr); } catch { list = amenitiesStr.split(','); }
  } else { list = []; }
  if (!Array.isArray(list) || list.length === 0) return '';
  const badges = list.map(item =>
    `<div class="amenity-badge">${renderAmenityIcon(item)}<span>${escapeHtml(item)}</span></div>`
  ).join('');
  return `<div class="amenities-grid">${badges}</div>`;
}

function replaceToken(template, token, value) {
  const regex = new RegExp(`\\{\\{${token}\\}\\}`, 'g');
  return template.replace(regex, value !== undefined && value !== null ? String(value) : '');
}

async function renderPropertyHtml(property: any, propertyImages: any[]) {
  const templateUrl = 'https://raw.githubusercontent.com/millymollison-stack/surfhousebaja/main/src/public/template/template.html';
  const templateRes = await fetch(templateUrl);
  if (!templateRes.ok) throw new Error(`Failed to fetch template: ${templateRes.status}`);
  let html = await templateRes.text();

  const p = property;
  const slug = p.slug || 'property';
  const dbImageUrls = (propertyImages || []).map((img: any) => img.url).filter(Boolean);
  const brandColor = p.brand_color || '#C47756';
  const brandName = p.name || 'PropBook';
  const price = p.price_per_night || p.price || '0';
  const rating = parseFloat(p.rating || 0);
  const reviewCount = parseInt(p.reviews || p.review_count || 0, 10);
  const bedrooms = p.bedrooms || 0;
  const beds = p.beds || 0;
  const baths = p.bathrooms || p.baths || 0;
  const maxGuests = p.max_guests || 0;
  const title = p.title || 'Beach House';
  const address = p.address || '';
  const latitude = p.latitude || '30.861383';
  const longitude = p.longitude || '-116.167874';
  const description = p.description || '';
  // property_intro = full text; PROPERTY_INTRO template token = short teaser (first 50 chars or first sentence)
  const fullIntro = p.property_intro || description;
  const firstPeriod = fullIntro.indexOf('.');
  const propertyIntro = firstPeriod > 5 && firstPeriod < 100
    ? fullIntro.slice(0, firstPeriod + 1)        // first sentence if reasonably short
    : fullIntro.slice(0, 60) + (fullIntro[60] ? '...' : ''); // else first 60 chars
  const userEmail = body?.email || p.owner_id || '';
  const allImages = dbImageUrls.length > 0
    ? dbImageUrls
    : [heroImage, ...parseImages(p.images)].filter(Boolean);

  html = replaceToken(html, 'BRAND_NAME', brandName);
  html = replaceToken(html, 'BRAND_COLOR', brandColor);
  html = replaceToken(html, 'TITLE', title);
  html = replaceToken(html, 'ADDRESS', address);
  html = replaceToken(html, 'LATITUDE', latitude);
  html = replaceToken(html, 'LONGITUDE', longitude);
  html = replaceToken(html, 'PRICE_PER_NIGHT', price);
  html = replaceToken(html, 'DESCRIPTION', description);
  html = replaceToken(html, 'BEDROOMS', bedrooms);
  html = replaceToken(html, 'BEDS', beds);
  html = replaceToken(html, 'BATHROOMS', baths);
  html = replaceToken(html, 'MAX_GUESTS', maxGuests);
  html = replaceToken(html, 'RATING', rating.toFixed(1));
  html = replaceToken(html, 'REVIEW_COUNT', reviewCount.toString());
  html = replaceToken(html, 'HOST_NAME', hostName);
  html = replaceToken(html, 'AMENITIES', amenities);
  html = replaceToken(html, 'ACTIVITIES', activities);
  html = replaceToken(html, 'LOCAL_AREA', localArea);
  html = replaceToken(html, 'GETTING_THERE', gettingThere);
  html = replaceToken(html, 'PROPERTY_TITLE', propertyTitle);
  html = replaceToken(html, 'PROPERTY_INTRO', propertyIntro);
  html = replaceToken(html, 'SLUG', slug);
  html = replaceToken(html, 'BOOKING_URL', `https://www.propbook.pro/book/${slug}`);
  html = replaceToken(html, 'PROPERTY_ID', p.id || '');
  // Missing tokens — add these
  html = replaceToken(html, 'BRAND_HANDLE', slug);
  html = replaceToken(html, 'CONTACT_EMAIL', userEmail);
  html = replaceToken(html, 'YEAR', new Date().getFullYear().toString());
  html = replaceToken(html, 'IMAGE_SIDE_A', allImages[1] || allImages[0] || '');
  html = replaceToken(html, 'IMAGE_SIDE_B', allImages[2] || allImages[0] || '');
  html = replaceToken(html, 'IMAGE_6', allImages[5] || allImages[0] || '');

  for (let i = 1; i <= 20; i++) {
    html = replaceToken(html, `IMAGE_${i}`, allImages[i - 1] || '');
  }

  html = replaceToken(html, 'AMENITIES_BG_IMAGE', allImages[1] || allImages[0] || '');
  html = replaceToken(html, 'REVIEWS_BG_IMAGE', allImages[2] || allImages[0] || '');
  html = replaceToken(html, 'DROPDOWNS_BG_IMAGE', allImages[3] || allImages[0] || '');
  html = replaceToken(html, 'STAR_RATING_HTML', renderStars(rating));
  html = replaceToken(html, 'AMENITIES_HTML', renderAmenities(amenities));
  html = replaceToken(html, 'HERO_IMAGE', heroImage || allImages[0] || '');

  const metaDesc = description.slice(0, 160).replace(/\n/g, ' ').trim() || `${title} — vacation rental in ${address}`;
  html = replaceToken(html, 'META_DESCRIPTION', metaDesc);

  const bedroomCount = parseInt(String(bedrooms).match(/^\d+/)?.[0] || '0');
  const bedsCount = parseInt(String(beds).match(/^\d+/)?.[0] || '0');
  const bathsCount = parseInt(String(baths).match(/^\d+/)?.[0] || '0');
  const guestsCount = parseInt(String(maxGuests).match(/^\d+/)?.[0] || '0');

  html = html.replace(/\{\{#BEDROOMS_plural\}\}(s)\{\{\/BEDROOMS_plural\}\}/gi, bedroomCount !== 1 ? '$1' : '');
  html = html.replace(/\{\{#BEDS_plural\}\}(s)\{\{\/BEDS_plural\}\}/gi, bedsCount !== 1 ? '$1' : '');
  html = html.replace(/\{\{#BATHROOMS_plural\}\}(s)\{\{\/BATHROOMS_plural\}\}/gi, bathsCount !== 1 ? '$1' : '');
  html = html.replace(/\{\{#MAX_GUESTS_plural\}\}(s)\{\{\/MAX_GUESTS_plural\}\}/gi, guestsCount !== 1 ? '$1' : '');

  html = html.replace(/\{\{#[A-Za-z_][A-Za-z0-9_]*\}\}\s*/gi, '');
  html = html.replace(/\{\{\/[A-Za-z_][A-Za-z0-9_]*\}\}\s*/gi, '');
  html = html.replace(/\{\{\.\}\}\s*/g, '');
  html = html.replace(/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}\s*/gi, '');

  // Inject Edit link
  const editBtn = `<a href="https://www.propbook.pro/props/${slug}/edit" class="nav-edit-btn">Edit</a>`;
  html = html.replace('{{EDIT_LINK}}', editBtn);

  return html;
}

// ── SSH Upload via heredoc (writes HTML content to remote file) ──────────────

async function uploadViaSSH(slug: string, htmlContent: string): Promise<string> {
  const HOSTINGER_USER = "u805830916";
  const HOSTINGER_HOST = "82.29.86.252";
  const HOSTINGER_PORT = "65002";
  const HOSTINGER_PASS = Deno.env.get("HOSTINGER_SSH_PASS") || "Clawbot12!";
  const DEST_DIR = `/home/${HOSTINGER_USER}/domains/propbook.pro/public_html/props/${slug}`;
  const DEST_FILE = `${DEST_DIR}/index.html`;
  const siteUrl = `https://www.propbook.pro/props/${slug}`;

  // Use base64 to safely transfer content through SSH
  const b64 = btoa(new TextEncoder().encode(htmlContent).reduce((s, b) => s + String.fromCharCode(b), ''));

  const cmd = [
    `mkdir -p "${DEST_DIR}" && echo "${b64}" | base64 -d > "${DEST_FILE}" && chmod 644 "${DEST_FILE}" && echo "UPLOAD_OK"`
  ].join(' ');

  const fullCmd = [
    'sshpass', `-p '${HOSTINGER_PASS}'`, 'ssh', '-o', 'StrictHostKeyChecking=no',
    '-p', HOSTINGER_PORT, `${HOSTINGER_USER}@${HOSTINGER_HOST}`,
    `"${cmd.replace(/"/g, '\\"')}"`
  ].join(' ');

  const proc = Deno.run({ cmd: fullCmd.split(' '), stdout: 'piped', stderr: 'piped' });
  const [stdout, stderr] = await Promise.all([proc.output(), proc.stderrOutput()]);
  const status = await proc.status();

  if (!status.success) {
    const errMsg = new TextDecoder().decode(stderr);
    throw new Error(`SSH upload failed: ${errMsg}`);
  }

  const out = new TextDecoder().decode(stdout);
  if (!out.includes('UPLOAD_OK')) {
    throw new Error(`Upload did not confirm: ${out}`);
  }

  console.log(`[uploadViaSSH] ✅ ${slug} uploaded (${htmlContent.length} bytes)`);
  return siteUrl;
}