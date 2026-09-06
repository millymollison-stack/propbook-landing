import { supabase } from '../lib/supabase';
import type { Booking, GuestProfile } from '../types';

// Get property ID from the baked HTML data
export function getPropertyId(): string | null {
  const d = (window as any).__PROPERTY_DATA__;
  return d?.id ?? null;
}

// Associate current logged-in user with this property as a guest
export async function createGuestProfile(propertyId: string, guestData: { name?: string; email?: string; phone?: string }): Promise<GuestProfile> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('guest_profiles')
    .upsert({
      user_id: user.id,
      property_id: propertyId,
      guest_name: guestData.name,
      guest_email: guestData.email,
      guest_phone: guestData.phone,
    }, { onConflict: 'user_id,property_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get current guest's profile for this property
export async function getGuestProfile(propertyId: string): Promise<GuestProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('guest_profiles')
    .select('*')
    .eq('user_id', user.id)
    .eq('property_id', propertyId)
    .single();
  return data;
}

// Check if the current user is a guest for this property
export async function isGuestForProperty(propertyId: string): Promise<boolean> {
  const profile = await getGuestProfile(propertyId);
  return profile !== null;
}

// Get current guest's bookings for this property
export async function getGuestBookings(propertyId: string): Promise<Booking[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('bookings')
    .select('*')
    .eq('user_id', user.id)
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

// Submit a booking request
export async function createBookingRequest(propertyId: string, booking: {
  start_date: string;
  end_date: string;
  guest_count: number;
  special_requests?: string;
  total_price: number;
}): Promise<Booking> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      ...booking,
      property_id: propertyId,
      user_id: user.id,
      status: 'pending',
      payment_status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get all guests for a property (owner-side)
export async function getPropertyGuests(propertyId: string): Promise<GuestProfile[]> {
  const { data } = await supabase
    .from('guest_profiles')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });
  return data ?? [];
}
