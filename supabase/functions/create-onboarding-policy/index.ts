Deno.serve(async (req) => {
  // This function creates the RLS policies for the onboarding storage bucket
  // Run once via: supabase functions call create-onboarding-policy --no-verify
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Use the Supabase PostgREST endpoint to execute SQL via the service role
  // We need to create the policy using the storage.objects table
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/pg_catalog.pg_extension_config_dump`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'apikey': serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  return new Response(JSON.stringify({ 
    message: 'Policy creation requires direct Postgres access. Use Supabase dashboard.',
    instructions: [
      '1. Go to https://supabase.com/dashboard/project/jtzagpbdrqfifdisxipr/sql',
      '2. Run the following SQL:',
      'CREATE POLICY "allow_auth_insert_onboarding" ON storage.objects FOR INSERT TO authenticated USING (bucket_id = '\''onboarding'\'') WITH CHECK (bucket_id = '\''onboarding'\'');',
      'CREATE POLICY "allow_auth_select_onboarding" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = '\''onboarding'\'');',
      'CREATE POLICY "allow_public_read_onboarding" ON storage.objects FOR SELECT TO public USING (bucket_id = '\''onboarding'\'');',
    ]
  }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
});