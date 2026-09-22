// supabase/functions/update-property-image/index.ts
// Browser calls this to update property_images fields (is_main/is_featured/is_background) --
// bypasses RLS using the service role key server-side. Same pattern as update-property.
// Added to replace a direct client-side supabaseAdmin.from('property_images').update() call
// in Home.tsx that required shipping the Supabase service_role key into the browser bundle.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PropertyImageUpdate {
  id: string;
  is_main?: boolean | null;
  is_featured?: boolean | null;
  is_background?: boolean | null;
  position?: number | null;
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

    const { id, ...updates }: PropertyImageUpdate = await req.json();

    if (!id) {
      return new Response(JSON.stringify({ error: 'Image id is required' }), {
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
      .from('property_images')
      .update(cleanUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('update-property-image error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('update-property-image unhandled error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
