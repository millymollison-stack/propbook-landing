export type UserRole = 'admin' | 'user' | 'saas_admin';
export type BookingStatus = 'pending' | 'approved' | 'denied' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'canceled';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone_number: string | null;
  role: UserRole;
  stripe_account_id: string | null;
  stripe_account_status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  stripe_subscription_plan: string | null;
  stripe_subscription_amount: number | null;
  stripe_subscription_interval: string | null;
  stripe_subscription_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  title: string;
  name: string;
  slug: string;
  description: string;
  hero_image: string;
  images: string[];
  price_per_night: number;
  max_guests: number;
  bedrooms: number;
  beds: number;
  baths: number;
  amenities: string | string[];
  brand_color: string | null;
  font_accent: string | null;
  property_details: string | null;
  activities: string | null;
  local_area: string | null;
  getting_there: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  location_type: 'address' | 'coordinates' | null;
  property_title: string | null;
  property_headline: string | null;
  property_intro: string | null;
  custom_domain: string | null;
  status: 'draft' | 'building' | 'active' | 'inactive' | null;
  site_url: string | null;
  server_ip: string | null;
  folder_path: string | null;
  owner_id: string | null;
  // Real Supabase column names that don't match the app's normalized field names above
  // (bathrooms is the DB column; `baths` is the normalized in-app field derived from it).
  bathrooms?: number | null;
  house_rules?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PropertyImage {
  id: string;
  property_id: string;
  url: string;
  position: number;
  is_featured: boolean;
  is_main: boolean;
  is_background: boolean;
  created_at: string;
}

export interface Booking {
  id: string;
  property_id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  total_price: number;
  status: BookingStatus;
  guest_count: number;
  special_requests: string | null;
  created_at: string;
  updated_at: string;
  denial_reason: string | null;
  payment_status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  amount_paid: number | null;
  stripe_refund_id: string | null;
  payment_created_at: string | null;
  payment_completed_at: string | null;
}

export interface BlockedDate {
  id: string;
  property_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  created_at: string;
}

export interface Review {
  id: string;
  property_id: string;
  guest_name: string;
  guest_email: string;
  rating: number;
  review_text: string;
  stay_date: string;
  is_verified: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface GuestProfile {
  id: string;
  user_id: string;
  property_id: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  created_at: string;
}