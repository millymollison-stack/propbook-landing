/**
 * GuestSidebar — cloned from AdminSidebarBundle.tsx
 * For logged-in non-admin users (guests):
 *   - Bookings (their bookings at others' properties)
 *   - Contact (with property switcher + edit mode)
 *   - Get your own booking website CTA
 *   - Sign out
 *
 * All sidebar.css classes and button state styles are preserved exactly.
 */


import React, { useState, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { ChevronRight, ChevronDown, X, LogOut, Check, CreditCard as Edit2, Clock, CreditCard, AlertCircle, Mail, MessageSquare, Home } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';
import type { Profile, Booking, Property } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

type PaymentStatus = 'unpaid' | 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'canceled';

interface NextBooking {
  guestName: string; location: string; guestCount: number; nights: number;
  startDay: number; endDay: number; month: string; status: string;
}

interface GuestSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentSlug: string;
  onOpenGetSite: () => void;
  onOpenLogin: () => void;
}

// ─── Shared UI primitives ────────────────────────────────────────────────────

function InlineLoader() {
  return (
    <div className="flex gap-1">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

// ─── UserBookings (for guest view — read-only, no approve/deny) ───────────────

interface UserBookingsProps {
  bookings: (Booking & { property: Property; user: Profile })[];
}

const UserBookings = memo(function UserBookings({ bookings }: UserBookingsProps) {
  // David 2026-10-18: this status-filter dropdown was cloned over from the admin
  // sidebar along with everything else in this file, but guests only ever have a
  // handful of bookings for the one site they're on -- the filter is admin tooling
  // for triaging many bookings across many guests, not something a guest needs.
  // Removed rather than hidden: there's no case where a guest should see it.

  const statusBadge = (status: string) => {
    const cfg: Record<string, { bg: string; text: string }> = {
      approved: { bg: 'bg-green-100', text: 'text-green-800' },
      denied: { bg: 'bg-red-100', text: 'text-red-800' },
      cancelled: { bg: 'bg-gray-100', text: 'text-gray-800' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
    };
    const { bg, text } = cfg[status] || cfg.pending;
    return <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${bg} ${text}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
  };

  const paymentBadge = (ps: PaymentStatus) => {
    const cfg: Record<string, { icon: any; bg: string; text: string; label: string }> = {
      paid: { icon: Check, bg: 'bg-green-100', text: 'text-green-800', label: 'Paid' },
      pending: { icon: Clock, bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
      // David 2026-10-18: card authorized/held under the auth-hold flow --
      // not charged yet, awaiting the host's approve/deny decision.
      authorized: { icon: Clock, bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Card Held' },
      unpaid: { icon: AlertCircle, bg: 'bg-gray-100', text: 'text-gray-800', label: 'Unpaid' },
      refunded: { icon: CreditCard, bg: 'bg-blue-100', text: 'text-blue-800', label: 'Refunded' },
      failed: { icon: X, bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
      canceled: { icon: X, bg: 'bg-gray-100', text: 'text-gray-800', label: 'Hold Released' },
    };
    const { icon: Icon, bg, text, label } = cfg[ps] || cfg.unpaid;
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${text}`}><Icon className="w-3.5 h-3.5 mr-1" />{label}</span>;
  };

  if (!bookings.length) {
    return <div className="text-center py-12"><p className="body-on-light">No bookings found.</p></div>;
  }

  return (
    <div className="space-y-6">
      <div className="divide-y divide-gray-200">
        {bookings.map(booking => (
          <div key={booking.id} className="py-4">
            <div className="flex flex-wrap justify-center items-center gap-2 mb-4">
              {statusBadge(booking.status)}
              {paymentBadge(booking.payment_status as PaymentStatus)}
            </div>
            {/* Property being booked */}
            <div className="space-y-2">
              <div className="flex items-center">
                <Home className="h-5 w-5 text-gray-400 mr-2" />
                <span className="font-medium">{booking.property?.title || booking.property?.name || 'Property'}</span>
              </div>
              <div className="flex items-center body-on-light">
                <Mail className="h-4 w-4 text-gray-400 mr-2" />
                {booking.status === 'approved' ? (
                  booking.property?.address ? (
                    booking.property.address
                  ) : booking.property?.location_type === 'coordinates' && booking.property?.latitude != null && booking.property?.longitude != null ? (
                    // David 2026-10-22: "Allow coordinates to work as an address
                    // in our system if needed as my vacation rental doesn't have
                    // an address as it's off grid." A maps link is more useful to
                    // a guest than raw numbers when there's no street address.
                    <a
                      href={`https://www.google.com/maps?q=${booking.property.latitude},${booking.property.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {booking.property.latitude.toFixed(5)}, {booking.property.longitude.toFixed(5)} (view on map)
                    </a>
                  ) : (
                    'Address not yet on file — contact your host'
                  )
                ) : (
                  'Address provided once your booking is confirmed'
                )}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="font-medium text-gray-500">Check-in</dt>
                <dd className="mt-1 text-gray-900">
                  {format(new Date(booking.start_date), 'MMM d, yyyy')}
                  <div className="text-xs text-gray-500">3:00 PM</div>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Check-out</dt>
                <dd className="mt-1 text-gray-900">
                  {format(addDays(new Date(booking.end_date), 1), 'MMM d, yyyy')}
                  <div className="text-xs text-gray-500">11:00 AM</div>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Total</dt>
                <dd className="mt-1 text-gray-900">
                  ${booking.total_price}
                  <span className="text-gray-500 text-xs ml-1">
                    ({booking.guest_count} {booking.guest_count === 1 ? 'guest' : 'guests'})
                  </span>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Amount Paid</dt>
                <dd className="mt-1 text-gray-900">
                  {booking.amount_paid ? `$${(booking.amount_paid / 100).toFixed(2)}` : '—'}
                </dd>
              </div>
            </div>
            {booking.special_requests && (
              <div className="mt-4">
                <dt className="text-sm font-medium text-gray-500 flex items-center">
                  <MessageSquare className="h-4 w-4 mr-1" />Special Requests
                </dt>
                <dd className="mt-1 text-sm text-gray-900">{booking.special_requests}</dd>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Property Switcher ────────────────────────────────────────────────────────

interface PropertySwitcherProps {
  userProperties: Property[];
  activeProperty: Property | null;
  show: boolean;
  onToggle: () => void;
  onSelect: (prop: Property) => void;
}

function PropertySwitcher({ userProperties, activeProperty, show, onToggle, onSelect }: PropertySwitcherProps) {
  if (userProperties.length === 0) return null;

  return (
    <div className="gs-property-switcher">
      <button
        onClick={onToggle}
        className="gs-property-switcher-btn"
      >
        <span className="gs-property-switcher-label">
          {activeProperty?.name || activeProperty?.title || activeProperty?.slug || 'Switch property'}
        </span>
        <ChevronDown className="h-3 w-3 gs-property-switcher-chevron" />
      </button>
      {show && (
        <div className="gs-property-dropdown">
          {userProperties.map(prop => (
            <button
              key={prop.id}
              onClick={() => onSelect(prop)}
              className={`gs-property-dropdown-item${prop.id === activeProperty?.id ? ' active' : ''}`}
            >
              {prop.id === activeProperty?.id && <Check className="h-3 w-3 text-green-500" />}
              <span className={`gs-property-dropdown-item-label${prop.id === activeProperty?.id ? ' active' : ''}`}>
                {prop.name || prop.title || prop.slug}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Contact Section ──────────────────────────────────────────────────────────

interface ContactSectionProps {
  user: Profile;
  isEditing: boolean;
  fields: { full_name: string; email: string; phone_number: string };
  onChange: React.Dispatch<React.SetStateAction<{ full_name: string; email: string; phone_number: string }>>;
  userProperties: Property[];
  activeProperty: Property | null;
  showPropertySwitcher: boolean;
  setShowPropertySwitcher: React.Dispatch<React.SetStateAction<boolean>>;
  handleSwitchProperty: (prop: Property) => void;
}

function ContactSection({
  user,
  isEditing,
  fields,
  onChange,
  userProperties,
  activeProperty,
  showPropertySwitcher,
  setShowPropertySwitcher,
  handleSwitchProperty,
}: ContactSectionProps) {
  return (
    <div>
      {/* Property switcher */}
      <PropertySwitcher
        userProperties={userProperties}
        activeProperty={activeProperty}
        show={showPropertySwitcher}
        onToggle={() => setShowPropertySwitcher(v => !v)}
        onSelect={handleSwitchProperty}
      />

      {/* Role */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Role</h4>
        <p className="sb-field-value">Guest</p>
      </div>

      {/* Name */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Name</h4>
        {isEditing ? (
          <input
            type="text"
            value={fields.full_name}
            onChange={e => onChange(p => ({ ...p, full_name: e.target.value }))}
            className="sb-input"
          />
        ) : (
          <p className="sb-field-value">{fields.full_name || '—'}</p>
        )}
      </div>

      {/* Email */}
      <div className="sb-field-row">
        <div className="gs-email-row">
          <h4 className="sb-h4-grey">Email</h4>
          <span className="gs-verified-badge">Verified</span>
        </div>
        <p className="sb-field-value">{user.email}</p>
      </div>

      {/* Phone */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Tel</h4>
        {isEditing ? (
          <input
            type="tel"
            value={fields.phone_number}
            onChange={e => onChange(p => ({ ...p, phone_number: e.target.value }))}
            className="sb-input"
          />
        ) : (
          <p className="sb-field-value">{fields.phone_number || '—'}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main GuestSidebar export ─────────────────────────────────────────────────

export function GuestSidebar({ isOpen, onClose, currentSlug}: GuestSidebarProps) {
  const { user, signOut, updateProfile } = useAuth();
  const navigate = useNavigate();

  // David: site-count limit check — mirrors the same logic in GetSite.tsx so the
  // sidebar CTA reflects the limit before the popup even opens.
  const [ownedSiteCount, setOwnedSiteCount] = useState<number | null>(null);
  useEffect(() => {
    if (!user) { setOwnedSiteCount(null); return; }
    // David 2026-10-22: same fix as GetSite.tsx -- only a PUBLISHED site
    // (status: 'active') should count against the plan limit, not a still
    // -unpublished draft.
    supabase.from('properties').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).eq('status', 'active')
      .then(({ count }) => setOwnedSiteCount(count ?? 0));
  }, [user?.id]);
  const SITE_LIMIT_BY_PLAN: Record<string, number> = { starter: 1, growth: 2 };
  const siteLimit = SITE_LIMIT_BY_PLAN[user?.stripe_subscription_plan || 'starter'] ?? 1;
  const atSiteLimit = ownedSiteCount !== null && ownedSiteCount >= siteLimit;

  // ── State ─────────────────────────────────────────────────────────────────
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bookingCardOpen, setBookingCardOpen] = useState(false);

  // Property switcher
  const [userProperties, setUserProperties] = useState<Property[]>([]);
  const [showPropertySwitcher, setShowPropertySwitcher] = useState(false);
  const [activeProperty, setActiveProperty] = useState<Property | null>(null);

  // Contact fields
  const [contactFields, setContactFields] = useState({ full_name: '', email: '', phone_number: '' });

  // Bookings
  const [bookings, setBookings] = useState<(Booking & { property: Property; user: Profile })[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [nextBooking, setNextBooking] = useState<NextBooking | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // ── Load all published properties for switcher ──────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    supabase
      .from('properties')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setUserProperties(data);
          // Auto-select the property matching the current URL slug
          const current = data.find((p: Property) => p.slug === currentSlug);
          setActiveProperty(current || data[0]);
        }
      });
  }, [isOpen, currentSlug]);

  // ── Load contact fields ──────────────────────────────────────────────────
  useEffect(() => {
    if (user) {
      setContactFields({
        full_name: user.full_name || '',
        email: user.email || '',
        phone_number: user.phone_number || '',
      });
    }
  }, [user]);

  // ── Load guest bookings (bookings WHERE user_id = current user) ────────────
  // David 2026-10-18: data leak -- this used to fetch EVERY booking this user
  // has ever made, across every property on the platform, and show them all in
  // whatever property's sidebar they happened to open (reported: a guest on
  // ravenswortha14 could see their unrelated Isabela A12 booking). Guests should
  // only see their booking(s) for the site they're currently on, so this now
  // waits for activeProperty to resolve from the URL slug and filters by it.
  const loadGuestBookings = useCallback(() => {
    if (!user || !activeProperty) return;
    setBookingsLoading(true);
    setBookingError(null);

    supabase
      .from('bookings')
      .select('*, property:properties(*), user:profiles(*)')
      .eq('user_id', user.id)
      .eq('property_id', activeProperty.id)
      .order('created_at', { ascending: false })
      .then((bookingsRes) => {
        if (bookingsRes.data) {
          const valid = bookingsRes.data.filter((b: any) => b && b.property) as (Booking & { property: Property; user: Profile })[];
          setBookings(valid);

          // Set next upcoming booking
          const now = new Date();
          const upcoming = valid.filter((b: any) => b.status === 'approved' && new Date(b.start_date) >= now)
            .sort((a: any, b: any) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())[0];
          const pending = valid.filter((b: any) => b.status === 'pending')
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
          const featured = pending || upcoming;
          if (featured) {
            const [sy, sm, sd] = featured.start_date.slice(0, 10).split('-').map(Number);
            const [ey, em, ed] = featured.end_date.slice(0, 10).split('-').map(Number);
            const start = new Date(sy, sm - 1, sd);
            const endDate = new Date(ey, em - 1, ed);
            const nights = Math.ceil(Math.abs(endDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            setNextBooking({
              guestName: featured.user?.full_name || 'Guest',
              location: featured.property?.address || featured.property?.title || '',
              guestCount: featured.guest_count,
              nights,
              startDay: sd,
              endDay: ed,
              month: format(start, 'MMM').toUpperCase(),
              status: featured.status,
            });
          } else {
            setNextBooking(null);
          }
        }
        setBookingsLoading(false);
      });
  }, [user, activeProperty]);

  useEffect(() => {
    if (!isOpen) return;
    loadGuestBookings();
  }, [isOpen, loadGuestBookings]);

  // David 2026-10-19: "add the booking to the sidebar... like it did
  // before" -- there was no mechanism telling this sidebar a new booking
  // had been made, so if it was already open (or had been opened earlier
  // this visit) when the guest completed a booking, the list stayed
  // exactly as it was at the last open and the new pending booking never
  // appeared until a manual close/reopen. BookingCalendar now dispatches
  // 'booking-created' right after a booking is authorized; refetch here
  // whenever that happens for the property this sidebar is scoped to,
  // whether or not the sidebar is currently open, so it's current the
  // moment the guest does open it.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!activeProperty || detail?.propertyId !== activeProperty.id) return;
      loadGuestBookings();
    };
    window.addEventListener('booking-created', handler);
    return () => window.removeEventListener('booking-created', handler);
  }, [activeProperty, loadGuestBookings]);

  // ── Close on outside click ───────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const sidebar = document.getElementById('guest-sidebar');
      if (sidebar && !sidebar.contains(e.target as Node)) {
        const closeBtn = document.getElementById('guest-sidebar-close');
        if (closeBtn && closeBtn.contains(e.target as Node)) return;
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSwitchProperty = (prop: Property) => {
    setShowPropertySwitcher(false);
    setActiveProperty(prop);
    // David: each /props/<slug> bundle's router basename + embedded
    // window.__PROPERTY_DATA__ are pinned to whichever property was in its
    // ORIGINAL static index.html. A client-side navigate() here left the
    // previous property's data in memory alongside the new one -- a full
    // page load is what actually boots the destination property cleanly.
    onClose();
    window.location.href = `/props/${prop.slug}`;
  };

  const handleSaveContact = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateProfile({
        full_name: contactFields.full_name,
        phone_number: contactFields.phone_number,
      });
      setIsEditing(false);
    } catch (e) {
      console.error('Failed to save profile:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    onClose();
  };

  const displayUser = user;

  if (!displayUser) return null;

  // ─── Booking card helpers (mirroring AdminSidebar) ─────────────────────────
  const isPending = nextBooking?.status === 'pending';

  // ─── Render ───────────────────────────────────────────────────────────────
  // David: "there are still two property selectors. I only wanted one
  // property selector moved to the bottom of the contacts section.
  // Delete the other property selector and the user name above it.
  // Bookings should be at the top of the sidebar under the hr line."
  // Removed the standalone username label + top-of-sidebar
  // PropertySwitcher below (used to sit right after sidebar-content
  // opens); ContactSection already renders the one property switcher at
  // the bottom of Contact ("moved to the bottom of Contact" there).
  // Bookings is now the first thing under the header's divider.
  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <div className={`sidebar-panel ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* Header */}
        <div className="sidebar-header">
          <h1 className="hero-title hero-title-edit">Profile</h1>
          <div className="sidebar-header-actions">
            <button
              onClick={() => isEditing ? handleSaveContact() : setIsEditing(true)}
              disabled={saving}
              className="sidebar-btn-edit"
            >
              {isEditing
                ? <Check className="h-4 w-4" />
                : <Edit2 className="h-4 w-4" />
              }
              <span>{saving ? 'Saving...' : isEditing ? 'Done' : 'Edit'}</span>
            </button>
            {isEditing && (
              <button onClick={() => setIsEditing(false)} className="sidebar-btn-cancel inline-flex-row">
                <X className="h-4 w-4" />
                <span className="btn-text">Cancel</span>
              </button>
            )}
            <button onClick={onClose} className="sidebar-btn-close">
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="sidebar-content">
          {/* Next Booking Card — mirrors AdminSidebar styling exactly, now
             first: see the removed-selector note above render(). */}
          <div className="sb-next-booking">
            <button
              onClick={() => setBookingCardOpen(prev => !prev)}
              className="w-full text-left p-4 gs-booking-toggle-btn"
            >
              {bookingsLoading && !nextBooking ? (
                <div className="flex justify-center py-3"><InlineLoader /></div>
              ) : nextBooking ? (
                <div className="flex items-center justify-between">
                  <div className="flex-1 flex flex-col justify-center space-y-1 text-center pr-3">
                    <p className="sb-booking-guest">{nextBooking.guestName}</p>
                    {nextBooking.location && (
                      <p className="sb-booking-location">{nextBooking.location}</p>
                    )}
                    <p className="sb-booking-meta-row">
                      {nextBooking.guestCount} {nextBooking.guestCount === 1 ? 'Guest' : 'Guests'} · {nextBooking.nights} Night{nextBooking.nights !== 1 ? 's' : ''}
                    </p>
                    <div className="flex justify-center">
                      <span className={`sb-booking-status ${isPending ? 'is-pending' : 'is-approved'}`}>
                        {isPending
                          ? <Clock className="h-4 w-4" />
                          : <Check className="h-4 w-4" />
                        }
                        {nextBooking.status.charAt(0).toUpperCase() + nextBooking.status.slice(1)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="booking-callout flex-shrink-0">
                      <div className="callout-top">
                        <p className="callout-start-num">{nextBooking.startDay}</p>
                      </div>
                      <div className="callout-mid">
                        <p className="callout-end-num">{nextBooking.endDay}</p>
                      </div>
                      <div className={`callout-month ${isPending ? 'is-pending' : 'is-approved'}`}>
                        <span>{nextBooking.month}</span>
                      </div>
                    </div>
                    {bookingCardOpen
                      ? <ChevronDown className="h-5 w-5 text-gray-500" />
                      : <ChevronRight className="h-5 w-5 text-gray-500" />
                    }
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between py-2">
                  <p className="body-on-light">No upcoming bookings</p>
                  {bookingCardOpen
                    ? <ChevronDown className="h-5 w-5 text-gray-500" />
                    : <ChevronRight className="h-5 w-5 text-gray-500" />
                  }
                </div>
              )}
            </button>

            {bookingCardOpen && (
              <div className="border-t border-gray-200">
                {bookingError
                  ? <p className="text-sm text-red-600 p-4">{bookingError}</p>
                  : <UserBookings bookings={bookings} />
                }
              </div>
            )}
          </div>

          {/* Nav sections — Contact only for guests */}
          <div>
            <div className="sb-nav-section">
              <button
                onClick={() => setOpenSection(openSection === 'contact' ? null : 'contact')}
                className="sb-nav-btn"
              >
                <span className="sb-nav-btn-label">Contact</span>
                {openSection === 'contact'
                  ? <ChevronDown className="h-5 w-5 text-gray-400" />
                  : <ChevronRight className="h-5 w-5 text-gray-400" />
                }
              </button>
              {openSection === 'contact' && (
                <div className="sb-section-body">
                  <ContactSection
                    user={displayUser}
                    isEditing={isEditing}
                    fields={contactFields}
                    onChange={setContactFields}
                    userProperties={userProperties}
                    activeProperty={activeProperty}
                    showPropertySwitcher={showPropertySwitcher}
                    setShowPropertySwitcher={setShowPropertySwitcher}
                    handleSwitchProperty={handleSwitchProperty}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Get your own booking website — exact same styling as AdminSidebar */}
          <div className="gs-own-site-wrap">
            <button
              onClick={() => {
                // David: at the plan's site limit — still opens the popup, which now
                // shows the upgrade-to-Growth offer instead of the onboarding form.
                (window as any).__openGetSite?.();
                window.setTimeout(() => onClose(), 0);
              }}
              className="gs-own-site-btn"
              aria-disabled={atSiteLimit}
              style={atSiteLimit ? { opacity: 0.55, cursor: 'default' } : undefined}
            >
              {atSiteLimit ? 'Site limit reached — Upgrade →' : 'Get your own booking website →'}
            </button>
          </div>

          {/* Sign out — exact same styling as AdminSidebar */}
          <div className="flex justify-center">
            <button onClick={handleSignOut} className="sidebar-signout">
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
