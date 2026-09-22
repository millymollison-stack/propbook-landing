// supabase/functions/save-onboarding-scrape/index.ts
// Browser calls this right after an Airbnb scrape to upsert the scraped preview data onto
// onboarding_data, keyed by user_id -- bypasses RLS using the service role key server-side.
// Replaces a direct client-side POST to /rest/v1/onboarding_data (with apikey/Authorization
// set to the raw Supabase service_role key) that used to run inline in GetSite.tsx. That
// direct call needed the service key because RLS on onboarding_data can't always be
// satisfied at this point in the onboarding flow (see GetSite.tsx's own comment: "works even
// if the user isn't set yet" / survives a Stripe redirect that clears React state) -- this
// function does the same merge-duplicates upsert, just server-side instead of in the browser.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OnboardingScrapeUpsert {
  user_id: string;
  scraped_title?: string | null;
  scraped_location?: string | null;
  scraped_description?: string | null;
  scraped_hero_image?: string | null;
  scraped_images?: string[] | null;
  scraped_rating?: number | null;
  scraped_reviews?: number | null;
  scraped_guests?: number | null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Service role client -- bypasses RLS
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { user_id, ...scraped }: OnboardingScrapeUpsert = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanScraped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(scraped)) {
      if (value !== undefined) cleanScraped[key] = value;
    }

    const { data, error } = await supabaseAdmin
      .from('onboarding_data')
      .upsert({ user_id, ...cleanScraped }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error('save-onboarding-scrape error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('save-onboarding-scrape unhandled error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
