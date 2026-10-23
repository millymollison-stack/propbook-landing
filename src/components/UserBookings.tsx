import { useState, useMemo, useEffect } from 'react';
import { memo } from 'react';
import { format, addDays } from 'date-fns';
import { Check, X, Clock, Mail, Phone, User, MessageSquare, Home, CreditCard, AlertCircle } from 'lucide-react';
import type { Booking, Property, Profile, PaymentStatus } from '../types';
import { useAuth } from '../store/auth';
import { supabase } from '../lib/supabase';

interface UserBookingsProps {
  bookings: (Booking & { property: Property; user: Profile })[];
  onUpdateStatus?: (bookingId: string, status: 'approved' | 'denied', reason?: string) => Promise<void>;
  onRefund?: (bookingId: string) => Promise<void>;
}

const UserBookings = memo(function UserBookings({ bookings, onUpdateStatus, onRefund }: UserBookingsProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [denialReason, setDenialReason] = useState('');
  const [showDenialModal, setShowDenialModal] = useState<string | null>(null);
  const [adminProfile, setAdminProfile] = useState<Profile | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRefunding, setIsRefunding] = useState<string | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) {
      loadAdminProfile();
    }
  }, [isAdmin]);

  const loadAdminProfile = async () => {
    try {
      // Public view — see David 2026-09-22 RLS lockdown, the full `profiles`
      // table is no longer publicly readable.
      const { data: adminUsers, error } = await supabase
        .from('host_contact')
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

  const handleStatusUpdate = async (bookingId: string, status: 'approved' | 'denied', reason?: string) => {
    if (!onUpdateStatus) return;

    setIsUpdating(true);
    try {
      await onUpdateStatus(bookingId, status, reason);
    } catch (error) {
      console.error('Failed to update booking status:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRefund = async (bookingId: string) => {
    if (!onRefund) return;

    if (!confirm('Are you sure you want to refund this booking? This action cannot be undone.')) {
      return;
    }

    setIsRefunding(bookingId);
    try {
      await onRefund(bookingId);
      alert('Refund processed successfully');
    } catch (error) {
      console.error('Failed to process refund:', error);
      alert('Failed to process refund. Please try again.');
    } finally {
      setIsRefunding(null);
    }
  };

  const filteredBookings = useMemo(() => {
    let filtered = [...bookings];
    if (statusFilter !== 'all') {
      filtered = filtered.filter(booking => booking.status === statusFilter);
    }
    return filtered;
  }, [bookings, statusFilter]);

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      approved: { icon: Check, bg: 'bg-green-100', text: 'text-green-800' },
      denied: { icon: X, bg: 'bg-red-100', text: 'text-red-800' },
      cancelled: { icon: X, bg: 'bg-gray-100', text: 'text-gray-800' },
      pending: { icon: Clock, bg: 'bg-yellow-100', text: 'text-yellow-800' }
    }[status] || { icon: Clock, bg: 'bg-gray-100', text: 'text-gray-800' };

    const Icon = statusConfig.icon;

    return (
      <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${statusConfig.bg} ${statusConfig.text}`}>
        <Icon className="w-4 h-4 mr-1.5" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getPaymentStatusBadge = (paymentStatus: PaymentStatus) => {
    const statusConfig = {
      paid: { icon: Check, bg: 'bg-green-100', text: 'text-green-800', label: 'Paid' },
      pending: { icon: Clock, bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Payment Pending' },
      // David 2026-10-19: these two were missing -- PaymentStatus gained
      // 'authorized'/'canceled' with the auth-hold flow (card held, not
      // charged, pending host approval / hold released), but this badge's
      // own config was never updated to match, so both silently fell
      // through to the generic "Unknown" badge below. That's what made a
      // perfectly normal pending/authorized booking look broken here.
      authorized: { icon: Clock, bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Card Held' },
      canceled: { icon: X, bg: 'bg-gray-100', text: 'text-gray-800', label: 'Hold Released' },
      unpaid: { icon: AlertCircle, bg: 'bg-gray-100', text: 'text-gray-800', label: 'Unpaid' },
      refunded: { icon: CreditCard, bg: 'bg-blue-100', text: 'text-blue-800', label: 'Refunded' },
      failed: { icon: X, bg: 'bg-red-100', text: 'text-red-800', label: 'Payment Failed' }
    }[paymentStatus] || { icon: AlertCircle, bg: 'bg-gray-100', text: 'text-gray-800', label: 'Unknown' };

    const Icon = statusConfig.icon;

    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.text}`}>
        <Icon className="w-3.5 h-3.5 mr-1" />
        {statusConfig.label}
      </span>
    );
  };

  if (!bookings.length) {
    return (
      <div className="text-center py-12">
        <p className="body-on-light">No bookings found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-center pt-6">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-48 text-base border-gray-300 rounded-md shadow-sm focus:ring-[var(--brand)] focus:border-[#C47756] bookings-filter-select"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="divide-y divide-gray-200">
        {filteredBookings.map((booking) => (
          <div key={booking.id} className="py-4">
            <div className="flex justify-center items-center gap-2 mb-4 flex-wrap">
              {getStatusBadge(booking.status)}
              {getPaymentStatusBadge(booking.payment_status)}
            </div>

            {isAdmin ? (
              // Admin view with guest details
              <div className="space-y-2">
                <div className="flex items-center">
                  <User className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="font-medium">{booking.user?.full_name || 'Unknown User'}</span>
                </div>
                <div className="flex items-center body-on-light">
                  <Mail className="h-4 w-4 text-gray-400 mr-2" />
                  {booking.user?.email || 'No email provided'}
                </div>
                <div className="flex items-center body-on-light">
                  <Phone className="h-4 w-4 text-gray-400 mr-2" />
                  {booking.user?.phone_number || 'No phone provided'}
                </div>
              </div>
            ) : (
              // User view with property and admin details
              <div className="space-y-2">
                <div className="flex items-center">
                  <Home className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="font-medium">{booking.property.title}</span>
                </div>
                <div className="body-on-light">
                  <div className="flex items-center">
                    <User className="h-4 w-4 text-gray-400 mr-2" />
                    {adminProfile?.full_name || 'Property Manager'}
                  </div>
                  <div className="flex items-center mt-1">
                    <Mail className="h-4 w-4 text-gray-400 mr-2" />
                    {adminProfile?.email || 'contact@surfhousebaja.com'}
                  </div>
                  <div className="flex items-center mt-1">
                    <Phone className="h-4 w-4 text-gray-400 mr-2" />
                    {adminProfile?.phone_number || '+1 (555) 123-4567'}
                  </div>
                </div>
              </div>
            )}

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
                  {booking.amount_paid ? `$${(booking.amount_paid / 100).toFixed(2)}` : '-'}
                </dd>
              </div>
            </div>

            {booking.special_requests && (
              <div className="mt-4">
                <dt className="text-sm font-medium text-gray-500 flex items-center">
                  <MessageSquare className="h-4 w-4 mr-1" />
                  Special Requests
                </dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {booking.special_requests}
                </dd>
              </div>
            )}

            {isAdmin && booking.status === 'pending' && (
              showDenialModal === booking.id ? (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
                  <label className="block text-xs font-medium text-gray-700">
                    Reason for denial (included in the guest's email)
                  </label>
                  <textarea
                    rows={2}
                    autoFocus
                    className="shadow-sm focus:ring-[var(--brand)] focus:border-[#C47756] block w-full sm:text-sm border-gray-300 rounded-md"
                    placeholder="Optional -- e.g. dates no longer available"
                    value={denialReason}
                    onChange={(e) => setDenialReason(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={isUpdating}
                      className="inline-flex items-center px-3 py-1.5 rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => { setShowDenialModal(null); setDenialReason(''); }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isUpdating}
                      className="inline-flex items-center px-3 py-1.5 rounded-md bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                      onClick={() => {
                        handleStatusUpdate(booking.id, 'denied', denialReason);
                        setShowDenialModal(null);
                        setDenialReason('');
                      }}
                    >
                      {isUpdating ? 'Updating...' : 'Confirm Denial'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex justify-center space-x-3">
                  <button
                    onClick={() => handleStatusUpdate(booking.id, 'approved')}
                    disabled={isUpdating}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-green-400"
                  >
                    <Check className="h-4 w-4 mr-1" />
                    {isUpdating ? 'Updating...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => setShowDenialModal(booking.id)}
                    disabled={isUpdating}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Deny
                  </button>
                </div>
              )
            )}

            {isAdmin && booking.status === 'denied' && booking.payment_status === 'paid' && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => handleRefund(booking.id)}
                  disabled={isRefunding === booking.id}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400"
                >
                  <CreditCard className="h-4 w-4 mr-1" />
                  {isRefunding === booking.id ? 'Processing...' : 'Process Refund'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

    </div>
  );
});

export default UserBookings;