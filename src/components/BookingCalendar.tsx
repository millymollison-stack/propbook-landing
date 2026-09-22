import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DayPicker, DateRange } from 'react-day-picker';
import { format, parseISO, addDays } from 'date-fns';
import { Calendar, Lock, AlertCircle, Ban, Check, X } from 'lucide-react';
import type { Booking, BlockedDate } from '../types';
import { useAuth } from '../store/auth';

import { EmailNotificationService } from '../services/emailService';
import { supabase } from '../lib/supabase';
import { PaymentForm } from './PaymentForm';
// Round 6: removed `import 'react-day-picker/dist/style.css'` — this was the actual
// root cause of the header/date-grid misalignment David flagged (tried to fix 20
// times). <DayPicker disableDefaultStyles> already tells the library not to inject
// its own default inline styles, but that prop does NOT stop an explicit CSS import
// like this one from still loading react-day-picker's bundled style.css. That
// stylesheet sets `.rdp-day { display: flex; max-width: 40px; ... }` (a block-level,
// fixed-width box) which silently fought every custom override below and in
// index.css: text-align:center on the wide 14.2857%-wide <td>/<th> columns has no
// effect on a block-level child, so every day-number button stayed pinned to the
// LEFT edge of its column while the header text centered normally -- producing the
// exact drift in David's screenshot. The custom styles prop below plus index.css's
// .rdp-* rules already re-implement everything this app actually needs, so the
// import was just dead weight left over from before disableDefaultStyles was added.

interface BookingCalendarProps {
  bookings: Booking[];
  blockedDates: BlockedDate[];
  propertyId: string;
  property: { id: string; title: string };
  pricePerNight: number;
  maxGuests: number;
  onBookingSubmit: (booking: {
    start_date: string;
    end_date: string;
    guest_count: number;
    total_price: number;
    special_requests?: string;
  }) => Promise<void>;
}

interface BookingConfirmation {
  checkIn: string;
  checkOut: string;
  guests: number;
  totalPrice: number;
  specialRequests?: string;
  adminContact?: {
    name: string;
    email: string;
    phone?: string;
  };
}

export function BookingCalendar({
  bookings,
  blockedDates,
  propertyId,
  property,
  pricePerNight,
  maxGuests
}: BookingCalendarProps) {
  const [numberOfMonths, setNumberOfMonths] = useState(1);
  const [selected, setSelected] = useState<DateRange | undefined>();
  const [guestCount, setGuestCount] = useState(1);
  const [specialRequests, setSpecialRequests] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBookingMode, setIsBookingMode] = useState(true);
  const [blockReason, setBlockReason] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [bookingConfirmation, setBookingConfirmation] = useState<BookingConfirmation | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null);
  const [bookingAmount, setBookingAmount] = useState(0);
  const [bookingDates, setBookingDates] = useState<{ from: Date; to: Date } | null>(null);
  const [liabilityAccepted, setLiabilityAccepted] = useState(false);
  const authTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [adminProfile, setAdminProfile] = useState<any>(null);
  // David 2026-09-22: fix for "calendar doesn't show yellow/red after booking" —
  // the `bookings` array is a prop fetched once by the parent page; this component's
  // own insert (needed so we have the booking id before payment) never told the parent
  // to refetch, so the calendar kept rendering the stale pre-booking `bookings` prop
  // until a full page reload. We now merge newly-created bookings in locally so the
  // calendar updates immediately, regardless of whether/when the parent refetches.
  const [localBookings, setLocalBookings] = useState<Booking[]>([]);

  useEffect(() => {
    loadAdminProfile();
  }, []);

  const loadAdminProfile = async () => {
    try {
      const { data: adminUsers, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'admin')
        .limit(1)
        .single();

      if (error) throw error;
      setAdminProfile(adminUsers);
    } catch (err) {
      console.error('Failed to load admin profile:', err);
    }
  };

  useEffect(() => {
    const handleResize = () => {
      setNumberOfMonths(1);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Open the existing login popup 2 seconds after both dates are selected, if not logged in
  useEffect(() => {
    if (authTimerRef.current) clearTimeout(authTimerRef.current);
    if (selected?.from && selected?.to && !user) {
      authTimerRef.current = setTimeout(() => { window.dispatchEvent(new CustomEvent('open-auth', { detail: { mode: 'signup' } })); }, 2000);
    }
    return () => { if (authTimerRef.current) clearTimeout(authTimerRef.current); };
  }, [selected, user]);

  const allBookings = localBookings.length
    ? [...bookings, ...localBookings.filter(lb => !bookings.some(b => b.id === lb.id))]
    : bookings;

  const approvedBookings = allBookings
    .filter(booking => booking.status === 'approved')
    .map(booking => ({
      from: parseISO(booking.start_date),
      to: parseISO(booking.end_date)
    }));

  const pendingBookings = allBookings
    .filter(booking => booking.status === 'pending')
    .map(booking => ({
      from: parseISO(booking.start_date),
      to: parseISO(booking.end_date)
    }));

  const blockedRanges = blockedDates.map(blocked => ({
    from: parseISO(blocked.start_date),
    to: parseISO(blocked.end_date)
  }));

  const disabledDays = [
    { before: new Date() },
    ...approvedBookings, // Only approved bookings block dates
    ...blockedRanges
  ];

  const modifiers = {
    approved: approvedBookings,
    pending: pendingBookings, // Pending bookings show as yellow but don't block selection
    blocked: blockedRanges,
    selected: selected?.from && selected?.to ? {
      from: selected.from,
      to: selected.to
    } : undefined
  };

  const modifiersStyles = {
    approved: { backgroundColor: '#FCA5A5', color: '#7F1D1D', fontWeight: 600 },
    pending: { backgroundColor: '#FCD34D', color: '#78350F', fontWeight: 600 },
    blocked: { backgroundColor: '#9CA3AF', color: '#FFFFFF', fontWeight: 600 },
    // Brighter selection blue (David, Round 6) -- was the pale #93C5FD/#1E3A8A pair.
    selected: { backgroundColor: '#3B82F6', color: '#FFFFFF', fontWeight: 600 }
  };

  const calculateTotalPrice = () => {
    if (!selected?.from || !selected?.to) return 0;
    const days = Math.ceil((selected.to.getTime() - selected.from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const basePrice = days * pricePerNight;
    const guestFee = guestCount > 2 ? (guestCount - 2) * 10 : 0;
    return basePrice + guestFee;
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[BookingCalendar] Book Now clicked');

    if (!selected?.from || !selected?.to) {
      console.log('[BookingCalendar] No dates selected');
      return;
    }

    if (isBookingMode && !liabilityAccepted) {
      setError('Please agree to the liability waiver before booking.');
      return;
    }

    console.log('[BookingCalendar] Selected dates:', selected.from, selected.to);
    console.log('[BookingCalendar] User:', user);

    setLoading(true);
    setError(null);

    // Safety timeout: reset loading after 10s in case payment form doesn't appear
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = setTimeout(() => {
      console.log('[BookingCalendar] Loading timeout — resetting state');
      setLoading(false);
    }, 10000);

    try {
      const totalPrice = calculateTotalPrice();
      console.log('[BookingCalendar] Total price:', totalPrice);

      const bookingData = {
        start_date: format(selected.from, 'yyyy-MM-dd'),
        end_date: format(selected.to, 'yyyy-MM-dd'),
        guest_count: guestCount,
        total_price: totalPrice,
        special_requests: specialRequests.trim() || undefined
      };

      console.log('[BookingCalendar] Creating booking with data:', bookingData);

      const { data: newBooking, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          property_id: propertyId,
          user_id: user!.id,
          ...bookingData,
          status: 'pending',
          payment_status: 'unpaid'
        })
        .select()
        .single();

      console.log('[BookingCalendar] Booking creation result:', { newBooking, bookingError });

      if (bookingError) {
        console.error('[BookingCalendar] Booking error:', bookingError);
        throw bookingError;
      }

      console.log('[BookingCalendar] Booking created successfully:', newBooking.id);

      setLocalBookings(prev => [...prev, newBooking]);
      setCreatedBookingId(newBooking.id);
      setBookingAmount(totalPrice);
      setBookingDates({ from: selected.from, to: selected.to });

      console.log('[BookingCalendar] Setting showPaymentForm to true');
      setShowPaymentForm(true);
      if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null; }
      setLoading(false);

      console.log('[BookingCalendar] State updated, payment form should show');

      // Send booking request email (non-blocking)
      EmailNotificationService.sendBookingRequestEmail({
        booking: bookingData,
        user: user!,
        property
      }).then(() => {
        console.log('Admin booking request email sent successfully');
      }).catch((emailError) => {
        console.error('Failed to send booking email:', emailError);
      });
    } catch (err: any) {
      console.error('[BookingCalendar] Booking submission error:', err);
      console.error('[BookingCalendar] Error details:', err.message, err.code);
      if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null; }
      setError(`Failed to submit booking: ${err.message || 'Please try Again'}`);
      setLoading(false);
    }
  };

  const handlePaymentSuccess = async () => {
    setShowPaymentForm(false);

    const bookingData = await supabase
      .from('bookings')
      .select('*')
      .eq('id', createdBookingId)
      .single();

    if (bookingData.data) {
      const confirmedBookingEmailData = {
        booking: {
          start_date: bookingData.data.start_date,
          end_date: bookingData.data.end_date,
          guest_count: bookingData.data.guest_count,
          total_price: bookingData.data.total_price,
          special_requests: bookingData.data.special_requests
        },
        user: user!,
        property
      };

      // Send confirmation email (non-blocking)
      EmailNotificationService.sendBookingConfirmationEmail(confirmedBookingEmailData).then(() => {
        console.log('Confirmation email sent successfully');
      }).catch((emailError) => {
        console.error('Failed to send confirmation email:', emailError);
      });

      // David (item 9): follow-up ID-on-file request, sent right after the
      // booking confirmation email.
      EmailNotificationService.sendIdRequestEmail(confirmedBookingEmailData).then(() => {
        console.log('ID request email sent successfully');
      }).catch((emailError) => {
        console.error('Failed to send ID request email:', emailError);
      });
    }

    setBookingConfirmation({
      checkIn: bookingData.data ? format(parseISO(bookingData.data.start_date), 'PPP') + ' at 3:00 PM' : '',
      checkOut: bookingData.data ? format(addDays(parseISO(bookingData.data.end_date), 1), 'PPP') + ' at 11:00 AM' : '',
      guests: bookingData.data?.guest_count || 0,
      totalPrice: bookingData.data?.total_price || 0,
      specialRequests: bookingData.data?.special_requests,
      adminContact: adminProfile ? {
        name: adminProfile.full_name || 'Property Manager',
        email: adminProfile.email || '',
        phone: adminProfile.phone_number
      } : undefined
    });
    setShowConfirmation(true);

    setSelected(undefined);
    setGuestCount(1);
    setSpecialRequests('');
    setBookingDates(null);
  };

  const handlePaymentError = (error: string) => {
    setError(`Payment failed: ${error}. Please try again or contact support.`);
    setShowPaymentForm(false);
    if (bookingDates) {
      setSelected({ from: bookingDates.from, to: bookingDates.to });
    }
  };

  const handleBlockDates = async () => {
    if (!selected?.from || !selected?.to || !isAdmin) return;

    setLoading(true);
    setError(null);

    try {
      const { error: blockError } = await supabase
        .from('blocked_dates')
        .insert({
          property_id: propertyId,
          start_date: format(selected.from, 'yyyy-MM-dd'),
          end_date: format(selected.to, 'yyyy-MM-dd'),
          reason: blockReason.trim() || null
        });

      if (blockError) throw blockError;

    } catch (err) {
      console.error('Failed to block dates:', err);
      setError('Failed to block dates. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-2 sm:p-4 sb-panel-bg rounded-lg shadow booking-calendar-outer">
        {/* David: more space above the title, less below (like the Confirm
            Your Booking modal's title spacing), and the admin toggle button
            shortened + made small/text-style like the sidebar Edit button so
            it stops squishing the title. Round 2: "remove the extra space
            under the title -- 20px between the title and the month below is
            fine" -- mb-2 (8px) bumped to a flat 20px.
            Round 3: David -- screenshot showing a huge gap under this title
            and the button sitting well off its baseline. Root cause: this
            h1 was the one .hero-title-edit use in the whole project that
            wasn't ALSO paired with .booking-modal-title (every other use --
            the booking/confirmation modal titles, the Photos modal, the
            review modal -- already resets margin/padding to 0 with it) --
            so this one alone was inheriting the generic h1{}
            rule's margin-bottom:30px + padding-bottom:25px, 55px of blank
            box that both pushed the row much taller than the text itself
            and threw items-end's "shared bottom edge" off the title's real
            baseline by that same 55px. Adding .booking-modal-title here
            fixes both at once. On top of that, cut mb-[20px] by 70% per
            David's ask, now that it's the only deliberate spacing value
            left in this gap. */}
        {/* David: the Booking/Blocking toggle button didn't sit on the
            title's baseline -- .hero-title-edit's transform-origin:bottom
            scaleY stretches its glyphs upward from the box's own bottom
            edge, so items-center (aligning box middles) put the button's
            small text noticeably higher than where the title visually
            reads. items-end lines both up on that shared bottom edge --
            now that the h1's own margin/padding bug above is fixed, that
            shared bottom edge actually sits on the title's real baseline. */}
        <div className="flex justify-between items-end mb-[6px] pt-4 pl-1">
          <h1 className="hero-title-edit booking-modal-title">
            {isAdmin && !isBookingMode ? 'Block Dates' : 'Select your dates'}
          </h1>
          {isAdmin && (
            <button
              onClick={() => {
                setIsBookingMode(!isBookingMode);
                setSelected(undefined);
              }}
              className="sidebar-btn-edit"
            >
              {isBookingMode ? 'Blocking' : 'Booking'}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <DayPicker
            mode="range"
            className="booking-calendar w-full"
            disableDefaultStyles
            selected={selected}
            onSelect={setSelected}
            disabled={disabledDays}
            numberOfMonths={numberOfMonths}
            fromDate={new Date()}
            modifiers={modifiers as any}
            modifiersStyles={modifiersStyles}
            styles={{
              root: { width: '100%', paddingRight: '8px' },
              months: { width: '100%' },
              month: { width: '100%' },
              caption: { 
                paddingLeft: '0px',
                paddingRight: '8px',
                marginBottom: '16px' /* David: "add another 10px below the month" -- was 6px */
              },
              caption_label: {
                textAlign: 'left',
                paddingLeft: '0px',
                // David: "font size increase by 25% on all the elements
                // except the title and the key text" -- this had no
                // explicit size (inherited the ambient 16px), so it's
                // pinned here first so the +25% has a real base to work
                // from: 16px * 1.25 = 20px.
                fontSize: '20px'
              },
              nav: {
                paddingRight: '0px'
              },
              table: { 
                width: '100%', 
                maxWidth: '100%',
                paddingRight: '8px'
              },
              head_row: { width: '100%' },
              head_cell: { 
                width: '14.28%', 
                textAlign: 'center',
                paddingLeft: '0px'
              },
              row: { width: '100%' },
              cell: { 
                width: '14.28%', 
                textAlign: 'center',
                paddingLeft: '0px'
              },
              day: {
                // Round 6 follow-up: David — "make the selection and other
                // circle color indicator 30% smaller in size" (was 100% of
                // the cell, i.e. filling the whole 14.28%-wide column).
                width: '70%',
                height: 'auto',
                minHeight: '28px',
                aspectRatio: '1',
                // David: "font size increase by 25%" -- clamp(12px,2.5vw,16px) * 1.25.
                fontSize: 'clamp(15px, 3.125vw, 20px)',
                textAlign: 'center'
              },
              // Brighter selection blue (David, Round 6) -- was the pale
              // #93C5FD/#1E3A8A pair; matches the modifiersStyles.selected above.
              day_range_middle: {
                backgroundColor: '#3B82F6 !important',
                color: '#FFFFFF !important'
              },
              day_range_start: {
                backgroundColor: '#3B82F6 !important',
                color: '#FFFFFF !important',
                borderTopRightRadius: '0 !important',
                borderBottomRightRadius: '0 !important'
              },
              day_range_end: {
                backgroundColor: '#3B82F6 !important',
                color: '#FFFFFF !important',
                borderTopLeftRadius: '0 !important',
                borderBottomLeftRadius: '0 !important'
              }
            } as any}
            components={{
              HeadCell: ({ ...props }: any) => (
                <th 
                  {...props} 
                  style={{ 
                    ...props.style, 
                    textAlign: 'center',
                    width: '14.28%'
                  }} 
                />
              )
            } as any}
          />
        </div>

        {/* David: "add another 10px below ... the day of the month numbers"
            -- was mt-4 (16px) between the calendar grid and this key/legend
            row, now 26px. */}
        <div className="mt-[26px] flex flex-wrap gap-4 text-sm">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-red-300 rounded" />
            <span className="text-xs text-gray-600 whitespace-nowrap">Booked</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-amber-300 rounded" />
            <span className="text-xs text-gray-600 whitespace-nowrap">Pending</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-gray-400 rounded" />
            <span className="text-xs text-gray-600 whitespace-nowrap">Blocked</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-blue-300 rounded" />
            <span className="text-xs text-gray-600 whitespace-nowrap">Selected</span>
          </div>
        </div>
      </div>

      {selected?.from && selected?.to && createPortal(
        <div className="fixed inset-0 z-[9997] overflow-y-auto" aria-labelledby="booking-modal-title" role="dialog" aria-modal="true">
          <div className="flex items-center justify-center min-h-screen p-4 text-center">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 backdrop-blur-sm transition-opacity"
              aria-hidden="true"
              onClick={() => setSelected(undefined)}
            />
            <div className="inline-block align-middle sb-panel-bg rounded-lg text-left overflow-hidden shadow-xl transform transition-all w-full max-w-[400px] modal-panel-light">
          <button
            type="button"
            onClick={() => setSelected(undefined)}
            aria-label="Close"
            className="popup-close"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 id="booking-modal-title" className="hero-title-edit booking-modal-title">
            {isAdmin && !isBookingMode ? 'Block These Dates' : 'Confirm Your Booking'}
          </h2>
          <div className="booking-modal-grid">
            <div className="booking-modal-col-left">
              <p className="booking-modal-checkin">Check-in: {format(selected.from, 'PPP')} at 3:00 PM</p>
              <p className="booking-modal-checkout">Check-out: {format(addDays(selected.to, 1), 'PPP')} at 11:00 AM</p>
              <div className="booking-modal-guest-row">
                <label className="booking-modal-label">Guests</label>
                <select id="guestCount" value={guestCount} onChange={(e) => setGuestCount(parseInt(e.target.value))} className="booking-modal-select">
                  {Array.from({ length: maxGuests }, (_, i) => i + 1).map(num => (
                    <option key={num} value={num}>{num}</option>
                  ))}
                </select>
              </div>
              {isBookingMode && (
                <div className="booking-modal-pricing">
                  <p className="booking-modal-detail">
                    Base price: ${Math.ceil((selected.to.getTime() - selected.from.getTime()) / (1000 * 60 * 60 * 24)) + 1} nights × ${pricePerNight}
                  </p>
                  {guestCount > 2 && (
                    <p className="booking-modal-detail">
                      Additional guest fee: {guestCount - 2} × $10 = ${(guestCount - 2) * 10}
                    </p>
                  )}
                  <p className="booking-modal-total">Total: ${calculateTotalPrice()}</p>
                </div>
              )}
            </div>
            <div className="booking-modal-col-right">
              <div className="booking-modal-special-requests">
                <label className="booking-modal-label">
                  Special Requests (Optional)
                </label>
                <textarea
                  id="specialRequests"
                  value={specialRequests}
                  onChange={(e) => setSpecialRequests(e.target.value)}
                  rows={3}
                  className="sb-input-light"
                  placeholder="Any special requirements or requests?"
                />
              </div>
              {isBookingMode && (
                <label className="booking-liability-row">
                  <input
                    type="checkbox"
                    id="liabilityWaiver"
                    checked={liabilityAccepted}
                    onChange={(e) => setLiabilityAccepted(e.target.checked)}
                    className="booking-liability-checkbox"
                  />
                  <span className="booking-liability-text">
                    I release the property owner from all liability in the event of injury while staying at the property.
                  </span>
                </label>
              )}
              {error && (
                <div className="rounded-md bg-red-50 p-4">
                  <div className="flex">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                    <p className="ml-3 text-sm text-red-700">{error}</p>
                  </div>
                </div>
              )}
              {!user ? (
                <button
                  onClick={() => { const event = new CustomEvent('open-auth', { detail: { mode: 'signup' } }); window.dispatchEvent(event); }}
                  className="booking-modal-submit-btn w-full"
                >
                  <Lock className="h-5 w-5" />
                  <span>Sign in to Book</span>
                </button>
              ) : (
                <button
                  onClick={handleBookingSubmit}
                  disabled={loading || (isBookingMode && !liabilityAccepted)}
                  className="booking-modal-submit-btn"
                >
                  <Calendar className="h-5 w-5" />
                  <span>{loading ? 'Processing...' : 'Book Now'}</span>
                </button>
              )}
            </div>
          </div>
          {!isBookingMode && (
            <div className="booking-modal-block-section">
              <div>
                <label htmlFor="blockReason" className="label-on-light">
                  Reason (Optional)
                </label>
                <textarea
                  id="blockReason"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  rows={3}
                  className="sb-input-light"
                  placeholder="Enter reason for blocking these dates"
                />
              </div>
              <button
                type="button"
                onClick={handleBlockDates}
                disabled={loading}
                className="booking-modal-submit-btn booking-modal-block-btn"
              >
                <Ban className="h-5 w-5" />
                <span>{loading ? 'Blocking...' : 'Block Dates'}</span>
              </button>
            </div>
          )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Payment Form — rendered in a portal to escape any parent overflow/transform */}
      {showPaymentForm && createdBookingId && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto" aria-labelledby="payment-modal" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 backdrop-blur-sm transition-opacity"
              aria-hidden="true"
              onClick={() => {
                setShowPaymentForm(false);
                setSelected(undefined);
                setGuestCount(1);
                setSpecialRequests('');
              }}
            />
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom sb-panel-bg rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
              <PaymentForm
                bookingId={createdBookingId}
                amount={bookingAmount}
                propertyTitle={property.title}
                dates={bookingDates ? `${format(bookingDates.from, 'PPP')} - ${format(bookingDates.to, 'PPP')}` : ''}
                onPaymentSuccess={handlePaymentSuccess}
                onPaymentError={handlePaymentError}
              />
              <button
                onClick={() => {
                  setShowPaymentForm(false);
                  setSelected(undefined);
                  setGuestCount(1);
                  setSpecialRequests('');
                }}
                className="mt-4 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--brand)] sm:text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Booking Confirmation Modal -- David (2026-09-22): redesigned. The old
          version repeated "payment successful" across three separate boxes
          (a bulleted "Thank you" list, then a whole extra green "Payment
          Confirmed" card saying the same thing again), had a header that
          said "Booking Request Submitted!" while the body said the booking
          was already "confirmed" -- contradictory, since payment succeeding
          IS the confirmation for this instant-book flow (see the webhook's
          payment_intent.succeeded handler, which sets status: 'approved'
          before this modal ever shows). It also hardcoded "our beautiful
          surf house" regardless of which property was actually booked. This
          version: one consistent "Confirmed" header, a single receipt-style
          card with payment status folded in as a line item rather than its
          own box, the real property name, and a tighter "what happens next"
          list with no repeated claims. */}
      {showConfirmation && bookingConfirmation && createPortal(
        <div className="fixed inset-0 z-[9998] overflow-y-auto" aria-labelledby="confirmation-modal-title" role="dialog" aria-modal="true">
          <div className="flex items-center justify-center min-h-screen p-4 text-center">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 backdrop-blur-sm transition-opacity"
              aria-hidden="true"
              onClick={() => setShowConfirmation(false)}
            />
            <div
              className="inline-block align-middle sb-panel-bg rounded-lg text-left overflow-hidden shadow-xl transform transition-all w-full max-w-[420px] modal-panel-light"
              style={{ maxHeight: '88vh', overflowY: 'auto' }}
            >
              <button
                type="button"
                onClick={() => setShowConfirmation(false)}
                aria-label="Close"
                className="popup-close"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                <Check className="h-6 w-6 text-green-600" />
              </div>
              <h2 id="confirmation-modal-title" className="hero-title-edit booking-modal-title text-center">
                Booking Confirmed
              </h2>
              <p className="body-on-light text-center text-sm -mt-2 mb-1">
                {property.title} · your stay is booked and paid for.
              </p>

              <div className="text-left">
                <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="body-on-light">Check-in</span>
                    <span className="font-medium text-right">{bookingConfirmation.checkIn}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="body-on-light">Check-out</span>
                    <span className="font-medium text-right">{bookingConfirmation.checkOut}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="body-on-light">Guests</span>
                    <span className="font-medium">{bookingConfirmation.guests}</span>
                  </div>
                  {bookingConfirmation.specialRequests && (
                    <div className="pt-1.5 border-t border-gray-200">
                      <span className="body-on-light block mb-0.5">Special requests</span>
                      <span>{bookingConfirmation.specialRequests}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-1.5 border-t border-gray-200">
                    <span className="font-semibold text-gray-900">Total paid</span>
                    <span className="font-bold text-[var(--brand)] text-base">${bookingConfirmation.totalPrice}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-green-700">
                    <Check className="h-3.5 w-3.5 flex-shrink-0" />
                    Payment received · receipt sent to your email
                  </div>
                </div>

                {bookingConfirmation.adminContact && (
                  <div className="mt-2 bg-blue-50 rounded-lg p-3">
                    <h4 className="font-medium text-blue-900 mb-1 text-sm">Your host</h4>
                    <div className="space-y-0.5 text-sm text-blue-800">
                      <div>{bookingConfirmation.adminContact.name}</div>
                      {bookingConfirmation.adminContact.email && <div>{bookingConfirmation.adminContact.email}</div>}
                      {bookingConfirmation.adminContact.phone && (
                        <div>{bookingConfirmation.adminContact.phone}</div>
                      )}
                    </div>
                  </div>
                )}

                <ul className="mt-2 space-y-1 text-sm body-on-light list-disc list-inside">
                  <li>We'll email you the full confirmation and check-in details</li>
                  <li>You can review this booking anytime from your profile</li>
                </ul>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowConfirmation(false)}
                  className="booking-modal-submit-btn w-full"
                >
                  Got it, thanks!
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}