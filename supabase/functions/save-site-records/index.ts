import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const REFERENCE_PROPERTY_ID = "efa8d280-afee-4971-9145-d591740f484d";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let body: any;
    try { body = await req.json(); } catch { throw new Error("Invalid JSON"); }

    const { title, slug, description, location, maxGuests, bedrooms, beds, baths,
            pricePerNight, heroImage, images, stripeAccountId, stripeAccountStatus,
            userId, name, propertyTitle, propertyHeadline, brand_color, font_accent } = body;
    // [C4] Edge fn received
    console.log('[C4] SAVE-SITE title="'+(title||'')+'" propertyTitle="'+(propertyTitle||'')+'" desc="'+(description||'').slice(0,50)+'"');

    // Fetch reference copy from the master Surf House Baja property
    const { data: refProp } = await supabase
      .from("properties")
      .select("property_details, property_intro, activities, local_area, getting_there, brand_color, font_accent")
      .eq("id", REFERENCE_PROPERTY_ID)
      .single();
    const ref = refProp || {};

    console.log('[save-site-records] title:', title, 'slug:', slug, 'refKeys:', Object.keys(ref));

    const siteUrl = `https://www.propbook.pro/props/${slug}`;

    // Use upsert to handle the case where owner_id already has a property — update it
    // instead of failing with "duplicate key" error on the owner_id unique constraint.
    const { data: upserted, error: upsertError } = await supabase
      .from("properties")
      .upsert({
        owner_id: userId,
        title: title || "Untitled Property",
        property_title: propertyTitle || title || '',
        property_headline: propertyHeadline || null,
        name: name || `@${slug}`,
        slug,
        description: description || "",
        address: location || "",
        max_guests: maxGuests || 8,
        bedrooms: bedrooms || 2,
        bathrooms: baths || 1,
        beds: beds || 3,
        price_per_night: pricePerNight || 150,
        hero_image: heroImage || "",
        images: images || [],
        stripe_account_id: stripeAccountId || null,
        stripe_account_status: stripeAccountStatus || null,
        property_details: ref.property_details || null,
        property_intro: ref.property_intro || null,
        activities: ref.activities || null,
        local_area: ref.local_area || null,
        getting_there: ref.getting_there || null,
        brand_color: brand_color || ref.brand_color || null,
        font_accent: font_accent || ref.font_accent || null,
        site_url: siteUrl,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "owner_id",
        ignoreDuplicates: false,
      })
      .select("id, slug")
      .single();
    if (upsertError) throw new Error(`Property upsert failed: ${upsertError.message}`);
    const propertyRecord = upserted;

    console.log('[save-site-records] Property saved:', propertyRecord.id);

    if (images && images.length > 0) {
      const imageRecords = images.map((url: string, idx: number) => ({
        property_id: propertyRecord.id,
        url,
        position: idx + 1,
        is_featured: idx === 0,
        is_main: idx === 0,
        is_background: idx < 2,
      }));
      const { error: imagesError } = await supabase.from("property_images").insert(imageRecords);
      if (imagesError) console.warn("[save-site-records] images insert warning:", imagesError.message);
      else console.log("[save-site-records] Images inserted:", images.length);
    }

    const { error: onboardingError } = await supabase
      .from("onboarding_data")
      .upsert({
        user_id: userId || null,
        property_name: title || "Untitled Property",
        property_headline: propertyHeadline || '',
        property_desc: description || "",
        slug,
        hero_image: heroImage || "",
        images: images || [],
        bedrooms: bedrooms ? String(bedrooms) : null,
        beds: beds ? String(beds) : null,
        baths: baths ? String(baths) : null,
        guests: maxGuests ? String(maxGuests) : null,
        price: pricePerNight ? String(pricePerNight) : null,
        property_id: propertyRecord.id,
      }, { onConflict: "user_id" });
    if (onboardingError) console.warn("[save-site-records] onboarding upsert warning:", onboardingError.message);

    return new Response(JSON.stringify({ propertyId: propertyRecord.id, siteUrl, slug: propertyRecord.slug }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error('[save-site-records] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
