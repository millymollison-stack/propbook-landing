// supabase/functions/update-property/index.ts
// Browser calls this to update property fields — bypasses RLS using service role key
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PropertyUpdate {
  id: string;
  name?: string | null;
  slug?: string | null;
  title?: string | null;
  property_headline?: string | null;
  description?: string | null;
  property_intro?: string | null;
  property_details?: string | null;
  activities?: string | null;
  local_area?: string | null;
  getting_there?: string | null;
  address?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  location_type?: string | null;
  bedrooms?: number | null;
  beds?: number | null;
  bathrooms?: number | null;
  max_guests?: number | null;
  price_per_night?: number | null;
  hero_image?: string | null;
  images?: string[] | null;
  site_url?: string | null;
  status?: string | null;
  meta_description?: string | null;
  og_image_url?: string | null;
  google_business_url?: string | null;
  robots_noindex?: boolean | null;
  custom_page_title?: string | null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Service role client — bypasses RLS
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { id, ...updates }: PropertyUpdate = await req.json();

    if (!id) {
      return new Response(JSON.stringify({ error: 'Property id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Remove undefined values
    const cleanUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) cleanUpdates[key] = value;
    }

    const { data, error } = await supabaseAdmin
      .from('properties')
      .update(cleanUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('update-property error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('update-property unhandled error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
