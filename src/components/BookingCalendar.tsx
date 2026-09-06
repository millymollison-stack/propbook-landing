import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './Editmode.css';
import { DayPicker, DateRange } from 'react-day-picker';
import { format, isWithinInterval, parseISO, addDays } from 'date-fns';
import { Calendar, Lock, AlertCircle, Ban, Check } from 'lucide-react';
import type { Booking, BlockedDate } from '../types';
import { useAuth } from '../store/auth';

import { EmailNotificationService } from '../services/emailService';
import { supabase } from '../lib/supabase';
import { PaymentForm } from './PaymentForm';
import 'react-day-picker/dist/style.css';

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
  maxGuests,
  onBookingSubmit
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
  const authTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [adminProfile, setAdminProfile] = useState<any>(null);

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
      authTimerRef.current = setTimeout(() => { window.dispatchEvent(new CustomEvent('open-auth', { detail: { mode: 'login' } })); }, 2000);
    }
    return () => { if (authTimerRef.current) clearTimeout(authTimerRef.current); };
  }, [selected, user]);

  const approvedBookings = bookings
    .filter(booking => booking.status === 'approved')
    .map(booking => ({
      from: parseISO(booking.start_date),
      to: parseISO(booking.end_date)
    }));

  const pendingBookings = bookings
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
    approved: { backgroundColor: '#FEE2E2', color: '#991B1B' },
    pending: { backgroundColor: '#FEF3C7', color: '#92400E' },
    blocked: { backgroundColor: '#E5E7EB', color: '#374151' },
    selected: { backgroundColor: '#FDF2F8', color: 'var(--brand)' }
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
      // Send confirmation email (non-blocking)
      EmailNotificationService.sendBookingConfirmationEmail({
        booking: {
          start_date: bookingData.data.start_date,
          end_date: bookingData.data.end_date,
          guest_count: bookingData.data.guest_count,
          total_price: bookingData.data.total_price,
          special_requests: bookingData.data.special_requests
        },
        user: user!,
        property
      }).then(() => {
        console.log('Confirmation email sent successfully');
      }).catch((emailError) => {
        console.error('Failed to send confirmation email:', emailError);
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
        email: adminProfile.email || 'contact@surfhousebaja.com',
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
      <div className="p-2 sm:p-4 bg-white rounded-lg shadow">
        <div className="flex justify-between items-center mb-4 pt-2 pl-1">
          <h1 className="hero-title-edit">
            {isAdmin && !isBookingMode ? 'Block Dates' : 'Select your dates'}
          </h1>
          {isAdmin && (
            <button
              onClick={() => {
                setIsBookingMode(!isBookingMode);
                setSelected(undefined);
              }}
              className={`px-2 sm:px-3 py-1 rounded-md text-sm ${
                isBookingMode ? 'bg-gray-100' : 'bg-gray-200'
              } hover:bg-gray-200`}
            >
              {isBookingMode ? 'Switch to Blocking' : 'Switch to Booking'}
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
            modifiers={modifiers}
            modifiersStyles={modifiersStyles}
            styles={{
              root: { width: '100%', paddingRight: '8px' },
              months: { width: '100%' },
              month: { width: '100%' },
              caption: { 
                paddingLeft: '0px',
                paddingRight: '8px',
                marginBottom: '8px'
              },
              caption_label: {
                textAlign: 'left',
                paddingLeft: '0px'
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
                width: '100%', 
                height: 'auto',
                minHeight: '40px',
                aspectRatio: '1',
                fontSize: 'clamp(12px, 2.5vw, 16px)',
                textAlign: 'center'
              },
              day_range_middle: {
                backgroundColor: '#DBEAFE !important',
                color: '#1E40AF !important'
              },
              day_range_start: {
                backgroundColor: '#DBEAFE !important',
                color: '#1E40AF !important',
                borderTopRightRadius: '0 !important',
                borderBottomRightRadius: '0 !important'
              },
              day_range_end: {
                backgroundColor: '#DBEAFE !important',
                color: '#1E40AF !important',
                borderTopLeftRadius: '0 !important',
                borderBottomLeftRadius: '0 !important'
              }
            }}
            components={{
              HeadCell: ({ ...props }) => (
                <th 
                  {...props} 
                  style={{ 
                    ...props.style, 
                    textAlign: 'center',
                    width: '14.28%'
                  }} 
                />
              )
            }}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-red-100 rounded" />
            <span className="text-xs text-gray-600 whitespace-nowrap">Booked</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-yellow-100 rounded" />
            <span className="text-xs text-gray-600 whitespace-nowrap">Pending</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-gray-200 rounded" />
            <span className="text-xs text-gray-600 whitespace-nowrap">Blocked</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-blue-100 rounded" />
            <span className="text-xs text-gray-600 whitespace-nowrap">Selected</span>
          </div>
        </div>
      </div>

      {selected?.from && selected?.to && (
        <div className="booking-modal-body">
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
                  onClick={() => { const event = new CustomEvent('open-auth', { detail: { mode: 'login' } }); window.dispatchEvent(event); }}
                  className="booking-modal-submit-btn w-full"
                >
                  <Lock className="h-5 w-5" />
                  <span>Sign in to Book</span>
                </button>
              ) : (
                <button
                  onClick={handleBookingSubmit}
                  disabled={loading}
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
                <label htmlFor="blockReason" className="block text-sm font-medium text-gray-700">
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
      )}

      {/* Payment Form — rendered in a portal to escape any parent overflow/transform */}
      {showPaymentForm && createdBookingId && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto" aria-labelledby="payment-modal" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" />
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
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

      {/* Booking Confirmation Modal */}
      {showConfirmation && bookingConfirmation && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true"></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
              <div>
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                  <Check className="h-6 w-6 text-green-600" />
                </div>
                <div className="mt-3 text-center sm:mt-5">
                  <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                    Booking Request Submitted!
                  </h3>
                  <div className="mt-4 text-left">
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <h4 className="font-medium text-gray-900">Booking Details:</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Check-in:</span>
                          <span className="font-medium">{bookingConfirmation.checkIn}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Check-out:</span>
                          <span className="font-medium">{bookingConfirmation.checkOut}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Guests:</span>
                          <span className="font-medium">{bookingConfirmation.guests}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Total Price:</span>
                          <span className="font-medium">${bookingConfirmation.totalPrice}</span>
                        </div>
                        {bookingConfirmation.specialRequests && (
                          <div className="pt-2 border-t">
                            <span className="text-gray-600 block">Special Requests:</span>
                            <span className="text-sm">{bookingConfirmation.specialRequests}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {bookingConfirmation.adminContact && (
                      <div className="mt-4 bg-blue-50 rounded-lg p-4">
                        <h4 className="font-medium text-blue-900 mb-2">Property Manager Contact:</h4>
                        <div className="space-y-1 text-sm text-blue-800">
                          <div>{bookingConfirmation.adminContact.name}</div>
                          <div>{bookingConfirmation.adminContact.email}</div>
                          {bookingConfirmation.adminContact.phone && (
                            <div>{bookingConfirmation.adminContact.phone}</div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="mt-4 text-sm text-gray-600">
                      <h4 className="font-medium text-gray-900 mb-2">Thank you for your booking!</h4>
                      <ul className="space-y-1 list-disc list-inside">
                        <li>We're excited to host you at our beautiful surf house!</li>
                        <li>Your payment has been processed successfully</li>
                        <li>Your booking is now <span className="font-medium text-green-600">confirmed</span></li>
                        <li>You'll receive a confirmation email with all the details</li>
                        <li>You can check your booking details anytime by clicking on your profile</li>
                      </ul>
                    </div>

                    <div className="mt-4 bg-green-50 rounded-lg p-4">
                      <h4 className="font-medium text-green-900 mb-2">Payment Confirmed</h4>
                      <p className="text-sm text-green-800">
                        Your payment of ${bookingConfirmation.totalPrice} has been successfully processed.
                        A receipt has been sent to your email.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-6">
                <button
                  type="button"
                  onClick={() => setShowConfirmation(false)}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-[var(--brand)] text-base font-medium text-white hover:bg-[var(--brand-hover)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#C47756] sm:text-sm"
                >
                  Got it, thanks!
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}