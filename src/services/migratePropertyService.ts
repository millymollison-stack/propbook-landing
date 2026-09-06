/**
 * migratePropertyService.ts
 * Calls the migrate-property edge function to push scraped data
 * to the "Surf House Baja (Migration)" property in Supabase.
 */

import { supabase } from '../lib/supabase';
import type { MigratePropertyData } from '../types';

export interface MigratePropertyData {
  title: string;
  description: string;
  location: string;
  price: string;
  hero_image: string;
  images: string[];
  guests: number | null;
  bedrooms: number | null;
  beds: number | null;
  baths: number | null;
  rating: number | null;
  reviews: number | null;
  host_name: string | null;
  amenities: string[];
}

/**
 * Push scraped property data to the migration property via edge function.
 * Returns the migration property ID on success.
 */
export async function migrateProperty(data: MigratePropertyData): Promise<string> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Reuse existing supabase client (avoids duplicate GoTrueClient warning)
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const res = await fetch(`${supabaseUrl}/functions/v1/migrate-property`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'Apikey': anonKey,
    },
    body: JSON.stringify(data),
  });

  const result = await res.json();

  if (!res.ok || result.error) {
    throw new Error(result.error || `HTTP ${res.status}`);
  }

  console.log('[migrateProperty] ✅ Migration complete:', result);
  return result.property_id;
}