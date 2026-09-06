import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Step 1: Try to add property_id column via pg_catalog
  // This RPC function exists in Supabase managed databases
  let alterOk = false;
  try {
    await supabase.rpc("pg_catalog.add_column_if_not_exists", {
      table_name: "profiles",
      column_name: "property_id",
      column_type: "uuid",
      references_table: "properties",
      references_column: "id",
    });
    alterOk = true;
  } catch (_) {
    // RPC not available, try direct approach
    alterOk = false;
  }

  // Step 2: Get all properties grouped by owner
  const { data: allProperties, error: propsError } = await supabase
    .from("properties")
    .select("id, owner_id, slug, title, status")
    .not("owner_id", "is", null)
    .not("slug", "is", null)
    .neq("slug", "");

  if (propsError) {
    return new Response(JSON.stringify({ ok: false, error: propsError.message }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Group by owner_id
  const byOwner: Record<string, typeof allProperties> = {};
  for (const p of allProperties ?? []) {
    if (!p.owner_id) continue;
    byOwner[p.owner_id] = byOwner[p.owner_id] || [];
    byOwner[p.owner_id].push(p);
  }

  // Step 3: For owners with exactly 1 property, backfill property_id
  const results: { profile_id: string; email: string; property_id: string; slug: string }[] = [];
  const errors: string[] = [];

  for (const [ownerId, properties] of Object.entries(byOwner)) {
    if (properties.length !== 1) continue; // skip users with 0 or multiple properties
    const property = properties[0];

    // Get the profile email for logging
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("id", ownerId)
      .single();

    if (!profile) continue;

    // Try to update via REST (service role bypasses RLS)
    const patchRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${ownerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({ property_id: property.id }),
    });

    if (patchRes.ok) {
      results.push({ profile_id: ownerId, email: profile.email, property_id: property.id, slug: property.slug });
    } else {
      const errText = await patchRes.text();
      errors.push(`Profile ${ownerId} (${profile.email}): ${errText}`);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    alterAttempted: alterOk,
    totalOwners: Object.keys(byOwner).length,
    ownersWithSingleProperty: results.length,
    migrated: results,
    errors: errors.slice(0, 10),
  }), { headers: { "Content-Type": "application/json" } });
});
