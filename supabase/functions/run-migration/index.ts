import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// Use the pg_meta service to run raw SQL via the management API approach
// Fallback: use REST API to create table by inserting directly
Deno.serve(async (req: Request) => {
  const results: string[] = []
  const errors: string[] = []

  // Try using the Supabase REST API to check if guest_profiles exists
  const { data: existingTable, error: checkError } = await admin
    .from('guest_profiles')
    .select('id')
    .limit(1)
    .catch(() => ({ data: null, error: checkError }) as any)

  if (!checkError && existingTable !== null) {
    results.push('guest_profiles table already exists')
  }

  // If table doesn't exist, try to create it using admin operations
  // Since we can't run raw SQL directly, we'll verify via the REST API
  // The admin client with service role key CAN insert RLS-bypassed records
  // But it can't run DDL. Let's verify what's needed.

  // Check what we actually need:
  // 1. Create guest_profiles table - requires DDL
  // 2. Set up RLS policies - requires DDL
  // 3. Update bookings RLS - requires DDL

  // Without DDL access, we can only verify current state
  const { data: tables } = await admin.rpc('pg_get_tables', {}).catch(() => ({ data: null }) as any)
  
  return new Response(JSON.stringify({ 
    message: 'Migration helper - DDL requires Supabase management API or direct DB access',
    supabaseUrl,
    hasServiceKey: !!serviceKey,
    guestProfilesExists: existingTable !== null,
    results,
    errors
  }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
