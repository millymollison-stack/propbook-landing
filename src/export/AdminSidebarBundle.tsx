/**
 * AdminSidebar — Integrated into New Site Template
 * Uses app's store/auth.ts, lib/supabase.ts, store/property.ts, types/index.ts
 */


import React, { useState, useEffect, useMemo, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, fromUnixTime, addDays } from 'date-fns';
import { ChevronRight, ChevronDown, X, LogOut, ExternalLink, Check, CreditCard as Edit2, Clock, CreditCard, AlertCircle, XCircle, CheckCircle, MapPin, Eye, EyeOff, Mail, Phone, User, MessageSquare, Home, Image, Bed, Bath, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';
import { useProperty } from '../store/property';
import type { Profile, Booking, Property } from '../types';
import { duplicateSiteAfterPayment } from '../services/siteDuplicationService';
import { SeoSection } from './SeoSection';

// ─────────────────────────────────────────────
// SECTION 1 — Extended Profile (app type + services fields)
// ─────────────────────────────────────────────

type ServiceKey = 'aiSeo' | 'marketing' | 'advertising' | 'analytics' | 'influencers' | 'social';

export type BookingStatus = 'pending' | 'approved' | 'denied' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed';

// Extend the app's Profile type to include services fields used by this sidebar
export interface SidebarServicesProfile extends Profile {
  services_ai_seo?: boolean;
  services_marketing?: boolean;
  services_advertising?: boolean;
  services_analytics?: boolean;
  services_influencers?: boolean;
  services_social?: boolean;
}

// ─────────────────────────────────────────────
// SECTION 2 — AuthProvider (no-op — app's auth already initialises)
// ─────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // App's store/auth.ts AuthProvider handles initialisation — do nothing here
  return <>{children}</>;
}

// ─────────────────────────────────────────────
// SECTION 3 — Shared UI primitives
// ─────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${checked ? 'bg-green-500' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-[17px] w-[17px] transform rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Loader() {
  return (
    <div className="flex items-center justify-center py-6">
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

function InlineLoader() {
  return (
    <div className="flex gap-1">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
    : <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />;
}

// ─────────────────────────────────────────────
// SECTION 4 — UserBookings sub-component
// ─────────────────────────────────────────────

interface UserBookingsProps {
  bookings: (Booking & { property: Property; user: Profile })[];
  onUpdateStatus?: (bookingId: string, status: 'approved' | 'denied', reason?: string) => Promise<void>;
  onRefund?: (bookingId: string) => Promise<void>;
  // True for platform staff OR the account that owns this property — lets a non-admin
  // owner see guest details and approve/deny/refund bookings on their own property,
  // instead of being shown the "my own bookings as a guest" view.
  canManageProperty?: boolean;
}

const UserBookings = memo(function UserBookings({ bookings, onUpdateStatus, onRefund, canManageProperty: canManagePropertyProp }: UserBookingsProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [denialReason, setDenialReason] = useState('');
  const [_isAccessDenied, _setIsAccessDenied] = useState(false);
  const [showDenialModal, setShowDenialModal] = useState<string | null>(null);
  const [_adminProfile, setAdminProfile] = useState<Profile | null>(null);
  const [guestProfile, _setGuestProfile] = useState<Profile | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRefunding, setIsRefunding] = useState<string | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Staff admin OR the property's owner — both should see guest details and manage bookings.
  const canManage = isAdmin || !!canManagePropertyProp;

  useEffect(() => { if (!isAdmin) loadAdminProfile(); }, [isAdmin]);

  const loadAdminProfile = async () => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('role', 'admin').limit(1).single();
      if (data) setAdminProfile(data);
    } catch { /* silent */ }
  };

  const handleStatusUpdate = async (bookingId: string, status: 'approved' | 'denied', reason?: string) => {
    if (!onUpdateStatus) return;
    setIsUpdating(true);
    try { await onUpdateStatus(bookingId, status, reason); }
    catch (e) { console.error(e); }
    finally { setIsUpdating(false); }
  };

  const handleRefund = async (bookingId: string) => {
    if (!onRefund) return;
    if (!confirm('Are you sure you want to refund this booking? This action cannot be undone.')) return;
    setIsRefunding(bookingId);
    try { await onRefund(bookingId); alert('Refund processed successfully'); }
    catch { alert('Failed to process refund. Please try again.'); }
    finally { setIsRefunding(null); }
  };

  const filteredBookings = useMemo(() => {
    if (statusFilter === 'all') return bookings;
    return bookings.filter(b => b.status === statusFilter);
  }, [bookings, statusFilter]);

  const statusBadge = (status: string) => {
    const cfg: Record<string, { icon: any; bg: string; text: string }> = {
      approved: { icon: Check, bg: 'bg-green-100', text: 'text-green-800' },
      denied: { icon: X, bg: 'bg-red-100', text: 'text-red-800' },
      cancelled: { icon: X, bg: 'bg-gray-100', text: 'text-gray-800' },
      pending: { icon: Clock, bg: 'bg-yellow-100', text: 'text-yellow-800' },
    };
    const { icon: Icon, bg, text } = cfg[status] || cfg.pending;
    return <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${bg} ${text}`}><Icon className="w-4 h-4 mr-1.5" />{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
  };

  const paymentBadge = (ps: PaymentStatus) => {
    const cfg: Record<string, { icon: any; bg: string; text: string; label: string }> = {
      paid: { icon: Check, bg: 'bg-green-100', text: 'text-green-800', label: 'Paid' },
      pending: { icon: Clock, bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Payment Pending' },
      unpaid: { icon: AlertCircle, bg: 'bg-gray-100', text: 'text-gray-800', label: 'Unpaid' },
      refunded: { icon: CreditCard, bg: 'bg-blue-100', text: 'text-blue-800', label: 'Refunded' },
      failed: { icon: X, bg: 'bg-red-100', text: 'text-red-800', label: 'Payment Failed' },
    };
    const { icon: Icon, bg, text, label } = cfg[ps] || cfg.unpaid;
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${text}`}><Icon className="w-3.5 h-3.5 mr-1" />{label}</span>;
  };

  if (!bookings.length) return <div className="text-center py-12"><p className="body-on-light">No bookings found.</p></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-center pt-6">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-48 text-base border-gray-300 rounded-md shadow-sm bookings-filter-select">
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div className="divide-y divide-gray-200">
        {filteredBookings.map(booking => (
          <div key={booking.id} className="py-4">
            <div className="flex justify-center items-center gap-2 mb-4 flex-wrap">
              {statusBadge(booking.status)}
              {paymentBadge(booking.payment_status)}
            </div>
            {canManage ? (
              <div className="space-y-2">
                <div className="flex items-center"><User className="h-4 w-4 text-gray-400 mr-2" /><span className="font-medium">{booking.user?.full_name || 'Unknown User'}</span></div>
                <div className="flex items-center body-on-light"><Mail className="h-4 w-4 text-gray-400 mr-2" />{booking.user?.email || 'No email'}</div>
                <div className="flex items-center body-on-light"><Phone className="h-4 w-4 text-gray-400 mr-2" />{booking.user?.phone_number || 'No phone'}</div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center"><User className="h-4 w-4 text-gray-400 mr-2" /><span className="font-medium">{user?.full_name || user?.email || 'My Account'}</span></div>
                <div className="flex items-center body-on-light"><Mail className="h-4 w-4 text-gray-400 mr-2" />{user?.email || ''}</div>
                <div className="flex items-center body-on-light"><Phone className="h-4 w-4 text-gray-400 mr-2" />{guestProfile?.phone_number || user?.phone_number || ''}</div>
                {booking.property && <div className="flex items-center body-on-light"><Home className="h-4 w-4 text-gray-400 mr-2" />{booking.property?.title || 'Property'}</div>}
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><dt className="font-medium text-gray-500">Check-in</dt><dd className="mt-1 text-gray-900">{format(new Date(booking.start_date), 'MMM d, yyyy')}<div className="text-xs text-gray-500">3:00 PM</div></dd></div>
              <div><dt className="font-medium text-gray-500">Check-out</dt><dd className="mt-1 text-gray-900">{format(addDays(new Date(booking.end_date), 1), 'MMM d, yyyy')}<div className="text-xs text-gray-500">11:00 AM</div></dd></div>
              <div><dt className="font-medium text-gray-500">Total</dt><dd className="mt-1 text-gray-900">${booking.total_price}<span className="text-gray-500 text-xs ml-1">({booking.guest_count} {booking.guest_count === 1 ? 'guest' : 'guests'})</span></dd></div>
              <div><dt className="font-medium text-gray-500">Amount Paid</dt><dd className="mt-1 text-gray-900">{booking.amount_paid ? `$${(booking.amount_paid / 100).toFixed(2)}` : '—'}</dd></div>
            </div>
            {booking.special_requests && (
              <div className="mt-4"><dt className="text-sm font-medium text-gray-500 flex items-center"><MessageSquare className="h-4 w-4 mr-1" />Special Requests</dt><dd className="mt-1 text-sm text-gray-900">{booking.special_requests}</dd></div>
            )}
            {canManage && booking.status === 'pending' && (
              <div className="mt-4 flex justify-center space-x-3">
                <button onClick={() => handleStatusUpdate(booking.id, 'approved')} disabled={isUpdating} className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"><Check className="h-4 w-4 mr-1" />{isUpdating ? 'Updating...' : 'Approve'}</button>
                <button onClick={() => setShowDenialModal(booking.id)} disabled={isUpdating} className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"><X className="h-4 w-4 mr-1" />Deny</button>
              </div>
            )}
            {canManage && booking.status === 'denied' && booking.payment_status === 'paid' && (
              <div className="mt-4 flex justify-center">
                <button onClick={() => handleRefund(booking.id)} disabled={isRefunding === booking.id} className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"><CreditCard className="h-4 w-4 mr-1" />{isRefunding === booking.id ? 'Processing...' : 'Process Refund'}</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {showDenialModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={() => setShowDenialModal(null)} />
            <div className="relative inline-block sb-panel-bg rounded-lg px-4 pt-5 pb-4 text-left shadow-xl sm:my-8 sm:max-w-lg sm:w-full sm:p-6">
              <h3 className="h4-on-light text-center">Provide Reason for Denial</h3>
              <textarea rows={4} className="mt-4 block w-full rounded-md border-gray-300 shadow-sm text-sm edit-textarea" placeholder="Enter reason for denying the booking..." value={denialReason} onChange={e => setDenialReason(e.target.value)} />
              <div className="mt-5 sm:grid sm:grid-cols-2 sm:gap-3">
                <button disabled={isUpdating} className="w-full inline-flex justify-center rounded-md px-4 py-2 bg-red-600 text-white text-sm font-medium hover:bg-red-700 sm:col-start-2" onClick={() => { if (showDenialModal) { handleStatusUpdate(showDenialModal, 'denied', denialReason); setShowDenialModal(null); setDenialReason(''); } }}>{isUpdating ? 'Updating...' : 'Confirm Denial'}</button>
                <button disabled={isUpdating} className="mt-3 sm:mt-0 w-full inline-flex justify-center rounded-md border border-gray-300 px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50" onClick={() => { setShowDenialModal(null); setDenialReason(''); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────

// SECTION 5 — Section sub-components
// ─────────────────────────────────────────────

interface StripeConnectData {
  account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  business_name: string;
  email: string;
  available_balance: number;
  pending_balance: number;
  currency: string;
  bank_account?: { bank_name: string; last4: string; account_holder_name: string } | null;
}

interface SubscriptionData {
  id: string;
  status: string;
  plan: string;
  amount: number;
  interval: string;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
}

function googleMapsUrl(address: string, lat: string, lng: string): string {
  if (lat && lng) return `https://www.google.com/maps?q=${lat},${lng}`;
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return '';
}

function PropertySection({ imageCount, isEditing, fields, onChange }: {
  property: Property | null;
  imageCount: number;
  isEditing: boolean;
  fields: { title: string; property_headline: string; property_intro: string; address: string; latitude: string; longitude: string; location_type: 'address' | 'coordinates'; bedrooms: string; beds: string; baths: string; max_guests: string };
  onChange: React.Dispatch<React.SetStateAction<{ title: string; property_headline: string; property_intro: string; address: string; latitude: string; longitude: string; location_type: 'address' | 'coordinates'; bedrooms: string; beds: string; baths: string; max_guests: string }>>;
}) {
  const mapsUrl = googleMapsUrl(fields.address, fields.latitude, fields.longitude);
  return (
    <div>
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Property name</h4>
        {isEditing
          ? <input type="text" value={fields.title} onChange={e => onChange(p => ({ ...p, title: e.target.value }))} className="sb-input" />
          : <p className="sb-field-value">{fields.title || '—'}</p>}
      </div>
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Property headline</h4>
        {isEditing
          ? <input type="text" value={fields.property_headline} onChange={e => onChange(p => ({ ...p, property_headline: e.target.value }))} className="sb-input" placeholder="e.g. Luxury Beachfront Villa with Ocean Views" />
          : <p className="sb-field-value" style={{ whiteSpace: 'pre-wrap' }}>{fields.property_headline || '—'}</p>}
      </div>
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Hero teaser</h4>
        {isEditing
          ? <textarea value={fields.property_intro} onChange={e => onChange(p => ({ ...p, property_intro: e.target.value }))} className="sb-input" rows={3} placeholder="Short intro text shown under the hero image..." />
          : <p className="sb-field-value" style={{ whiteSpace: 'pre-wrap' }}>{fields.property_intro || '—'}</p>}
      </div>
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Address</h4>
        {isEditing
          ? <input type="text" value={fields.address} onChange={e => onChange(p => ({ ...p, address: e.target.value }))} className="sb-input" />
          : <p className="sb-field-value">{fields.address || '—'}</p>}
      </div>
      {isEditing ? (
        <>
          <div className="sb-field-row">
            <h4 className="sb-h4-grey">Location method</h4>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" value="address" checked={fields.location_type === 'address'} onChange={() => onChange(p => ({ ...p, location_type: 'address' }))} className="sb-radio" />
                <span className="text-xs text-gray-600">Address</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" value="coordinates" checked={fields.location_type === 'coordinates'} onChange={() => onChange(p => ({ ...p, location_type: 'coordinates' }))} className="sb-radio" />
                <span className="text-xs text-gray-600">Coordinates</span>
              </label>
            </div>
          </div>
          {fields.location_type === 'coordinates' && (
            <>
              <div className="sb-field-row">
                <h4 className="sb-h4-grey">Latitude</h4>
                <input type="text" value={fields.latitude} onChange={e => onChange(p => ({ ...p, latitude: e.target.value }))} className="sb-input" />
              </div>
              <div className="sb-field-row">
                <h4 className="sb-h4-grey">Longitude</h4>
                <input type="text" value={fields.longitude} onChange={e => onChange(p => ({ ...p, longitude: e.target.value }))} className="sb-input" />
              </div>
            </>
          )}
          {mapsUrl && (
            <div className="sb-field-row" style={{ borderBottom: 'none' }}>
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="sb-change-pw-btn" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin className="h-3.5 w-3.5" />Verify on Google Maps<ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </>
      ) : (fields.latitude || fields.longitude) ? (
        <div className="sb-field-row">
          <h4 className="sb-h4-grey">Coordinates</h4>
          <div className="flex items-center justify-between">
            <p className="sb-mono">{fields.latitude ? parseFloat(fields.latitude).toFixed(5) : '—'}, {fields.longitude ? parseFloat(fields.longitude).toFixed(5) : '—'}</p>
            {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="sb-change-pw-btn" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MapPin className="h-3.5 w-3.5" />Maps</a>}
          </div>
        </div>
      ) : null}
      {!isEditing && !fields.latitude && fields.address && mapsUrl && (
        <div className="sb-field-row" style={{ borderBottom: 'none' }}>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="sb-change-pw-btn" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MapPin className="h-4 w-4" />Open in Google Maps<ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
      <div className="sb-field-row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
        <h4 className="sb-h4-grey">Property stats</h4>
        <div className="sb-stats-grid">
          <span className="sb-stat-pill" title="Uploaded photos">
            <Image className="h-3.5 w-3.5" />
            <span className="sb-stat-pill-value">{imageCount}</span>
            <span className="sb-stat-pill-label">Photos</span>
          </span>
          <span className="sb-stat-pill" title="Bedrooms">
            <Bed className="h-3.5 w-3.5" />
            {isEditing
              ? <input type="number" min="0" value={fields.bedrooms} onChange={e => onChange(p => ({ ...p, bedrooms: e.target.value }))} className="sb-stat-pill-input" />
              : <span className="sb-stat-pill-value">{fields.bedrooms || 0}</span>}
            <span className="sb-stat-pill-label">Bedrooms</span>
          </span>
          <span className="sb-stat-pill" title="Beds">
            <Bed className="h-3.5 w-3.5" />
            {isEditing
              ? <input type="number" min="0" value={fields.beds} onChange={e => onChange(p => ({ ...p, beds: e.target.value }))} className="sb-stat-pill-input" />
              : <span className="sb-stat-pill-value">{fields.beds || 0}</span>}
            <span className="sb-stat-pill-label">Beds</span>
          </span>
          <span className="sb-stat-pill" title="Baths">
            <Bath className="h-3.5 w-3.5" />
            {isEditing
              ? <input type="number" min="0" step="0.5" value={fields.baths} onChange={e => onChange(p => ({ ...p, baths: e.target.value }))} className="sb-stat-pill-input" />
              : <span className="sb-stat-pill-value">{fields.baths || 0}</span>}
            <span className="sb-stat-pill-label">Baths</span>
          </span>
          <span className="sb-stat-pill" title="Max guests">
            <Users className="h-3.5 w-3.5" />
            {isEditing
              ? <input type="number" min="1" value={fields.max_guests} onChange={e => onChange(p => ({ ...p, max_guests: e.target.value }))} className="sb-stat-pill-input" />
              : <span className="sb-stat-pill-value">{fields.max_guests || 0}</span>}
            <span className="sb-stat-pill-label">Guests</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function WebsiteSection({ devUpdates, setDevUpdates, siteUrl, websiteName, propertySlug, propertyId }: {
  devUpdates: boolean; setDevUpdates: (v: boolean) => void;
  serverIp?: string | null;
  siteUrl?: string | null;
  websiteName?: string;
  propertySlug?: string;
  propertyId?: string;
}) {
  // Resolve property slug: prop > sessionStorage > websiteName
  const slug = propertySlug || sessionStorage.getItem('popup_website_name') || '';

  // Resolve current website URL: siteUrl prop > sessionStorage popup_site_url > window.location.origin (dev)
  const popupSiteUrl = sessionStorage.getItem('popup_site_url');
  const currentUrl = siteUrl || popupSiteUrl || (typeof window !== 'undefined' ? window.location.origin : null);

  const isDeployed = !!siteUrl;

  // Domain search URL — use live sessionStorage value if available (reflects live edits in popup)
  const liveWebsiteName = sessionStorage.getItem('popup_website_name') || websiteName || '';
  const domainName = liveWebsiteName ? liveWebsiteName.replace(/^@+/, '').trim() + '.com' : '';
  const domainSearchUrl = domainName
    ? `https://www.hostinger.com/domain-search?domain=${encodeURIComponent(domainName)}`
    : 'https://www.hostinger.com/domain-search';

  // File path from siteUrl
  const filePath = siteUrl || null;

  return (
    <div style={{ paddingTop: 4 }}>
      {/* 0. Website Name */}
      <div style={{ marginBottom: 16 }}>
        <h4 className="sb-h4-grey">Website name</h4>
        <p className="sb-field-value" style={{ fontWeight: 500 }}>
          {liveWebsiteName || websiteName || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not set yet</span>}
        </p>
      </div>

      {/* 0b. Property Database ID */}
      <div style={{ marginBottom: 16 }}>
        <h4 className="sb-h4-grey">Property Database ID</h4>
        {propertyId ? (
          <code style={{ fontSize: '0.75rem', color: '#111827', background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontFamily: 'ui-monospace, monospace' }}>{propertyId}</code>
        ) : (
          <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>No property created yet</p>
        )}
      </div>

      {/* 1. Current website location */}
      <div style={{ marginBottom: 16 }}>
        <h4 className="sb-h4-grey">Current website location</h4>
        {currentUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <a href={currentUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem', color: '#111827', textDecoration: 'none', wordBreak: 'break-all', flex: 1 }}>{currentUrl}</a>
            <ExternalLink className="h-3.5 w-3.5" style={{ color: '#6b7280', flexShrink: 0 }} />
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Not deployed yet</p>
        )}
      </div>

      {/* 2. Website hosting */}
      <div style={{ marginBottom: 16 }}>
        <h4 className="sb-h4-grey">Website hosting</h4>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.85rem', color: '#111827' }}>propbook.pro/props/{slug || 'yoursitename'}</span>
          <span style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 9999,
            background: isDeployed ? '#d1fae5' : '#f3f4f6',
            color: isDeployed ? '#16a34a' : '#9ca3af',
          }}>
            {isDeployed ? 'Y' : 'N'}
          </span>
        </div>
      </div>

      {/* 3. File Path On Server */}
      <div style={{ marginBottom: 16 }}>
        <h4 className="sb-h4-grey">File Path On Server</h4>
        {filePath ? (
          <p style={{ fontSize: '0.8rem', color: '#374151', wordBreak: 'break-all' }}>{filePath}</p>
        ) : (
          <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>File path will be shown after first deploy to Hostinger.</p>
        )}
      </div>

      {/* 4. Get a custom domain */}
      <div style={{ marginBottom: 16 }}>
        <h4 className="sb-h4-grey">Get a custom domain</h4>
        <a href={domainSearchUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem', color: '#2563eb', textDecoration: 'underline' }}>Hostinger</a>
      </div>

      {/* 5. Point your custom domain DNS here */}
      <div style={{ marginBottom: 16 }}>
        <h4 className="sb-h4-grey">Point your custom domain DNS here</h4>
        <p style={{ fontSize: '0.8rem', color: '#374151', lineHeight: 1.5 }}>
          Deploy to Hostinger first to get your server IP. Use cname.propbook.pro as a temporary CNAME target.
        </p>
      </div>

      {/* 6. Site improvements */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: '0.85rem', color: '#111827' }}>Enable website developer updates</p>
          <Toggle checked={devUpdates} onChange={setDevUpdates} />
        </div>
      </div>

      {/* 7. Dev Notifications */}
      <div style={{ marginBottom: 0 }}>
        <h4 className="sb-h4-grey">Dev Notifications</h4>
        <p style={{ fontSize: '0.85rem', color: '#111827' }}>0</p>
      </div>
    </div>
  );
}

function ContactSection({ user, isEditing, fields, onChange, userProperties, activeProperty, showPropertySwitcher, setShowPropertySwitcher, handleSwitchProperty }: {
  user: Profile; isEditing: boolean;
  fields: { full_name: string; email: string; phone_number: string };
  onChange: React.Dispatch<React.SetStateAction<{ full_name: string; email: string; phone_number: string }>>;
  userProperties: Property[]; activeProperty: Property | null;
  showPropertySwitcher: boolean; setShowPropertySwitcher: React.Dispatch<React.SetStateAction<boolean>>;
  handleSwitchProperty: (prop: Property) => void;
}) {
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    if (!isEditing) { setShowPasswordForm(false); setOldPassword(''); setNewPassword(''); setPwError(null); setPwSuccess(false); }
  }, [isEditing]);

  const handlePasswordChange = async () => {
    if (!oldPassword || !newPassword) { setPwError('Both fields are required.'); return; }
    if (newPassword.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    setPwSaving(true); setPwError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: user.email, password: oldPassword });
      if (signInError) throw new Error('Current password is incorrect.');
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setPwSuccess(true); setOldPassword(''); setNewPassword('');
      setTimeout(() => { setShowPasswordForm(false); setPwSuccess(false); }, 2500);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally { setPwSaving(false); }
  };

  return (
    <div>
      <div className="py-3">
        <h4 className="sb-h4-grey">Role</h4>
        <p className="sb-field-value"><span className="font-bold">{user.role === 'admin' ? 'Super Host' : user.role === 'saas_admin' ? 'SaaS Admin' : 'Guest'}</span>{user.role === 'admin' && <span className="font-normal text-gray-500"> (New Site Admin)</span>}</p>
      </div>
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Name</h4>
        {isEditing
          ? <input type="text" value={fields.full_name} onChange={e => onChange(p => ({ ...p, full_name: e.target.value }))} className="sb-input" />
          : <p className="sb-field-value">{fields.full_name || '—'}</p>}
      </div>
      <div className="sb-field-row">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 className="sb-h4-grey" style={{ marginBottom: 0 }}>Email</h4>
          <span className="val-color">Verified</span>
        </div>
        <p className="sb-field-value">{user.email}</p>
      </div>
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Tel</h4>
        {isEditing
          ? <input type="tel" value={fields.phone_number} onChange={e => onChange(p => ({ ...p, phone_number: e.target.value }))} className="sb-input" />
          : <p className="sb-field-value">{fields.phone_number || '—'}</p>}
      </div>
      <div className="py-3 last:border-0">
        <div className="flex items-center justify-between mb-0.5">
          <h4 className="sb-h4-grey">Password</h4>
          {isEditing && !showPasswordForm && <button onClick={() => setShowPasswordForm(true)} className="text-xs text-green-600 hover:text-green-700 font-semibold">Change</button>}
        </div>
        {!isEditing || !showPasswordForm ? (
          <p className="text-base font-bold text-gray-900">••••••••</p>
        ) : (
          <div className="mt-2 space-y-2">
            {pwSuccess ? (
              <div className="flex items-center gap-2 bg-green-50 rounded-lg px-3 py-2"><CheckCircle className="h-4 w-4 text-green-600" /><p className="text-sm font-semibold text-green-700">Password updated!</p></div>
            ) : (
              <>
                <div className="relative">
                  <input type={showOld ? 'text' : 'password'} value={oldPassword} onChange={e => setOldPassword(e.target.value)} placeholder="Current password" className="w-full text-sm text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-2 pr-9 focus:outline-none focus:border-gray-500" />
                  <button type="button" onClick={() => setShowOld(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">{showOld ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
                <div className="relative">
                  <input type={showNew ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password (min 8 characters)" className="w-full text-sm text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-2 pr-9 focus:outline-none focus:border-gray-500" />
                  <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">{showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
                {pwError && <p className="text-xs text-red-600">{pwError}</p>}
                <div className="flex gap-2">
                  <button onClick={handlePasswordChange} disabled={pwSaving} className="flex-1 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg py-2 disabled:opacity-50">{pwSaving ? 'Updating...' : 'Update Password'}</button>
                  <button onClick={() => { setShowPasswordForm(false); setPwError(null); setOldPassword(''); setNewPassword(''); }} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">Cancel</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {/* Property switcher — moved to the bottom of Contact (David: was too
          prominent sitting at the top) and given its own heading. */}
      {userProperties.length >= 1 && (
        <div className="py-3" style={{ borderTop: '1px solid #f3f4f6', marginTop: 4 }}>
          <h4 className="sb-h4-grey">Linked property</h4>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowPropertySwitcher(v => !v)}
              style={{
                background: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                width: '100%',
              }}
            >
              <span style={{ flex: 1, textAlign: 'left', color: '#374151' }}>
                {activeProperty?.name || activeProperty?.title || activeProperty?.slug || 'Switch property'}
              </span>
              <ChevronDown className="h-3 w-3" style={{ opacity: 0.6 }} />
            </button>
            {showPropertySwitcher && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 9999,
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                maxHeight: '200px',
                overflowY: 'auto',
                marginTop: '2px',
              }}>
                {userProperties.map(prop => (
                  <button
                    key={prop.id}
                    onClick={() => handleSwitchProperty(prop)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      width: '100%',
                      padding: '8px 12px',
                      background: prop.id === activeProperty?.id ? '#f0fdf4' : 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '13px',
                      textAlign: 'left',
                      gap: '8px',
                    }}
                  >
                    {prop.id === activeProperty?.id && <Check className="h-3 w-3 text-green-500" />}
                    <span style={{ color: prop.id === activeProperty?.id ? '#166534' : '#374151' }}>
                      {prop.name || prop.title || prop.slug}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BankingSection({ connectData, connectLoading, connectOnboarding, payoutLoading, payoutSuccess, onOnboard, onRequestPayout }: {
  connectData: StripeConnectData | null; connectLoading: boolean;
  connectOnboarding: boolean; payoutLoading: boolean; payoutSuccess: boolean;
  onOnboard: () => void; onRequestPayout: () => void;
}) {
  const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // The 2% platform fee is already collected at booking time (application_fee_amount on
  // the destination charge), so a connected account's available_balance here is already
  // net of it. This used to deduct a SECOND 2% for display (matching a now-fixed backend
  // bug in stripe-connect's payout action that tried to skim an extra 2% via a broken
  // `destination: "self"` transfer) -- hosts were shown, and actually paid, less than their
  // real balance. Payout is the full available balance now, no further deduction.
  const payoutAmount = connectData ? connectData.available_balance : 0;
  return (
    <div>
      <div className="py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h4 className="sb-h4-grey">Stripe Payout Account</h4>
          {connectLoading && <InlineLoader />}
        </div>
        {connectData ? (
          <div className="space-y-3">
            {connectData.details_submitted && connectData.bank_account ? (
              /* ✅ Success state — fully linked */
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                  <p className="text-sm font-bold text-green-800">Bank Account Connected</p>
                </div>
                <p className="text-base font-semibold text-gray-900 pl-7">{connectData.bank_account.bank_name} ••••{connectData.bank_account.last4}</p>
                <div className="pl-7 space-y-1">
                  <p className="text-xs text-gray-500">Account ID: {connectData.account_id.replace('acct_', 'acct_xxxx')}</p>
                  <div className="flex items-center gap-3 text-xs">
                    <span className={`font-semibold px-2 py-0.5 rounded-full ${connectData.charges_enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>Charges: {connectData.charges_enabled ? 'Enabled' : 'Disabled'}</span>
                    <span className={`font-semibold px-2 py-0.5 rounded-full ${connectData.payouts_enabled ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>Payouts: {connectData.payouts_enabled ? 'Enabled' : 'Pending'}</span>
                  </div>
                </div>
                {/* David: bank account can be attached (details_submitted=true) while
                    Stripe still has an outstanding requirement (e.g. identity document)
                    blocking charges_enabled -- this state used to look "done" with no
                    way to act on it. Surface a way back into onboarding whenever
                    charges are still disabled. */}
                {!connectData.charges_enabled && (
                  <div className="pl-7 pt-1">
                    <button onClick={onOnboard} disabled={connectOnboarding} className="text-xs font-semibold text-red-700 underline disabled:opacity-50">{connectOnboarding ? 'Redirecting...' : 'Finish Verification'}</button>
                  </div>
                )}
              </div>
            ) : connectData.account_id && !connectData.details_submitted ? (
              /* ⚠️ Setup in progress */
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                  <p className="text-sm font-bold text-yellow-800">Setup In Progress</p>
                </div>
                <p className="text-xs text-gray-500 pl-7">Stripe onboarding not yet complete. You can still receive bookings while you finish setup.</p>
                <div className="pl-7 mt-1">
                  <button onClick={onOnboard} disabled={connectOnboarding} className="text-xs font-semibold text-green-700 underline disabled:opacity-50">{connectOnboarding ? 'Redirecting...' : 'Continue Stripe Setup'}</button>
                </div>
              </div>
            ) : null}
            {connectData.details_submitted && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-50 rounded-lg p-2.5"><h4 className="sb-h4-grey">Available</h4><p className="text-base font-bold text-gray-900">{fmt(connectData.available_balance)}</p></div>
                  <div className="bg-gray-50 rounded-lg p-2.5"><h4 className="sb-h4-grey">Pending</h4><p className="text-base font-bold text-gray-900">{fmt(connectData.pending_balance)}</p></div>
                </div>
                {connectData.available_balance > 0 && connectData.payouts_enabled && (
                  <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between text-sm"><span className="text-gray-600">Available balance</span><span className="font-semibold text-gray-900">{fmt(connectData.available_balance)}</span></div>
                    <div className="border-t border-gray-100 pt-2 flex justify-between text-sm"><span className="font-bold text-gray-900">You receive</span><span className="font-bold text-green-700">{fmt(payoutAmount)}</span></div>
                    {payoutSuccess
                      ? <div className="flex items-center justify-center gap-2 bg-green-50 rounded-lg py-2"><CheckCircle className="h-4 w-4 text-green-600" /><span className="text-sm font-semibold text-green-700">Payout initiated!</span></div>
                      : <button onClick={onRequestPayout} disabled={payoutLoading} className="w-full bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg py-2 disabled:opacity-50">{payoutLoading ? 'Processing...' : 'Request Payout'}</button>
                    }
                  </div>
                )}
              </>
            )}
            {!connectData.details_submitted && (
              <button onClick={onOnboard} disabled={connectOnboarding} className="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-lg py-2 disabled:opacity-50">{connectOnboarding ? 'Redirecting...' : 'Complete Account Setup'}</button>
            )}
          </div>
        ) : connectLoading ? <Loader /> : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Connect a Stripe account to receive payouts when guests book your property. We take a 2% platform fee on each payout.</p>
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-700 mb-1">Test mode</p>
              <p className="text-xs text-gray-500">Use test card <span className="font-mono font-bold">4242 4242 4242 4242</span> during onboarding.</p>
            </div>
            <button onClick={onOnboard} disabled={connectOnboarding} className="w-full bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg py-2.5 disabled:opacity-50 flex items-center justify-center gap-2">
              <CreditCard className="h-4 w-4" />{connectOnboarding ? 'Redirecting to Stripe...' : 'Set Up Payout Account'}
            </button>
          </div>
        )}
      </div>
      <div className="py-3">
        <h4 className="sb-h4-grey">Publishable Key</h4>
        <p className="sb-mono">{import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ? import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY.slice(0, 24) + '…' : 'Not configured'}</p>
      </div>
    </div>
  );
}

const SERVICE_LIST: { key: ServiceKey; label: string; price: string }[] = [
  { key: 'aiSeo', label: 'AI SEO', price: '$10 p/m' },
  { key: 'marketing', label: 'Marketing', price: '$10 p/m' },
  { key: 'advertising', label: 'Advertising', price: '$20 p/m' },
  { key: 'analytics', label: 'Analytics', price: '$10 p/m' },
  { key: 'influencers', label: 'Influencers', price: '$50 p/m' },
  { key: 'social', label: 'Social', price: '$50 p/m' },
];

function ServicesSection({ services, onToggle }: { services: Record<ServiceKey, boolean>; onToggle: (key: ServiceKey, val: boolean) => void }) {
  return (
    <div>
      <p className="sb-services-desc">Limited availability. Our team of experts work directly on your property marketing and services.</p>
      {SERVICE_LIST.map(({ key, label, price }) => (
        <div key={key} className="sb-service-row">
          <div className="sb-service-info"><p id={`svc-name-${key}`} className="sb-service-name" style={{padding:0}}>{label}</p><p id={`svc-price-${key}`} className="sb-service-price" style={{padding:0}}>{price}</p></div>
          <Toggle checked={services[key]} onChange={val => onToggle(key, val)} />
        </div>
      ))}
    </div>
  );
}

// David: only Starter ($10/mo) is real, published pricing on propbook.pro right
// now -- Growth/Pro were placeholder tiers with made-up prices that don't match
// any actual Stripe price (and would have silently billed the Starter $10 price
// under a "Growth $79" label). Down to the one plan that's actually for sale,
// with the exact copy from the pricing page (2026-09-22).
const PLANS = [
  {
    key: 'starter' as const,
    name: 'Starter',
    price: 10,
    description: 'Get your property online with its own hosted, SEO-ready site.',
    features: ['x1 property website', 'Hosting server', 'Software subscription', 'Basic AI optimized SEO'],
  },
];

function SubscriptionSection({ subscription, loading, checkoutLoading, onSubscribe }: {
  subscription: SubscriptionData | null; loading: boolean;
  checkoutLoading: string | null; onSubscribe: (plan: 'starter' | 'growth' | 'pro') => void;
}) {
  if (loading && !subscription) return <Loader />;
  if (subscription?.status === 'active' || subscription?.status === 'trialing') {
    const isTrialing = subscription.status === 'trialing';
    return (
      <div>
        <div className="py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Plan</p>
              <p className="text-base font-bold text-gray-900">
                {subscription.plan === 'starter' ? 'Prop Book Starter Plan' :
                 subscription.plan === 'pro' ? 'Pro' :
                 subscription.plan === 'agency' ? 'Agency' : subscription.plan}
              </p>
            </div>
            <span className={`text-sm font-semibold px-3 py-1 rounded-full ${isTrialing ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{isTrialing ? 'Trial' : 'Active'}</span>
          </div>
        </div>
        <div className="py-3 grid grid-cols-2 gap-4">
          <div><h4 className="sb-h4-grey">Amount</h4><p className="text-base font-bold text-gray-900">${subscription.amount > 0 ? (subscription.amount / 100).toFixed(2) : '–'}<span className="text-sm font-normal text-gray-500">/{subscription.interval}</span></p></div>
          <div><h4 className="sb-h4-grey">{isTrialing ? 'Trial Ends' : 'Next Payment'}</h4><p className="text-base font-bold text-gray-900">{subscription.current_period_end ? format(fromUnixTime(subscription.current_period_end), 'MMM d, yyyy') : '–'}</p></div>
        </div>
        {subscription.cancel_at_period_end && <div className="py-3"><div className="flex items-center gap-2 text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2"><AlertCircle className="h-4 w-4" /><p className="text-xs font-medium">Cancels at end of billing period</p></div></div>}
        <div className="py-3"><h4 className="sb-h4-grey">Subscription ID</h4><p className="sb-mono">{subscription.id}</p></div>
        <div className="py-3" style={{ borderTop: '1px solid #f3f4f6', marginTop: 4 }}>
          <button
            onClick={() => onSubscribe('starter')}
            disabled={!!checkoutLoading}
            className="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-lg py-2 disabled:opacity-50"
          >
            {checkoutLoading ? 'Loading...' : 'Change Plan / Resubscribe'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="sb-sub-desc">Choose a plan to go live with your property and unlock all platform features.</p>
      <div className="bg-blue-50 rounded-lg p-3 mb-4">
        <p className="text-xs font-semibold text-gray-700 mb-1">Test mode</p>
        <p className="text-xs text-gray-500">Use card <span className="font-mono font-bold">4242 4242 4242 4242</span>, any future expiry, any 3-digit CVC. Checkout opens in a new tab in dev.</p>
      </div>
      <div className="space-y-3">
        {PLANS.map(plan => (
          <div key={plan.key} className={`sb-plan-card${plan.popular ? ' is-popular' : ''}`}>
            {plan.popular && <span className="sb-plan-badge">Most Popular</span>}
            <div className="sb-plan-header">
              <div><p className="sb-plan-name">{plan.name}</p><p className="sb-plan-price">${plan.price}<span className="text-xs">/month</span></p></div>
              <button onClick={() => onSubscribe(plan.key)} disabled={checkoutLoading === plan.key} className={`text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${plan.popular ? 'bg-gray-900 hover:bg-gray-800 text-white' : 'border border-gray-300 hover:bg-gray-50 text-gray-700'}`}>{checkoutLoading === plan.key ? 'Loading...' : 'Subscribe'}</button>
            </div>
            {plan.description && <p className="sb-sub-desc" style={{ margin: '4px 0 10px' }}>{plan.description}</p>}
            <ul className="sb-plan-features">{plan.features.map(f => <li key={f}><Check className="h-3 w-3" />{f}</li>)}</ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SECTION 6 — AdminSidebar (main export)
// ─────────────────────────────────────────────

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  mockMode?: boolean;
  onPropertyLoaded?: (name: string) => void;
  onOpenOnboarding?: () => void;
  showGetSite?: boolean;
  setShowGetSite?: (v: boolean) => void;
}

type Section = 'bookings' | 'property' | 'edit' | 'website' | 'seo' | 'contact' | 'banking' | 'services' | 'subscription';

interface NextBooking {
  guestName: string; location: string; guestCount: number; nights: number;
  startDay: number; endDay: number; month: string; status: string;
}

export function AdminSidebar({ isOpen, onClose, mockMode = false, onPropertyLoaded}: AdminSidebarProps) {
  const { user, signOut, refreshUser } = useAuth();
  const navigate = useNavigate();
  const setPropertyTitle = useProperty(s => s.setTitle);
  const isAdmin = user?.role === 'admin';

  // ── Property switcher ─────────────────────────────────────────────────────────
  const [userProperties, setUserProperties] = useState<Property[]>([]);
  const [showPropertySwitcher, setShowPropertySwitcher] = useState(false);
  useEffect(() => {
    if (!user || !isOpen) return;
    supabase.from('properties').select('*').eq('owner_id', user.id).order('created_at', { ascending: true })
      .then(({ data }) => { if (data) setUserProperties(data); });
  }, [user, isOpen]);

  const activeProperty = useProperty(s => s.activeProperty);

  // ── Derive current slug from URL — available immediately, no timing issues ──
  const currentSlug = (() => {
    if (typeof window === 'undefined') return '';
    const match = window.location.pathname.match(/\/props\/([^/]+)/);
    return match ? match[1] : '';
  })();

  // ── Handle property switch ─────────────────────────────────────────────────────
  const handleSwitchProperty = (prop: Property) => {
    setShowPropertySwitcher(false);
    // David: switching properties via react-router's navigate() left the old
    // property's data (router basename, window.__PROPERTY_DATA__, this
    // sidebar's own loaded state) sitting in memory alongside the new one --
    // each /props/<slug> bundle's basename is pinned to whichever property
    // was in its ORIGINAL static index.html, so a client-side nav to a
    // different slug never resets it. A real navigation (full page load)
    // is the only thing that boots the destination property cleanly.
    window.location.href = `/props/${prop.slug}`;
  };

  // ── Determine if current URL slug belongs to this user ─────────────────────────
  // This is the authoritative access check — independent of activeProperty timing.
  const isCurrentSlugOwnedByUser = currentSlug
    ? userProperties.some(p => p.slug === currentSlug)
    : true;

  // David: "no admin sidebar" turned out to mean the sidebar mounted fine but
  // showed almost nothing -- navItems, the Credentials card and the Publish
  // button were all gated on `isAdmin` (role==='admin', a true platform-staff
  // flag), not on "does this account own the property being managed". Every
  // ordinary signed-up owner (role: 'user') hit this, not just today's test
  // accounts -- they could never see Property/Website/SEO/Banking/
  // Subscription or the Publish button at all. Reusing isCurrentSlugOwnedByUser
  // here (rather than inventing a new check) keeps this exactly as permissive
  // as showLockedState already is: a real admin still gets full access
  // everywhere (migration untouched), and any non-admin who got this far
  // without hitting the lock screen is, by construction, on their own
  // property.
  const canManageProperty = isAdmin || isCurrentSlugOwnedByUser;

  // ── "Go to My Property" — navigate to first owned property ─────────────────────
  const goToMyProperty = () => {
    const myProp = userProperties[0];
    if (myProp) {
      // Full page load, not navigate() -- see handleSwitchProperty above.
      window.location.href = `/props/${myProp.slug}`;
    } else {
      useProperty.getState().setActiveProperty(null);
      setIsAccessDenied(false);
    }
  };

  const [openSection, setOpenSection] = useState<Section | null>(null);
  const [bookingCardOpen, setBookingCardOpen] = useState(false);
  const [showCredentials, setShowCredentials] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isAccessDenied, setIsAccessDenied] = useState(false);

  // David: "Property conflict" modal -- admin accounts must keep full,
  // uninterrupted access to any property (that's how migration/site-building
  // work happens), so this is a dismissible heads-up, never a hard lock like
  // showLockedState below. Dismissal is tracked per-slug so switching to
  // ANOTHER unowned property re-prompts, but re-opening the sidebar on the
  // same page/slug doesn't nag repeatedly.
  const [showPropertyConflict, setShowPropertyConflict] = useState(false);
  const dismissedConflictSlugRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAdmin || !currentSlug || userProperties.length === 0) {
      setShowPropertyConflict(false);
      return;
    }
    if (isCurrentSlugOwnedByUser) {
      setShowPropertyConflict(false);
      return;
    }
    if (dismissedConflictSlugRef.current === currentSlug) return;
    setShowPropertyConflict(true);
  }, [isAdmin, currentSlug, userProperties, isCurrentSlugOwnedByUser]);

  const [bookings, setBookings] = useState<(Booking & { property: Property; user: Profile })[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [nextBooking, setNextBooking] = useState<NextBooking | null>(null);
  const [imageCount, setImageCount] = useState(0);
  const [property, setProperty] = useState<Property | null>(null);
  // Direct property data — set immediately in loadData query, bypasses broken setProperty chain
  const sidebarPropertyDataRef = useRef<any | null>(null);

  const [connectData, setConnectData] = useState<StripeConnectData | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectOnboarding, setConnectOnboarding] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutSuccess, setPayoutSuccess] = useState(false);

  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const [propFields, setPropFields] = useState({ title: '', property_headline: '', property_intro: '', address: '', latitude: '', longitude: '', location_type: 'coordinates' as 'address' | 'coordinates', bedrooms: '', beds: '', baths: '', max_guests: '' });
  // Load AI/SEO file toggle defaults from sessionStorage (persisted across sessions)
  const getDefaultSeoFields = () => {
    try {
      const stored = sessionStorage.getItem('seo_file_toggles');
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return null;
  };
  const defaultSeoFields = getDefaultSeoFields();
  const [seoFields, setSeoFields] = useState({
    meta_description: '',
    og_image_url: '',
    google_business_url: '',
    robots_noindex: false,
    custom_page_title: '',
    google_verification: '',
    generate_robots_txt: defaultSeoFields?.generate_robots_txt ?? true,
    generate_sitemap_xml: defaultSeoFields?.generate_sitemap_xml ?? true,
    generate_llms_txt: defaultSeoFields?.generate_llms_txt ?? true,
    generate_faq_ai_txt: defaultSeoFields?.generate_faq_ai_txt ?? true,
  });
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [contactFields, setContactFields] = useState({ full_name: '', email: '', phone_number: '' });
  const [devUpdates, setDevUpdates] = useState(true);
  const [services, setServicesState] = useState<Record<ServiceKey, boolean>>({ aiSeo: false, marketing: false, advertising: false, analytics: false, influencers: false, social: false });

  // Fresh refs — always read current user without closure staleness
  const userRef = useRef(user);
  userRef.current = user;
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;
  // David 2026-09-22: loadData() re-fires whenever userProperties.length changes
  // (e.g. right after a brand-new property is created and counted in), and it
  // unconditionally overwrote propFields/seoFields with fresh DB values -- if the
  // admin was mid-edit (typing the headline) when that refire landed, their
  // in-progress keystroke got stomped by the pre-edit DB value the instant it
  // loaded. Mirror isEditing into a ref so loadData's closure always sees the
  // CURRENT edit state, not the one from whenever loadData was defined.
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
  // Guard against concurrent loadData calls (e.g., both [isOpen] and [user] effects firing)
  const isLoadingRef = useRef(false);

    useEffect(() => {
    if (!isOpen) return;
    loadData();
    loadConnectData();
    loadSubscriptionData();
  }, [isOpen, userProperties.length]); // Re-run when userProperties loads so slug-based isolation check is accurate

  // User data is already set by App.tsx initialize() + onAuthStateChange listener.
  // No need to re-fetch on every user change — sidebar loads fresh data on [isOpen] anyway.

  const loadData = async () => {
    // Skip if a loadData call is already in progress — prevents double-fire flicker
    if (isLoadingRef.current) {
      console.log('[AdminSidebar loadData] SKIPPED — another call already in progress');
      return;
    }
    isLoadingRef.current = true;
    const currentUser = userRef.current;
    const currentIsAdmin = isAdminRef.current;
    if (!currentUser) {
      isLoadingRef.current = false;
      return;
    }

    // ── Property isolation guard — two-layer check ─────────────────────────────────────────
    // Layer 1 (activeProperty): Works when CustomerSite has already set the active property.
    // Layer 2 (slug): Works immediately on mount — doesn't wait for CustomerSite to load.
    // Admins bypass this guard during the migration period.
    const urlSlug = (() => {
      const m = window.location.pathname.match(/\/props\/([^/]+)/);
      return m ? m[1] : '';
    })();
    const slugOwnedByUser = urlSlug ? userProperties.some((p: Property) => p.slug === urlSlug) : true;

    if (!currentIsAdmin && !slugOwnedByUser) {
      // Non-admin visiting a property they don't own — deny access
      console.log('[AdminSidebar loadData] 🚫 ACCESS DENIED — slug', urlSlug, 'not owned by user', currentUser.id);
      setIsAccessDenied(true);
      isLoadingRef.current = false;
      return;
    }
    if (!currentIsAdmin && slugOwnedByUser && isAccessDenied) {
      // User owns the slug and was previously denied — clear the lock
      setIsAccessDenied(false);
    }
    console.log('[AdminSidebar loadData] START user:', currentUser.id, 'isAdmin:', currentIsAdmin, 'role:', currentUser.role);
    // Don't pre-clear bookings — the async query will populate them when ready.
    setNextBooking(null);
    setBookingError(null);
    setBookingsLoading(true);
    try {
      console.log('[AdminSidebar loadData] TRY BLOCK ENTRY');

      // Step 1: Get property_id from onboarding_data (fast, reliable — avoids owner_id match issues)
      let propertyRecord: any = null;
      let od: { property_id?: string; property_headline?: string } | null = null;

      // David: an admin visiting a property they don't own (migration work --
      // must keep working, never gated) used to ALWAYS load via onboarding_data/
      // owner_id keyed to the ADMIN'S OWN account here, regardless of which
      // property's URL they were actually on. That's the "signed in as AI, saw
      // AI's copy on surfhousebaja's page" bug -- the access bypass below was
      // never the problem, this lookup ignoring the URL was. Non-admins can't
      // hit this: the guard above already returns early unless slugOwnedByUser,
      // so for them "my own property" and "the slug I'm on" are the same
      // property by construction. Only admins need the slug-first branch.
      if (currentIsAdmin && urlSlug && !slugOwnedByUser) {
        console.log('[AdminSidebar loadData] Admin viewing a property they don\'t own — loading by URL slug:', urlSlug);
        const { data: propData } = await supabase
          .from('properties')
          .select('*')
          .eq('slug', urlSlug)
          .maybeSingle();
        propertyRecord = propData;
      } else {
        const odRes = await supabase
          .from('onboarding_data')
          .select('property_id, property_headline')
          .eq('user_id', currentUser.id)
          .maybeSingle();
        od = odRes.data;

        if (od?.property_id) {
          console.log('[AdminSidebar loadData] Found property_id in onboarding_data:', od.property_id);
          const { data: propData } = await supabase
            .from('properties')
            .select('*')
            .eq('id', od.property_id)
            .single();
          propertyRecord = propData;
        } else {
          console.log('[AdminSidebar loadData] No onboarding_data property_id, falling back to owner_id lookup');
          const { data: propData } = await supabase
            .from('properties')
            .select('*')
            .eq('owner_id', currentUser.id)
            .limit(1)
            .maybeSingle();
          propertyRecord = propData;
        }
      }
      // ✅ Set property state IMMEDIATELY — don't wait for bookings/profile queries
      const pd = propertyRecord;
      if (pd?.images) setImageCount(pd.images.length);
      if (pd) {
        console.log('[AdminSidebar loadData] ✅ PROPERTY FOUND — setting fields + ref. pd.title:', pd.title);
        sidebarPropertyDataRef.current = pd;
        setProperty(pd);
        // Notify parent (App.tsx) of the property name so it can update the page title
        const propName = pd.name || pd.title;
        if (propName && onPropertyLoaded) {
          onPropertyLoaded(propName);
        }
        // Don't clobber an in-progress edit: loadData() can be re-triggered (e.g.
        // userProperties.length changing right after this very property was created)
        // while the admin is actively typing in one of these fields -- see isEditingRef
        // comment above. Only apply fresh DB values when not mid-edit.
        if (!isEditingRef.current) {
        setPropFields({ title: pd.name || pd.title || '', property_headline: pd.property_headline || od?.property_headline || '', property_intro: pd.property_intro || '', address: pd.address || '', latitude: pd.latitude?.toString() || '', longitude: pd.longitude?.toString() || '', location_type: (pd.location_type as 'address' | 'coordinates') || 'coordinates', bedrooms: pd.bedrooms?.toString() || '', beds: pd.beds?.toString() || '', baths: pd.bathrooms?.toString() || '', max_guests: pd.max_guests?.toString() || '' });
        }
        // David (item 11): SEO section should pull its page title / meta
        // description from the website name and property description when
        // the admin hasn't explicitly set a custom SEO value -- these are
        // only fallback DEFAULTS, an explicit custom_page_title/
        // meta_description already saved on the property always wins.
        const websiteNameFallback = pd.name || pd.title || '';
        const propertyDescriptionFallback = pd.property_intro || pd.description || '';
        if (!isEditingRef.current) {
        setSeoFields(prev => ({
          meta_description: pd.meta_description || propertyDescriptionFallback || '',
          og_image_url: pd.og_image_url || '',
          google_business_url: pd.google_business_url || '',
          robots_noindex: pd.robots_noindex ?? false,
          custom_page_title: pd.custom_page_title || websiteNameFallback || '',
          google_verification: pd.google_verification || '',
          // Preserve local sessionStorage defaults for new toggle fields
          generate_robots_txt: prev.generate_robots_txt,
          generate_sitemap_xml: prev.generate_sitemap_xml,
          generate_llms_txt: prev.generate_llms_txt,
          generate_faq_ai_txt: prev.generate_faq_ai_txt,
        }));
        }
      } else {
        console.warn('[AdminSidebar loadData] ⚠️ pd falsy — NOT calling setProperty');
        sidebarPropertyDataRef.current = null;
      }

      // Fire-and-forget: load bookings + profile WITHOUT blocking property display
      // Using .then() instead of await so these slow queries can't block state updates
      console.log('[AdminSidebar DEBUG] currentIsAdmin:', currentIsAdmin, 'slugOwnedByUser:', slugOwnedByUser, 'propertyRecord.id:', propertyRecord?.id);
      // Property owners (not just staff admins) should see bookings ON their property, not be treated as guests.
      if (currentIsAdmin || slugOwnedByUser) {
        supabase.from('bookings').select('*, property:properties(*), user:profiles(*)').eq('property_id', propertyRecord.id).order('created_at', { ascending: false }).then((bookingsRes) => {
          console.log('[AdminSidebar DEBUG bookings]', bookingsRes.data?.length, 'error:', bookingsRes.error);
          if (bookingsRes.data) {
            const valid = bookingsRes.data.filter((b: any) => b && b.property);
            console.log('[AdminSidebar DEBUG] valid bookings count:', valid.length);
            setBookings(valid);
            const now = new Date();
            const pending = valid.filter((b: any) => b.status === 'pending').sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
            const upcoming = valid.filter((b: any) => b.status === 'approved' && new Date(b.start_date) >= now).sort((a: any, b: any) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())[0];
            const featured = pending || upcoming;
            if (featured) {
              const [sy, sm, sd] = featured.start_date.slice(0, 10).split('-').map(Number);
              const [ey, em, ed] = featured.end_date.slice(0, 10).split('-').map(Number);
              const start = new Date(sy, sm - 1, sd);
              const endDate = new Date(ey, em - 1, ed);
              const nights = Math.ceil(Math.abs(endDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
              setNextBooking({ guestName: featured.user?.full_name || 'Guest', location: featured.property?.address || featured.property?.title || '', guestCount: featured.guest_count, nights, startDay: sd, endDay: ed, month: format(start, 'MMM').toUpperCase(), status: featured.status });
            } else setNextBooking(null);
          }
        });
        supabase.from('profiles').select('services_ai_seo, services_marketing, services_advertising, services_analytics, services_influencers, services_social, stripe_account_id, stripe_account_status').eq('id', currentUser.id).maybeSingle().then((profileRes) => {
          if (profileRes.data) {
            setServicesState({ aiSeo: profileRes.data.services_ai_seo ?? false, marketing: profileRes.data.services_marketing ?? false, advertising: profileRes.data.services_advertising ?? false, analytics: profileRes.data.services_analytics ?? false, influencers: profileRes.data.services_influencers ?? false, social: profileRes.data.services_social ?? false });
          }
        });
      } else {
        supabase.from('bookings').select('*, property:properties(*), user:profiles(*)').eq('user_id', currentUser.id).order('created_at', { ascending: false }).then((bookingsRes) => {
          if (bookingsRes.data) {
            const valid = bookingsRes.data.filter((b: any) => b && b.property);
            setBookings(valid);
          }
        });
        // Set nextBooking for non-admin from their guest bookings
        supabase.from('bookings').select('*, property:properties(*), user:profiles(*)').eq('user_id', currentUser.id).order('created_at', { ascending: false }).then((guestBookingsRes) => {
          if (guestBookingsRes.data) {
            const valid = guestBookingsRes.data.filter((b: any) => b && b.property);
            const now = new Date();
            const upcoming = valid.filter((b: any) => b.status === 'approved' && new Date(b.start_date) >= now).sort((a: any, b: any) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())[0];
            const pending = valid.filter((b: any) => b.status === 'pending').sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
            const featured = pending || upcoming;
            if (featured) {
              const [sy, sm, sd] = featured.start_date.slice(0, 10).split('-').map(Number);
              const [ey, em, ed] = featured.end_date.slice(0, 10).split('-').map(Number);
              const start = new Date(sy, sm - 1, sd);
              const endDate = new Date(ey, em - 1, ed);
              const nights = Math.ceil(Math.abs(endDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
              setNextBooking({ guestName: featured.user?.full_name || 'Guest', location: featured.property?.address || featured.property?.title || '', guestCount: featured.guest_count, nights, startDay: sd, endDay: ed, month: format(start, 'MMM').toUpperCase(), status: featured.status });
            }
          }
        });
      }
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setBookingsLoading(false);
      isLoadingRef.current = false;
    }
  };

  useEffect(() => {
    if (user) setContactFields({ full_name: user.full_name || '', email: user.email || '', phone_number: user.phone_number || '' });
  }, [user]);

  const saveServices = async (updated: Record<ServiceKey, boolean>) => {
    if (!user) return;
    await supabase.from('profiles').update({ services_ai_seo: updated.aiSeo, services_marketing: updated.marketing, services_advertising: updated.advertising, services_analytics: updated.analytics, services_influencers: updated.influencers, services_social: updated.social }).eq('id', user.id);
  };

  const handleServiceToggle = (key: ServiceKey, val: boolean) => {
    const updated = { ...services, [key]: val };
    setServicesState(updated);
    saveServices(updated);
  };

  const getSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No session');
    return session;
  };

  const loadConnectData = async () => {
    setConnectLoading(true);
    try {
      const session = await getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-connect`, { headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConnectData(data);
    } catch (err) { console.error(err); } finally { setConnectLoading(false); }
  };

  // Listen for Stripe Connect account ID broadcast from OnboardingPopup / payment success
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.account_id) {
        // Defer state update to avoid "Maximum update depth exceeded" when
        // dispatchEvent fires synchronously during React's passive effect commit.
        queueMicrotask(() => {
          setConnectData(prev => prev ? { ...prev, account_id: d.account_id, charges_enabled: d.charges_enabled } : prev);
        });
      }
    };
    window.addEventListener('stripe-connect-updated', handler);
    return () => window.removeEventListener('stripe-connect-updated', handler);
  }, []);

  // ── RETURN FROM STRIPE CHECKOUT ───────────────────────────────────────
  // Detect ?paid=true in URL (appended by stripe-subscription success_url)
  // and refresh subscription state so sidebar reflects the active plan.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('paid') !== 'true') return;

    // Clear URL params without page reload
    const url = new URL(window.location.href);
    url.searchParams.delete('paid');
    url.searchParams.delete('session_id');
    window.history.replaceState({}, '', url.toString());

    // Refresh user profile first
    refreshUser();

    // Reset subscription state so next loadSubscriptionData() fetches fresh
    setSubscriptionData(null);
    setSubLoading(false);

    // Poll a couple of times — webhook can take 1-2s to fire after payment
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      // Trigger subscription reload next time the sidebar section is opened
      if (attempts >= 2) {
        clearInterval(poll);
        return;
      }
      // Force a direct re-fetch of subscription data
      const session = await getSession().catch(() => null);
      if (!session) return;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-subscription?action=get`,
        { headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } }
      ).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json().catch(() => null);
      if (data?.subscription) {
        setSubscriptionData(data.subscription);
        clearInterval(poll);
      }
    }, 1500);
  }, []);

  // Auto-refresh Stripe connect data when returning from Stripe onboarding
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('return_url') || params.has('stripe_connect_return')) {
      // Clear the param from URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('return_url');
      url.searchParams.delete('stripe_connect_return');
      window.history.replaceState({}, '', url.toString());
      // Refresh banking data
      setConnectData(null);
      setConnectLoading(false);
      loadConnectData();
    }
  }, []);

  // Broadcast Stripe account_id to popup whenever connectData is loaded/updated
  useEffect(() => {
    if (connectData?.account_id) {
      window.dispatchEvent(new CustomEvent('stripe-connect-updated', {
        detail: {
          account_id: connectData.account_id,
          charges_enabled: connectData.charges_enabled,
        },
      }));
    }
  }, [connectData]);

  const loadSubscriptionData = async () => {
    if (subLoading) return;
    setSubLoading(true);
    try {
      const session = await getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-subscription?action=get`, { headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } });
      const data = await res.json();
      if (res.ok && data.subscription) setSubscriptionData(data.subscription);
    } catch (err) { console.error(err); } finally { setSubLoading(false); }
  };

  const handleConnectOnboard = async () => {
    setConnectOnboarding(true);
    try {
      const session = await getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-connect`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY }, body: JSON.stringify({ action: 'create_account_link', return_url: window.location.href }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch { alert('Failed to start Stripe onboarding. Please try again.'); } finally { setConnectOnboarding(false); }
  };

  const handleRequestPayout = async () => {
    if (!connectData || connectData.available_balance <= 0) return;
    setPayoutLoading(true);
    try {
      const session = await getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-connect`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY }, body: JSON.stringify({ action: 'payout' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPayoutSuccess(true); setConnectData(null);
      setTimeout(() => { setPayoutSuccess(false); loadConnectData(); }, 3000);
    } catch { alert('Payout failed. Please try again.'); } finally { setPayoutLoading(false); }
  };

  const handleSubscribeCheckout = async (plan: 'starter' | 'growth' | 'pro') => {
    setCheckoutLoading(plan);
    try {
      const session = await getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-subscription`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY }, body: JSON.stringify({ action: 'create_checkout', plan, return_url: window.location.href }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch { alert('Failed to start checkout. Please try again.'); } finally { setCheckoutLoading(null); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Use property from state, fall back to sidebarPropertyDataRef if not yet loaded
      const propertyId = property?.id || sidebarPropertyDataRef.current?.id;
      console.log('[AdminSidebar handleSave] Saving. property.id:', property?.id, 'ref.id:', sidebarPropertyDataRef.current?.id, 'propFields:', propFields);
      // Admins AND property owners save property fields; everyone else only saves contact info
      if (canManageProperty && propertyId) {
        // Call edge function for property updates — service role key bypasses RLS
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const { data: sessionData } = await supabase.auth.getSession();
        // Resolve name/slug from sessionStorage (source of truth for user-edited website name)
        const liveWebsiteName = sessionStorage.getItem('popup_website_name') || propFields.title || '';
        const liveSlug = liveWebsiteName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');

        const updateRes = await fetch(`${supabaseUrl}/functions/v1/update-property`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionData?.session?.access_token || ''}`,
          },
          body: JSON.stringify({
            id: propertyId,
            name: liveWebsiteName,
            slug: liveSlug,
            title: propFields.title,
            property_headline: propFields.property_headline ?? null,
            property_intro: propFields.property_intro || null,
            address: propFields.address || null,
            latitude: propFields.latitude ? parseFloat(propFields.latitude) : null,
            longitude: propFields.longitude ? parseFloat(propFields.longitude) : null,
            location_type: propFields.location_type,
            bedrooms: propFields.bedrooms ? parseInt(propFields.bedrooms) : null,
            beds: propFields.beds ? parseInt(propFields.beds) : null,
            bathrooms: propFields.baths ? parseInt(propFields.baths) : null,
            max_guests: propFields.max_guests ? parseInt(propFields.max_guests) : null,
            meta_description: seoFields.meta_description || null,
            og_image_url: seoFields.og_image_url || null,
            google_business_url: seoFields.google_business_url || null,
            robots_noindex: seoFields.robots_noindex ?? false,
            custom_page_title: seoFields.custom_page_title || null,
            google_verification: seoFields.google_verification || null,
          }),
        });
        const updateResult = await updateRes.json();
        console.log('[AdminSidebar handleSave] Property update result:', updateResult);
        if (!updateRes.ok || updateResult.error) {
          throw new Error(updateResult.error || `HTTP ${updateRes.status}`);
        }

        // Note: properties table is updated by the update-property edge function above (service role key, bypasses RLS).
        // The direct supabase.update above was overwriting property_headline with '' on every save — removed.

        // Also update onboarding_data so sidebar re-load picks up the new name/slug
        // and property_headline for the GetSite popup flow
        await supabase
          .from('onboarding_data')
          .update({ property_name: liveWebsiteName, slug: liveSlug, property_headline: propFields.property_headline ?? null })
          .eq('user_id', user.id);
      } else if (canManageProperty && !propertyId) {
        console.warn('[AdminSidebar handleSave] No propertyId — skipping property save');
      }
      if (user) {
        await supabase.from('profiles').update({ full_name: contactFields.full_name || null, phone_number: contactFields.phone_number || null }).eq('id', user.id);
      }
      if (canManageProperty && propFields.title) setPropertyTitle(propFields.title);

      // NOTE: Data saves are now independent of code deploys.
      // The published site reads fresh data from Supabase on every load —
      // no redeploy needed when editing site name, headline, description, etc.
      // Use "Republish Site" only when deploying actual React code changes.

      await loadData();
    } catch (err) { console.error('Save failed', err); alert('Save failed: ' + (err instanceof Error ? err.message : err)); } finally { setIsEditing(false); setSaving(false); }
  };

  const handlePublishFromSidebar = async (verifiedSubscription = false) => {
    if (!user) { setPublishError('Not signed in.'); return; }
    if (!property?.id) { setPublishError('No property found. Please reload.'); return; }
    // Publishing (going live) now requires an active subscription -- Stripe payment
    // moved here from GetSite.tsx's old "Create Draft Site" button so users can see
    // their draft before paying. If they're not subscribed yet, send them to the
    // Billing section to pick a plan instead of deploying for free. `verifiedSubscription`
    // lets the post-checkout-return effect below re-call this once it has confirmed
    // payment directly with Stripe, without waiting on React state to catch up.
    // (David, 2026-09-21.)
    if (!hasSubscription && !verifiedSubscription) {
      sessionStorage.setItem('pending_publish_property_id', property.id);
      setOpenSection('subscription');
      setPublishError('Choose a plan below to publish your site.');
      return;
    }
    setPublishLoading(true);
    setPublishError(null);
    try {

      // Reload fresh property data from DB
      const { data: freshProp } = await supabase
        .from('properties')
        .select('title, address, description, hero_image, images, bedrooms, beds, bathrooms, max_guests, slug, property_headline')
        .eq('id', property.id)
        .single();

      const websiteName = sessionStorage.getItem('popup_website_name') || freshProp?.title || property?.title || 'My Property';
      const slug = sessionStorage.getItem('popup_website_name')
        ? sessionStorage.getItem('popup_website_name')!.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-')
        : (property?.slug || websiteName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-'));


      // Use the existing property — don't create a new DB record every publish
      const existingPropertyId = property.id;
      const existingSlug = property.slug || slug;
      // Bare domain, NOT www: the shared bundle's script/link tags
      // (baked into every property's index.html by the SPA template)
      // are hardcoded to //propbook.pro/dev/assets/... with no www. A
      // page served from www.propbook.pro trying to load that script is
      // a cross-origin request as far as the browser is concerned --
      // module scripts enforce CORS, there are no CORS headers on that
      // static file, so it silently fails and the page never renders.
      // Bare domain keeps the redirect same-origin with its own assets.
      const siteUrl = `https://propbook.pro/props/${existingSlug}`;
      sessionStorage.setItem('popup_site_url', siteUrl);

      // Persist AI/SEO file toggles to sessionStorage so they survive page reloads
      try {
        sessionStorage.setItem('seo_file_toggles', JSON.stringify({
          generate_robots_txt: seoFields.generate_robots_txt,
          generate_sitemap_xml: seoFields.generate_sitemap_xml,
          generate_llms_txt: seoFields.generate_llms_txt,
          generate_faq_ai_txt: seoFields.generate_faq_ai_txt,
        }));
      } catch (err) {
        console.warn('[sidebar publish] Failed to persist SEO toggles:', err);
      }

      const seoFileToggles = {
        generate_robots_txt: seoFields.generate_robots_txt,
        generate_sitemap_xml: seoFields.generate_sitemap_xml,
        generate_llms_txt: seoFields.generate_llms_txt,
        generate_faq_ai_txt: seoFields.generate_faq_ai_txt,
      };

      // Deploy via edge function → deploy-react-upload.php → Mac Mini SSH → rsync
      // This is the correct path: builds React app on Mac Mini and rsyncs to Hostinger
      let deployError: string | null = null;
      try {
        const deployResult = await duplicateSiteAfterPayment(existingSlug, existingPropertyId, seoFileToggles);
        console.log('[sidebar publish] ✅ Deploy result:', deployResult);
        if (deployResult.deployUrl) {
          sessionStorage.setItem('popup_site_url', deployResult.deployUrl);
        }
      } catch (deployErr) {
        console.error('[sidebar publish] Deploy failed:', deployErr);
        deployError = deployErr instanceof Error ? deployErr.message : String(deployErr);
        setPublishError('Deploy failed: ' + deployError + '. Please try again or contact support.');
        setPublishLoading(false);
        return;
      }

      // Reload sidebar data
      loadData();
      loadConnectData();
      loadSubscriptionData();

      setPublishError(null);
      // Redirect to the newly published site with ?published=1 so CustomerSite shows the
      // share popup (shows for 3s, then retracts back into the nav Share icon — David confirmed
      // he wants this animation, just clarifying after initially disliking something about it).
      (window as any).__PROPERTY_DATA__ = null; window.location.replace(siteUrl + "?published=1&t=" + Date.now());
    } catch (err) {
      console.error('[sidebar publish] Error:', err);
      setPublishError(err instanceof Error ? err.message : 'Publish failed. Please try again.');
    } finally {
      setPublishLoading(false);
    }
  };

  // After redirecting to Stripe checkout from the gate above, Stripe always sends the
  // browser back to this same page with ?paid=true&session_id=... (App.tsx strips the
  // query string and, when pending_publish_property_id is set, deliberately does NOT
  // reopen GetSite -- see App.tsx). Verify the checkout session directly against Stripe
  // (via stripe-subscription's get_session action) rather than trusting
  // profiles.stripe_subscription_status, which only updates via the subscription webhook
  // -- and don't gate this on it lagging or failing. Then finish the publish.
  useEffect(() => {
    const pendingPropertyId = sessionStorage.getItem('pending_publish_property_id');
    const sessionId = sessionStorage.getItem('stripe_session_id');
    if (!pendingPropertyId || !sessionId || !property?.id || pendingPropertyId !== property.id) return;
    (async () => {
      try {
        const session = await getSession();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify({ action: 'get_session', session_id: sessionId }),
        });
        const data = await res.json();
        const paidOk = data.status === 'complete' || data.sub_status === 'active' || data.subscription?.status === 'active';
        if (!paidOk) return;

        // David: this is the step that went missing when Stripe checkout moved from
        // "Create Draft Site" (old GetSite.tsx) to "Publish" (here). The old ?paid
        // handler promoted the account to role:'admin' right after verifying payment --
        // that's what turned a guest sidebar into an admin one. Nothing in the new
        // publish flow (this effect or handlePublishFromSidebar) was doing that
        // anymore, so nobody who paid and published through the new flow ever became
        // an admin. Restoring it here, in the same place verification now happens.
        if (user?.id) {
          const { error: upgradeError } = await supabase
            .from('profiles')
            .update({ role: 'admin', website_live: true })
            .eq('id', user.id);
          if (upgradeError) {
            console.error('[auto-publish-after-subscribe] Failed to upgrade role to admin:', upgradeError);
          } else {
            await supabase.auth.refreshSession();
            await refreshUser();
          }
        }

        sessionStorage.removeItem('pending_publish_property_id');
        sessionStorage.removeItem('stripe_session_id');
        sessionStorage.removeItem('stripe_paid_returning');
        setPublishError(null);
        loadSubscriptionData();
        handlePublishFromSidebar(true);
      } catch (err) {
        console.error('[auto-publish-after-subscribe] session verification failed:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property?.id]);

  const handleUpdateBookingStatus = async (bookingId: string, status: 'approved' | 'denied', reason?: string) => {
    if (!user || user.role !== 'admin') return;
    setBookingsLoading(true);
    try {
      // Auth-hold flow: capture the guest's held payment on approval, or release it
      // on denial, before flipping the booking's status. A booking with no payment
      // intent yet (guest never reached payment) comes back as { skipped: true }
      // and this still proceeds.
      const { data: paymentResult, error: fnError } = await supabase.functions.invoke('capture-booking-payment', {
        body: { bookingId, action: status === 'approved' ? 'capture' : 'cancel' },
      });
      if (fnError) throw fnError;
      if (paymentResult?.error) throw new Error(paymentResult.error);

      const { error } = await supabase.from('bookings').update({ status, updated_at: new Date().toISOString(), ...(reason ? { denial_reason: reason } : {}) }).eq('id', bookingId);
      if (error) throw error;
      await loadData();
    } catch (err) { setBookingError(err instanceof Error ? err.message : 'Failed to update booking'); } finally { setBookingsLoading(false); }
  };

  const handleRefund = async (bookingId: string) => {
    if (!user || user.role !== 'admin') return;
    setBookingsLoading(true);
    try {
      const session = await getSession();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-refund`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY }, body: JSON.stringify({ bookingId }) });
      if (!response.ok) { const e = await response.json(); throw new Error(e.error || 'Refund failed'); }
      await loadData();
    } catch (err) { setBookingError(err instanceof Error ? err.message : 'Refund failed'); throw err; } finally { setBookingsLoading(false); }
  };

  const toggleSection = (section: Section) => {
    if (section === 'bookings') { onClose(); navigate('/admin'); return; }
    if (section === 'edit') { setIsEditing(prev => !prev); return; }
    const next = openSection === section ? null : section;
    setOpenSection(next);
    if (next === 'banking') loadConnectData();
    if (next === 'subscription') loadSubscriptionData();
  };

  const navItems: { key: Section; label: string }[] = canManageProperty
    ? [
        { key: 'property', label: 'Property' },
        { key: 'website', label: 'Website' },
        { key: 'seo', label: 'SEO' },
        { key: 'contact', label: 'Contact' },
        { key: 'banking', label: 'Banking' },
        { key: 'services', label: 'Services' },
        { key: 'subscription', label: 'Subscription' },
      ]
    : [
        { key: 'contact', label: 'Contact' },
      ];

  const mockBooking: NextBooking = { guestName: 'Sarah Johnson', location: 'Surf House Baja, Ensenada', guestCount: 4, nights: 5, startDay: 14, endDay: 19, month: 'JUN', status: 'approved' };
  const displayBooking = mockMode ? mockBooking : nextBooking;
  const displayUser = user ?? (mockMode ? { email: 'david@example.com', full_name: 'David', role: 'admin' } as Profile : null);

  if (!displayUser) return null;

  // Property isolation: show locked state when:
  // - Non-admin visiting a property they don't own (isAccessDenied from loadData guard), OR
  // - Non-admin whose URL slug doesn't match any of their properties
  // Admins bypass this during the migration period.
  const showLockedState = isAccessDenied || (!isAdmin && !isCurrentSlugOwnedByUser);
  if (showLockedState) {
    return (
      <>
        {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
        <div className={`sidebar-panel ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="sidebar-header">
            <h1 className="hero-title hero-title-edit">🔒 Not Your Property</h1>
            <button onClick={onClose} className="sidebar-btn-close"><X className="h-6 w-6" /></button>
          </div>
          <div className="sidebar-content" style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>You don't have admin access here</h2>
            <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              This property belongs to another account. Go to your property using the button below, or sign in as an admin of this property.
            </p>
            <button
              className="sidebar-btn-edit"
              style={{ width: '100%', background: '#3b82f6' }}
              onClick={goToMyProperty}
            >
              Go to My Property →
            </button>
          </div>
        </div>
      </>
    );
  }

  const isPending = displayBooking?.status === 'pending';
  const hasStripeAccount = !!(connectData?.account_id);
  const hasWebsite = !!(property?.site_url || sidebarPropertyDataRef.current?.site_url);
  const hasEmail = !!displayUser.email;
  // hasSubscription: check subscriptionData from Stripe API first, then fall back to user profile
  // (profile is updated immediately after Stripe payment; Stripe API may lag or require customer ID)
  const profileSubStatus = (user as any)?.stripe_subscription_status;
  const hasSubscription = subscriptionData?.status === 'active' || profileSubStatus === 'active' || profileSubStatus === 'trialing';
  // Effective subscription plan: from Stripe API or profile
  const effectivePlan = subscriptionData?.plan || (user as any)?.stripe_subscription_plan;

  const myOwnProperty = userProperties[0];

  return (
    <>
      {/* David: "signed in as AI (an admin), saw AI's own property's copy on
          surfhousebaja's page" -- heads-up only, never a hard lock. Admins
          must keep full, uninterrupted access to any property for migration/
          site-building work; this just tells them their own account is tied
          to a different property, in case landing here wasn't intentional. */}
      {showPropertyConflict && myOwnProperty && (
        <div className="auth-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) { dismissedConflictSlugRef.current = currentSlug; setShowPropertyConflict(false); } }}>
          <div className="auth-modal">
            <button
              className="popup-close"
              aria-label="Close"
              onClick={() => { dismissedConflictSlugRef.current = currentSlug; setShowPropertyConflict(false); }}
            >
              <X className="h-5 w-5" />
            </button>
            <h1 className="hero-title hero-title-edit">Property conflict</h1>
            <p style={{ marginBottom: '1.25rem' }}>
              Your account is associated with <strong>{myOwnProperty.name || myOwnProperty.title}</strong>. Do you want to go there instead?
            </p>
            <button
              className="btn"
              style={{ width: '100%', marginBottom: '0.5rem' }}
              onClick={() => { setShowPropertyConflict(false); goToMyProperty(); }}
            >
              Go to {myOwnProperty.name || myOwnProperty.title}
            </button>
            <p>
              <button
                type="button"
                className="popup-link"
                onClick={() => { dismissedConflictSlugRef.current = currentSlug; setShowPropertyConflict(false); }}
              >
                Stay here and keep editing this property
              </button>
            </p>
          </div>
        </div>
      )}
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <div className={`sidebar-panel ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="sidebar-header">
          <h1 className="hero-title hero-title-edit">Profile</h1>
          <div className="sidebar-header-actions">
            {(!isAccessDenied || isAdmin) && <button onClick={() => isEditing ? handleSave() : setIsEditing(true)} disabled={saving} className="sidebar-btn-edit">{isEditing ? <Check className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}<span>{saving ? 'Saving...' : isEditing ? 'Done' : 'Edit'}</span></button>}
            {isEditing && <button onClick={() => setIsEditing(false)} className="sidebar-btn-cancel inline-flex-row"><X className="h-4 w-4" /><span className="btn-text">Cancel</span></button>}
            <button onClick={onClose} className="sidebar-btn-close"><X className="h-6 w-6" /></button>
          </div>
        </div>

        <div className="sidebar-content">
          {/* Migration period warning: admin viewing another user's property */}
          {isAccessDenied && isAdmin && (
            <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: '0.8rem', color: '#92400e' }}>
              ⚠️ <strong>Migration mode:</strong> You&apos;re viewing a property you don&apos;t own. Edits here affect that property directly.
            </div>
          )}
          {/* Next Booking Card */}
          <div className="sb-next-booking">
            <button onClick={() => setBookingCardOpen(prev => !prev)} className="w-full text-left p-4" style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}>
              {bookingsLoading && !displayBooking ? (
                <div className="flex justify-center py-3"><InlineLoader /></div>
              ) : displayBooking ? (
                <div className="flex items-center justify-between">
                  <div className="flex-1 flex flex-col justify-center space-y-1 text-center pr-3">
                    <p className="sb-booking-guest">{displayBooking.guestName}</p>
                    {displayBooking.location && <p className="sb-booking-location">{displayBooking.location}</p>}
                    <p className="sb-booking-meta-row">{displayBooking.guestCount} {displayBooking.guestCount === 1 ? 'Guest' : 'Guests'} · {displayBooking.nights} Night{displayBooking.nights !== 1 ? 's' : ''}</p>
                    <div className="flex justify-center">
                      <span className={`sb-booking-status ${isPending ? 'is-pending' : 'is-approved'}`}>
                        {isPending ? <Clock className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                        {displayBooking.status.charAt(0).toUpperCase() + displayBooking.status.slice(1)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="booking-callout flex-shrink-0">
                      <div className="callout-top"><p className="callout-start-num">{displayBooking.startDay}</p></div>
                      <div className="callout-mid"><p className="callout-end-num">{displayBooking.endDay}</p></div>
                      <div className={`callout-month ${isPending ? 'is-pending' : 'is-approved'}`}><span>{displayBooking.month}</span></div>
                    </div>
                    {bookingCardOpen ? <ChevronDown className="h-5 w-5 text-gray-500" /> : <ChevronRight className="h-5 w-5 text-gray-500" />}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between py-2">
                  <p className="body-on-light">No upcoming bookings</p>
                  {bookingCardOpen ? <ChevronDown className="h-5 w-5 text-gray-500" /> : <ChevronRight className="h-5 w-5 text-gray-500" />}
                </div>
              )}
            </button>
            {bookingCardOpen && (
              <div className="border-t border-gray-200">
                {bookingError ? <p className="text-sm text-red-600 p-4">{bookingError}</p> : <UserBookings bookings={bookings} onUpdateStatus={handleUpdateBookingStatus} onRefund={handleRefund} canManageProperty={canManageProperty} />}
              </div>
            )}
          </div>

          {/* Credentials Card — admin only */}
          {showCredentials && canManageProperty && (
            <div className="sb-credentials">
              <button onClick={() => setShowCredentials(false)} className="sb-btn-close" style={{ position: 'absolute', top: 12, right: 12 }}><X className="h-4 w-4" /></button>
              <p className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Website Credentials</p>
              <div className="sb-credential-row">
                <div className="sb-credential-label"><StatusDot ok={hasStripeAccount} /><p className="sb-credential-name">Stripe Payout Account</p></div>
                {!hasStripeAccount && <p className="sb-credential-name" style={{ color: '#999', fontSize: '0.8rem' }}>No account added</p>}
                {hasStripeAccount && connectData && !connectData.details_submitted && <p className="sb-credential-name" style={{ color: '#f59e0b', fontSize: '0.75rem' }}>Onboarding pending</p>}
              </div>
              <div className="sb-credential-row">
                <div className="sb-credential-label"><StatusDot ok={hasWebsite} /><p className="sb-credential-name">{(property?.site_url || sidebarPropertyDataRef.current?.site_url) ? new URL(property?.site_url || sidebarPropertyDataRef.current?.site_url).pathname.slice(1) : 'No site published yet'}</p></div>
              </div>
              <div className="sb-credential-row">
                <div className="sb-credential-label"><StatusDot ok={hasEmail} /><p className="sb-credential-name">{displayUser.email}</p></div>
              </div>
              <div className="sb-credential-row">
                <div className="sb-credential-label"><StatusDot ok={hasSubscription} /><p className="sb-credential-name">Live Subscription</p></div>
              </div>

              {/* PUBLISH SITE button — gated behind all 4 credentials */}
              {canManageProperty && (
                <div style={{ marginTop: 16 }}>
                  <button
                    onClick={() => handlePublishFromSidebar()}
                    disabled={publishLoading || !property?.id}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      /* David: "make the green publish button val-col" -- val-color
                         (brand color, see .val-color in index.css) instead of the
                         filled green/amber states. */
                      backgroundColor: 'transparent',
                      color: publishLoading ? '#9ca3af' : 'var(--brand)',
                      border: '1px solid var(--brand)',
                      borderRadius: 8,
                      fontWeight: 600,
                      fontSize: '0.9rem',
                      cursor: publishLoading || !property?.id ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      opacity: publishLoading ? 0.7 : 1,
                    }}
                  >
                    {publishLoading ? 'Publishing...' : (!hasWebsite ? 'Publish Site' : 'Publish Now')}
                  </button>
                  {publishError && (
                    <p style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: 6 }}>{publishError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Nav sections */}
          <div>
            {navItems.map(({ key, label }) => (
              <div key={key} className="sb-nav-section">
                <button onClick={() => toggleSection(key)} className="sb-nav-btn">
                  <span className="sb-nav-btn-label">
                    {label}
                    {key === 'subscription' && hasSubscription && (
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: '#22c55e', marginLeft: 6, verticalAlign: 'middle', flexShrink: 0 }} />
                    )}
                  </span>
                  {openSection === key ? <ChevronDown className="h-5 w-5 text-gray-400" /> : <ChevronRight className="h-5 w-5 text-gray-400" />}
                </button>
                {openSection === key && (
                  <div className="sb-section-body">
                    {key === 'property' && <PropertySection property={property ?? sidebarPropertyDataRef.current} imageCount={(property ?? sidebarPropertyDataRef.current)?.images?.length ?? propFields.bedrooms ? imageCount : 0} isEditing={isEditing} fields={propFields} onChange={setPropFields} />}
                    {key === 'website' && <WebsiteSection devUpdates={devUpdates} setDevUpdates={setDevUpdates} serverIp={property?.server_ip ?? sidebarPropertyDataRef.current?.server_ip} siteUrl={property?.site_url ?? sidebarPropertyDataRef.current?.site_url} websiteName={property?.name ?? sidebarPropertyDataRef.current?.name ?? property?.title ?? sidebarPropertyDataRef.current?.title} propertySlug={property?.slug ?? sidebarPropertyDataRef.current?.slug} propertyId={property?.id ?? sidebarPropertyDataRef.current?.id} />}
                    {key === 'seo' && <SeoSection fields={seoFields} onChange={setSeoFields} images={property?.images ?? sidebarPropertyDataRef.current?.images} />}
                    {key === 'contact' && <ContactSection user={displayUser} isEditing={isEditing} fields={contactFields} onChange={setContactFields} userProperties={userProperties} activeProperty={activeProperty} showPropertySwitcher={showPropertySwitcher} setShowPropertySwitcher={setShowPropertySwitcher} handleSwitchProperty={handleSwitchProperty} />}
                    {key === 'banking' && <BankingSection connectData={connectData} connectLoading={connectLoading} connectOnboarding={connectOnboarding} payoutLoading={payoutLoading} payoutSuccess={payoutSuccess} onOnboard={handleConnectOnboard} onRequestPayout={handleRequestPayout} />}
                    {key === 'services' && <ServicesSection services={services} onToggle={handleServiceToggle} />}
                    {key === 'subscription' && <SubscriptionSection
                      subscription={subscriptionData || (hasSubscription ? { id: '', status: profileSubStatus as 'active' | 'trialing', plan: effectivePlan || 'starter', amount: 0, interval: '', current_period_end: null, cancel_at_period_end: false } : null)}
                      loading={subLoading} checkoutLoading={checkoutLoading} onSubscribe={handleSubscribeCheckout} />}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Get your own booking website — visible to all users */}
          <div style={{ padding: '12px 20px 5px' }}>
            <button
              onClick={() => { console.log('[BUTTON CLICK]'); (window as any).__openGetSite?.(); window.setTimeout(() => onClose(), 0); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '10px 16px',
                /* David: "make the get your own booking website button val-col" --
                   val-color (brand color, see .val-color in index.css) instead of
                   a filled brand background. */
                backgroundColor: 'transparent',
                color: 'var(--brand)',
                border: '1px solid var(--brand)',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: '0.9rem',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              Get your own booking website →
            </button>
          </div>

          {/* Sign out */}
          <div className="flex justify-center">
            <button onClick={async () => { await signOut(); onClose(); }} className="sidebar-signout">
              <LogOut className="h-4 w-4" /><span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>

    </>
  );
}