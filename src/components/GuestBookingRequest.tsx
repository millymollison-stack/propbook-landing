import React, { useState } from 'react';
import { Loader, CheckCircle, XCircle, Clock } from 'lucide-react';
import { createBookingRequest, getGuestBookings } from '../services/guestService';
import type { Booking } from '../types';

interface GuestBookingRequestProps {
  propertyId: string;
  propertyName?: string;
  pricePerNight: number;
  maxGuests: number;
  onBookingMade?: () => void;
}

export function GuestBookingRequest({ propertyId, propertyName, pricePerNight, maxGuests, onBookingMade }: GuestBookingRequestProps) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [guestCount, setGuestCount] = useState(1);
  const [specialRequests, setSpecialRequests] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [showMyBookings, setShowMyBookings] = useState(false);
  const [loadingBookings, setLoadingBookings] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError('Please select check-in and check-out dates');
      return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
      setError('Check-out must be after check-in');
      return;
    }

    if (guestCount < 1 || guestCount > maxGuests) {
      setError(`Number of guests must be between 1 and ${maxGuests}`);
      return;
    }

    // Calculate total price
    const start = new Date(startDate);
    const end = new Date(endDate);
    const nights = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const total_price = nights * pricePerNight;

    setLoading(true);
    try {
      await createBookingRequest(propertyId, {
        start_date: startDate,
        end_date: endDate,
        guest_count: guestCount,
        special_requests: specialRequests || undefined,
        total_price,
      });
      setSuccess(true);
      setStartDate('');
      setEndDate('');
      setGuestCount(1);
      setSpecialRequests('');
      onBookingMade?.();
      setTimeout(() => setSuccess(false), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit booking request');
    } finally {
      setLoading(false);
    }
  };

  const loadMyBookings = async () => {
    if (showMyBookings) {
      setShowMyBookings(false);
      return;
    }
    setLoadingBookings(true);
    try {
      const data = await getGuestBookings(propertyId);
      setBookings(data);
      setShowMyBookings(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load bookings');
    } finally {
      setLoadingBookings(false);
    }
  };

  const StatusBadge = ({ status }: { status: Booking['status'] }) => {
    const config = {
      pending: { icon: <Clock size={14} />, label: 'Pending', className: 'bg-yellow-100 text-yellow-800' },
      approved: { icon: <CheckCircle size={14} />, label: 'Approved', className: 'bg-green-100 text-green-800' },
      denied: { icon: <XCircle size={14} />, label: 'Denied', className: 'bg-red-100 text-red-800' },
      cancelled: { icon: <XCircle size={14} />, label: 'Cancelled', className: 'bg-gray-100 text-gray-600' },
    }[status];

    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
        {config.icon}{config.label}
      </span>
    );
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="sb-panel-bg rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4">
        <h3 className="text-white text-lg font-semibold">Request to Book</h3>
        {propertyName && <p className="text-indigo-100 text-sm mt-0.5">{propertyName}</p>}
      </div>

      <div className="p-6">
        {success && (
          <div className="mb-5 bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
            <CheckCircle size={20} className="text-green-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-green-800 font-medium text-sm">Booking request sent!</p>
              <p className="text-green-700 text-sm mt-0.5">The property owner will review your request and get back to you soon.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-on-light">Check-in</label>
              <input
                type="date"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                required
              />
            </div>
            <div>
              <label className="label-on-light">Check-out</label>
              <input
                type="date"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || new Date().toISOString().split('T')[0]}
                required
              />
            </div>
          </div>

          <div>
            <label className="label-on-light">
              Guests {maxGuests && <span className="text-gray-400 font-normal">(max {maxGuests})</span>}
            </label>
            <select
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              value={guestCount}
              onChange={(e) => setGuestCount(Number(e.target.value))}
            >
              {Array.from({ length: maxGuests }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n} guest{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>

          {startDate && endDate && new Date(endDate) > new Date(startDate) && (
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  ${pricePerNight} × {Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))} nights
                </span>
                <span className="font-semibold text-gray-900">${(Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) * pricePerNight).toLocaleString()}</span>
              </div>
            </div>
          )}

          <div>
            <label className="label-on-light">Special Requests <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm resize-none"
              rows={3}
              placeholder="Early check-in, dietary requirements, occasion..."
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader size={18} className="animate-spin" />}
            {loading ? 'Sending Request...' : 'Request to Book'}
          </button>
        </form>

        {/* My Bookings Toggle */}
        <button
          type="button"
          onClick={loadMyBookings}
          className="mt-4 w-full text-center text-sm text-indigo-600 hover:text-indigo-800 font-medium py-2 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors flex items-center justify-center gap-1"
        >
          {loadingBookings ? <Loader size={16} className="animate-spin" /> : null}
          {showMyBookings ? 'Hide my bookings' : 'View my booking requests'}
        </button>

        {showMyBookings && bookings.length === 0 && !loadingBookings && (
          <p className="mt-3 text-center text-gray-500 text-sm">No booking requests yet.</p>
        )}

        {showMyBookings && bookings.length > 0 && (
          <div className="mt-4 space-y-3">
            <h4 className="text-sm font-semibold text-gray-700">Your Requests</h4>
            {bookings.map(booking => (
              <div key={booking.id} className="border border-gray-200 rounded-xl p-4 text-sm">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="font-medium text-gray-900">
                      {formatDate(booking.start_date)} → {formatDate(booking.end_date)}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">{booking.guest_count} guest{booking.guest_count > 1 ? 's' : ''} · ${booking.total_price}</p>
                  </div>
                  <StatusBadge status={booking.status} />
                </div>
                {booking.denial_reason && (
                  <p className="text-red-600 text-xs mt-1">Reason: {booking.denial_reason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
