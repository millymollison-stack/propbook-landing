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

    const { title, slug, description, propertyIntro, location, maxGuests, bedrooms, beds, baths,
            pricePerNight, heroImage, images, stripeAccountId, stripeAccountStatus,
            userId, name, propertyTitle, propertyHeadline, brand_color, font_accent,
            publishAttemptId } = body;
    // Correlation id for tracing one publish attempt across save-site-records / deploy-site /
    // migrate-property logs (client generates it, see siteDuplicationService.ts). Falls back to
    // "no-id" for older clients that haven't picked up the change yet.
    const logPrefix = `[${publishAttemptId || 'no-id'}]`;
    // [C4] Edge fn received
    console.log(logPrefix+' [C4] SAVE-SITE title="'+(title||'')+'" propertyTitle="'+(propertyTitle||'')+'" desc="'+(description||'').slice(0,50)+'"');

    // Fetch reference copy from the master Surf House Baja property
    const { data: refProp } = await supabase
      .from("properties")
      .select("property_details, property_intro, activities, local_area, getting_there, brand_color, font_accent")
      .eq("id", REFERENCE_PROPERTY_ID)
      .single();
    const ref = refProp || {};

    console.log(logPrefix, '[save-site-records] title:', title, 'slug:', slug, 'refKeys:', Object.keys(ref));

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
        // property_intro: the user's own "Full description (unedited)" text takes priority —
        // only fall back to the shared reference property when the client sent nothing at all
        // (2026-09-11 fix: this used to always overwrite with the reference property's text).
        property_details: ref.property_details || null,
        property_intro: propertyIntro || ref.property_intro || null,
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

    console.log(logPrefix, '[save-site-records] Property saved:', propertyRecord.id);

    // David 2026-10-22: "They just set up a new property site but did not hit
    // the subscribe button. They can now see their site but do not have an
    // edit button... let them edit but if they want to publish they have to
    // have subscribed." Edit-mode UI across the app (Layout's Edit button,
    // ImageGallery/LocationMap/PropertyAmenities/ReviewsList's edit handlers,
    // AdminSidebarBundle itself) all gate on profiles.role === 'admin' --
    // "every property owner's account is role:'admin', not just platform
    // staff" (see App.tsx's isViewingOwnProperty comment). That flip used to
    // happen via the upgrade-user function, called right after Stripe
    // checkout in the old pay-first flow -- but nothing calls upgrade-user
    // any more now that payment moved to the sidebar's Publish step (see
    // GetSite.tsx's handlePublish comment), so a brand-new user who saves a
    // draft without subscribing was left on role:'user' indefinitely, with
    // no edit access at all. Flip it here instead, at draft-creation time,
    // independent of subscription -- publishing (going live) still has its
    // own separate gate in AdminSidebarBundle's handlePublishFromSidebar.
    // profiles.role is a 2-value Postgres enum (admin/user only) -- there is
    // no third "saas_admin" DB value to guard against (that's a different,
    // separate check elsewhere), so plain eq(id) is all this needs.
    if (userId) {
      const { error: roleError } = await supabase
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", userId);
      if (roleError) console.warn(logPrefix, "[save-site-records] role upgrade warning:", roleError.message);
    }

    if (images && images.length > 0) {
      // Last 2 scraped images become the site's background-layer images by
      // default (David: "auto assigned background image status at scrape
      // so they have to be there in the first place so a user can edit
      // them") — was the FIRST 2 (idx < 2), which also collided with the
      // hero/featured image (idx === 0) doubling as a background image.
      const backgroundStartIdx = Math.max(0, images.length - 2);
      const imageRecords = images.map((url: string, idx: number) => ({
        property_id: propertyRecord.id,
        url,
        position: idx + 1,
        is_featured: idx === 0,
        is_main: idx === 0,
        is_background: idx >= backgroundStartIdx,
      }));
      const { error: imagesError } = await supabase.from("property_images").insert(imageRecords);
      if (imagesError) console.warn(logPrefix, "[save-site-records] images insert warning:", imagesError.message);
      else console.log(logPrefix, "[save-site-records] Images inserted:", images.length);
    }

    // Seed 3 generic starter reviews the first time this property is created,
    // so a brand-new site never shows an empty "No reviews yet" section --
    // ALONGSIDE any real reviews a property already has (David: he wants
    // both to show together, e.g. Surf House Baja's own reviews plus the
    // generic 3, so he can delete the generic ones from Admin whenever he
    // wants). Guarded by checking for these 3 specific guest_emails rather
    // than a total review count, so this still never duplicates on a
    // re-save (this function upserts on every publish) but no longer skips
    // properties that already had real reviews.
    const STARTER_REVIEW_EMAILS = ["sarah.m@example.com", "james.t@example.com", "priya.k@example.com"];
    const { data: existingStarterReviews, error: reviewCountError } = await supabase
      .from("reviews")
      .select("guest_email")
      .eq("property_id", propertyRecord.id)
      .in("guest_email", STARTER_REVIEW_EMAILS);

    if (reviewCountError) {
      console.warn("[save-site-records] review count check warning:", reviewCountError.message);
    } else if ((existingStarterReviews ?? []).length === 0) {
      // A mix of dates (not all identical) so they read as real, separate
      // stays rather than 3 rows seeded in the same instant.
      const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
      const starterReviews = [
        {
          property_id: propertyRecord.id,
          guest_name: "Sarah M.",
          guest_email: "sarah.m@example.com",
          rating: 5,
          review_text: "Absolutely loved our stay here! The place was spotless, beautifully decorated, and exactly as pictured. We'd book again in a heartbeat.",
          stay_date: daysAgo(38),
          is_verified: true,
          display_order: 1,
        },
        {
          property_id: propertyRecord.id,
          guest_name: "James T.",
          guest_email: "james.t@example.com",
          rating: 5,
          review_text: "Great location and a really comfortable stay. Check-in was easy and the host was quick to respond whenever we had a question.",
          stay_date: daysAgo(97),
          is_verified: true,
          display_order: 2,
        },
        {
          property_id: propertyRecord.id,
          guest_name: "Priya K.",
          guest_email: "priya.k@example.com",
          rating: 4,
          review_text: "Really nice space and great value for the price. Would happily recommend it to friends and family looking to stay in the area.",
          stay_date: daysAgo(163),
          is_verified: true,
          display_order: 3,
        },
      ];
      const { error: reviewsSeedError } = await supabase.from("reviews").insert(starterReviews);
      if (reviewsSeedError) console.warn(logPrefix, "[save-site-records] starter reviews insert warning:", reviewsSeedError.message);
      else console.log(logPrefix, "[save-site-records] Seeded 3 starter reviews for property:", propertyRecord.id);
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
