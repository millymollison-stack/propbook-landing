import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.7";

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

    const authHeader = (req.headers.get("Authorization") || "").trim();
    const receivedToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const expectedToken = supabaseKey.trim();

    if (receivedToken !== expectedToken) {
      console.error("[save-site-records] Auth mismatch.",
        "Received token starts with:", receivedToken.slice(0, 15),
        "Expected token starts with:", expectedToken.slice(0, 15));
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: "Invalid auth" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      throw new Error("Invalid JSON body");
    }

    const { title, slug, description, location, maxGuests, bedrooms, beds, baths,
            pricePerNight, heroImage, images, stripeAccountId, stripeAccountStatus,
            userId, name, propertyTitle } = body;

    // Fetch reference copy from the master Surf House Baja property
    const { data: refProp } = await supabase
      .from("properties")
      .select("property_details, property_intro, activities, local_area, getting_there, brand_color, font_accent")
      .eq("id", REFERENCE_PROPERTY_ID)
      .single();
    const ref = refProp || {};

    // Idempotent: check if this user already has a property
    const siteUrl = `https://www.propbook.pro/props/${slug}`;
    const { data: existingProp } = await supabase
      .from("properties")
      .select("id")
      .eq("owner_id", userId)
      .maybeSingle();

    let propertyRecord: any;
    if (existingProp) {
      // Update existing property — idempotent
      console.log("[save-site-records] Updating existing property:", existingProp.id, slug);
      const { data: updated, error: updateError } = await supabase
        .from("properties")
        .update({
          title: title || "Untitled Property",
          property_title: propertyTitle || title || '',
          name: name || `@${slug}`,
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
          brand_color: ref.brand_color || null,
          font_accent: ref.font_accent || null,
          site_url: siteUrl,
        })
        .eq("id", existingProp.id)
        .select("id, slug")
        .single();
      if (updateError) throw new Error(`Property update failed: ${updateError.message}`);
      propertyRecord = updated;
    } else {
      // Insert new property
      console.log("[save-site-records] Inserting property:", title, slug);
      const { data: inserted, error: propertyError } = await supabase
        .from("properties")
        .insert({
          title: title || "Untitled Property",
          property_title: propertyTitle || title || '',
          name: name || `@${slug}`,
          slug,
          owner_id: userId,
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
          brand_color: ref.brand_color || null,
          font_accent: ref.font_accent || null,
          site_url: siteUrl,
        })
        .select("id, slug")
        .single();
      if (propertyError) {
        console.error("[save-site-records] propertyError:", propertyError);
        throw new Error(`Property insert failed: ${propertyError.message}`);
      }
      propertyRecord = inserted;
    }

    console.log("[save-site-records] Property saved:", propertyRecord.id);

    // Set site_url on the property record so redirect polling works
    const siteUrl = `https://www.propbook.pro/props/${propertyRecord.slug}`;
    await supabase
      .from("properties")
      .update({ site_url: siteUrl })
      .eq("id", propertyRecord.id);

    // ── STEP 2: Insert property images with background flags ──────────
    // First 2 photos get is_background=true so users discover that feature
    if (images && images.length > 0) {
      console.log('[save-site-records] images received:', images?.length, 'first 3:', images?.slice(0, 3));
      const imageRecords = images.map((url: string, idx: number) => ({
        property_id: propertyRecord.id,
        url,
        position: idx + 1,
        is_featured: idx === 0,
        is_main: idx === 0,
        is_background: idx < 2,
      }));
      const { error: imagesError } = await supabase.from("property_images").insert(imageRecords);
      if (imagesError) {
        console.warn("[save-site-records] images insert warning:", imagesError.message);
      } else {
        console.log("[save-site-records] Images inserted:", images.length);
      }
    }

    // Also upsert onboarding_data so Home.tsx doesn't get duplicate-key errors on re-import
    const { error: onboardingError } = await supabase
      .from("onboarding_data")
      .upsert(
        {
          user_id: userId || null,
          property_name: title || "Untitled Property",
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
        },
        { onConflict: "slug" }
      );

    if (onboardingError) {
      console.warn("[save-site-records] onboarding_data upsert warning:", onboardingError.message);
      // Non-fatal — property was created successfully
    }

    console.log("[save-site-records] Success! propertyId:", propertyRecord.id);

    return new Response(
      JSON.stringify({
        propertyId: propertyRecord.id,
        siteUrl: `https://www.propbook.pro/props/${propertyRecord.slug}`,
        slug: propertyRecord.slug,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("save-site-records error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});