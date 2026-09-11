import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, Loader, ArrowLeft } from 'lucide-react';
import { useAuth } from '../store/auth';
import { getGuestBookings, getPropertyId } from '../services/guestService';
import type { Booking } from '../types';

export function GuestAccount() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);

  useEffect(() => {
    const propId = getPropertyId();
    if (!propId) {
      setError('No property context found. Please visit a property page first.');
      setLoading(false);
      return;
    }
    setPropertyId(propId);

    if (!user) {
      setError('Please sign in to view your bookings.');
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const data = await getGuestBookings(propId);
        setBookings(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load bookings');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  const StatusBadge = ({ status }: { status: Booking['status'] }) => {
    const config = {
      pending: { icon: <Clock size={14} />, label: 'Pending Review', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
      approved: { icon: <CheckCircle size={14} />, label: 'Approved', className: 'bg-green-100 text-green-800 border-green-200' },
      denied: { icon: <XCircle size={14} />, label: 'Denied', className: 'bg-red-100 text-red-800 border-red-200' },
      cancelled: { icon: <XCircle size={14} />, label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-200' },
    }[status];

    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${config.className}`}>
        {config.icon}{config.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader size={32} className="animate-spin text-indigo-600 mx-auto mb-3" />
          <p className="body-on-light">Loading your bookings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full bg-white shadow-sm hover:shadow-md transition-shadow"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <h1 className="h2-on-light">My Bookings</h1>
            <p className="body-on-light mt-0.5">Your requests for this property</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <XCircle size={32} className="text-red-400 mx-auto mb-3" />
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        )}

        {!error && bookings.length === 0 && (
          <div className="sb-panel-bg rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
            <div className="text-5xl mb-4">🏠</div>
            <h2 className="h4-on-light mb-2">No bookings yet</h2>
            <p className="body-on-light mb-6">You haven't made any booking requests for this property.</p>
            <button
              onClick={() => navigate(-1)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
            >
              Back to property
            </button>
          </div>
        )}

        {!error && bookings.length > 0 && (
          <div className="space-y-4">
            {bookings.map(booking => (
              <div key={booking.id} className="sb-panel-bg rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {/* Status Banner */}
                <div className={`px-6 py-3 flex items-center justify-between ${
                  booking.status === 'approved' ? 'bg-green-50 border-b border-green-100' :
                  booking.status === 'denied' ? 'bg-red-50 border-b border-red-100' :
                  booking.status === 'pending' ? 'bg-yellow-50 border-b border-yellow-100' :
                  'bg-gray-50 border-b border-gray-100'
                }`}>
                  <StatusBadge status={booking.status} />
                  <span className="text-gray-400 text-xs">#{booking.id.slice(0, 8)}</span>
                </div>

                <div className="p-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <p className="caption-on-light">Check-in</p>
                      <p className="text-gray-900 font-semibold">{formatDate(booking.start_date)}</p>
                    </div>
                    <div>
                      <p className="caption-on-light">Check-out</p>
                      <p className="text-gray-900 font-semibold">{formatDate(booking.end_date)}</p>
                    </div>
                    <div>
                      <p className="caption-on-light">Guests</p>
                      <p className="text-gray-900 font-semibold">{booking.guest_count}</p>
                    </div>
                    <div>
                      <p className="caption-on-light">Total</p>
                      <p className="text-gray-900 font-semibold">${booking.total_price.toLocaleString()}</p>
                    </div>
                  </div>

                  {booking.special_requests && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="caption-on-light">Special Requests</p>
                      <p className="body-on-light">{booking.special_requests}</p>
                    </div>
                  )}

                  {booking.denial_reason && (
                    <div className="mt-4 pt-4 border-t border-red-100 bg-red-50 rounded-xl p-4">
                      <p className="text-xs text-red-400 uppercase tracking-wide font-medium mb-1">Reason for Denial</p>
                      <p className="text-red-700 text-sm">{booking.denial_reason}</p>
                    </div>
                  )}

                  {booking.status === 'approved' && (
                    <div className="mt-4 pt-4 border-t border-green-100 bg-green-50 rounded-xl p-4">
                      <p className="text-green-800 text-sm font-medium">🎉 Your booking is confirmed!</p>
                      <p className="text-green-700 text-sm mt-1">The property owner will be in touch with next steps.</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
