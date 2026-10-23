import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { BarChart, Calendar, Users, DollarSign, ArrowUp, ArrowDown, Filter, Star } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';
import { EmailNotificationService } from '../services/emailService';
import { describeInvokeError, errorMessage } from '../utils/bookingErrors';
import AdminReviewManagement from '../components/AdminReviewManagement';
import type { Booking, Property, Profile } from '../types';

interface BookingStats {
  total: number;
  pending: number;
  approved: number;
  denied: number;
  cancelled: number;
  totalRevenue: number;
  averageBookingValue: number;
}

interface DailyStats {
  date: string;
  bookings: number;
  revenue: number;
}

export function AdminDashboard() {
  const [bookings, setBookings] = useState<(Booking & { property: Property; user: Profile })[]>([]);
  const [stats, setStats] = useState<BookingStats>({
    total: 0,
    pending: 0,
    approved: 0,
    denied: 0,
    cancelled: 0,
    totalRevenue: 0,
    averageBookingValue: 0,
  });
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBookings, setSelectedBookings] = useState<string[]>([]);
  const [denialReason, setDenialReason] = useState('');
  const [showDenialModal, setShowDenialModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'bookings' | 'reviews'>('bookings');
  const { user } = useAuth();
  const navigate = useNavigate();

  console.log('=== ADMIN DASHBOARD RENDERED ===');
  console.log('Active tab:', activeTab);
  console.log('User:', user);

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/');
      return;
    }

    loadBookings();
  }, [user, navigate]);

  const loadBookings = async () => {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          property:properties(*),
          user:profiles(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setBookings(data || []);

      // Calculate statistics
      const bookingStats = (data || []).reduce(
        (acc, booking) => {
          acc.total++;
          acc[booking.status]++;
          if (booking.status === 'approved') {
            acc.totalRevenue += booking.total_price;
          }
          return acc;
        },
        {
          total: 0,
          pending: 0,
          approved: 0,
          denied: 0,
          cancelled: 0,
          totalRevenue: 0,
          averageBookingValue: 0,
        }
      );

      bookingStats.averageBookingValue =
        bookingStats.approved > 0
          ? bookingStats.totalRevenue / bookingStats.approved
          : 0;

      setStats(bookingStats);

      // Calculate daily stats for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const dailyData = (data || [])
        .filter(booking => new Date(booking.created_at) >= thirtyDaysAgo)
        .reduce((acc: Record<string, DailyStats>, booking) => {
          const date = format(new Date(booking.created_at), 'yyyy-MM-dd');
          if (!acc[date]) {
            acc[date] = { date, bookings: 0, revenue: 0 };
          }
          acc[date].bookings++;
          if (booking.status === 'approved') {
            acc[date].revenue += booking.total_price;
          }
          return acc;
        }, {});

      setDailyStats(Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)));
    } catch (error) {
      console.error('Error loading bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (status: 'approved' | 'denied') => {
    console.log('=== ADMIN DASHBOARD: handleStatusUpdate called ===');
    console.log('Status:', status);
    console.log('Selected bookings:', selectedBookings);
    
    if (selectedBookings.length === 0) return;

    try {
      if (status === 'denied' && !denialReason) {
        console.log('Opening denial modal because no reason provided');
        setShowDenialModal(true);
        return;
      }

      // David 2026-10-22: a booking can't be approved unless its property has
      // an address on file -- that's what gets shown to the guest once
      // confirmed, in the sidebar and the approval email. Denying still goes
      // through for these (no address needed to turn a booking down); only
      // approval is blocked, and the admin is told which ones were skipped.
      // David 2026-10-22 (same day): "Allow coordinates to work as an address
      // in our system if needed as my vacation rental doesn't have an address
      // as it's off grid." A saved lat/long (location_type: 'coordinates')
      // counts the same as a street address here.
      let bookingIdsToProcess = selectedBookings;
      if (status === 'approved') {
        const missingAddress: string[] = [];
        bookingIdsToProcess = selectedBookings.filter(id => {
          const b = bookings.find(bk => bk.id === id);
          const hasAddress = !!b?.property?.address?.trim();
          const hasCoordinates = b?.property?.location_type === 'coordinates'
            && b?.property?.latitude != null && b?.property?.longitude != null;
          if (!hasAddress && !hasCoordinates) {
            missingAddress.push(b?.property?.title || id);
            return false;
          }
          return true;
        });
        if (missingAddress.length > 0) {
          window.alert(`Can't approve: ${missingAddress.join(', ')} ${missingAddress.length === 1 ? 'has' : 'have'} no property address or coordinates on file yet. Add one in Website settings first.`);
        }
        if (bookingIdsToProcess.length === 0) return;
      }

      // Auth-hold flow: capture (approve) or cancel (deny) each booking's held
      // payment before flipping its status. A booking with no payment intent yet
      // (guest never reached that step) comes back as { skipped: true } and still
      // proceeds. A booking whose hold genuinely can't be captured/canceled is
      // excluded from the status update below rather than silently marked approved/denied.
      const actionableBookingIds: string[] = [];
      for (const bookingId of bookingIdsToProcess) {
        try {
          const { data, error: fnError } = await supabase.functions.invoke('capture-booking-payment', {
            body: { bookingId, action: status === 'approved' ? 'capture' : 'cancel' },
          });
          if (fnError || data?.error) {
            throw new Error((await describeInvokeError(fnError, data)) || 'Payment update failed');
          }
          actionableBookingIds.push(bookingId);
        } catch (err) {
          console.error(`❌ Payment ${status === 'approved' ? 'capture' : 'cancel'} failed for booking ${bookingId}:`, err);
          window.alert(`Couldn't ${status === 'approved' ? 'approve' : 'deny'} booking ${bookingId}: ${errorMessage(err, 'payment action failed')}`);
        }
      }
      if (actionableBookingIds.length === 0) {
        console.log('No bookings could be updated — all payment actions failed.');
        return;
      }

      console.log('Updating booking status in database...');
      const { error } = await supabase
        .from('bookings')
        .update({
          status,
          updated_at: new Date().toISOString(),
          ...(status === 'denied' ? { denial_reason: denialReason } : {})
        })
        .in('id', actionableBookingIds);

      if (error) throw error;
      console.log('Database update successful');

      // Send email notifications for each updated booking
      console.log('Starting email notification process...');
      for (const bookingId of actionableBookingIds) {
        console.log('Processing booking ID:', bookingId);
        const booking = bookings.find(b => b.id === bookingId);
        console.log('Found booking:', booking);
        if (booking) {
          try {
            console.log('=== EMAIL SENDING DEBUG ===');
            console.log('Booking ID:', bookingId);
            console.log('Status:', status);
            console.log('Booking data:', JSON.stringify(booking, null, 2));
            
            if (status === 'approved') {
              console.log('Calling sendBookingApprovedEmail...');
              const approvedEmailData = {
                booking: {
                  start_date: booking.start_date,
                  end_date: booking.end_date,
                  guest_count: booking.guest_count,
                  total_price: booking.total_price,
                  special_requests: booking.special_requests
                },
                user: booking.user,
                property: booking.property
              };
              await EmailNotificationService.sendBookingApprovedEmail(approvedEmailData);
              console.log('✅ Approval email sent successfully');

              // David 2026-10-18: ID-on-file follow-up now fires here --
              // this is the point the booking is actually confirmed (card
              // captured), not when the guest merely authorized it.
              EmailNotificationService.sendIdRequestEmail(approvedEmailData).then(() => {
                console.log('✅ ID request email sent successfully');
              }).catch((idErr) => {
                console.error('❌ Failed to send ID request email:', idErr);
              });
            } else if (status === 'denied') {
              console.log('Calling sendBookingDenialEmail with reason:', denialReason);
              await EmailNotificationService.sendBookingDenialEmail({
                booking: {
                  start_date: booking.start_date,
                  end_date: booking.end_date,
                  guest_count: booking.guest_count,
                  total_price: booking.total_price,
                  special_requests: booking.special_requests
                },
                user: booking.user,
                property: booking.property,
                denialReason
              });
              console.log('✅ Denial email sent successfully');
            }
          } catch (emailError) {
            console.error('❌ Failed to send status update email:', emailError);
            console.error('Email error details:', emailError);
            // Don't fail the status update if email fails
          }
        } else {
          console.error('❌ Booking not found for ID:', bookingId);
        }
      }

      console.log('Cleaning up and reloading...');
      setSelectedBookings([]);
      setDenialReason('');
      setShowDenialModal(false);
      await loadBookings();
      console.log('=== ADMIN DASHBOARD: handleStatusUpdate completed ===');
    } catch (error) {
      console.error('❌ Error updating bookings:', error);
    }
  };

  if (loading) {
    console.log('⏳ Admin Dashboard is in loading state');
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--brand)]" />
      </div>
    );
  }

  console.log('✅ Admin Dashboard finished loading, rendering main content');
  console.log('📊 Total bookings loaded:', bookings.length);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-[2rem] md:text-[3.3rem] text-gray-900 mb-8">Admin Dashboard</h1>
      <p className="body-on-light mb-4">Tabs should appear below this line:</p>

      {/* Tab Navigation */}
      <div className="mb-8 border-b-2 border-gray-300">
        <nav className="flex gap-4">
          <button
            onClick={() => {
              console.log('Switching to bookings tab');
              setActiveTab('bookings');
            }}
            className={`pb-4 px-6 border-b-4 font-semibold text-lg transition-colors ${
              activeTab === 'bookings'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-400'
            }`}
          >
            <div className="flex items-center gap-3">
              <Calendar className="w-6 h-6" />
              <span>Bookings</span>
            </div>
          </button>
          <button
            onClick={() => {
              console.log('Switching to reviews tab');
              setActiveTab('reviews');
            }}
            className={`pb-4 px-6 border-b-4 font-semibold text-lg transition-colors ${
              activeTab === 'reviews'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-400'
            }`}
          >
            <div className="flex items-center gap-3">
              <Star className="w-6 h-6" />
              <span>Reviews</span>
            </div>
          </button>
        </nav>
      </div>

      {activeTab === 'bookings' ? (
        <>
          {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="sb-panel-bg rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="body-on-light">Total Bookings</p>
              <p className="text-2xl font-semibold">{stats.total}</p>
            </div>
            <Calendar className="h-8 w-8 text-[var(--brand)]" />
          </div>
          <div className="mt-4">
            <div className="flex items-center text-sm">
              <span className="text-green-500 flex items-center">
                <ArrowUp className="h-4 w-4 mr-1" />
                {((stats.approved / stats.total) * 100).toFixed(1)}%
              </span>
              <span className="ml-2 body-on-light">Approval rate</span>
            </div>
          </div>
        </div>

        <div className="sb-panel-bg rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="body-on-light">Pending Requests</p>
              <p className="text-2xl font-semibold">{stats.pending}</p>
            </div>
            <Users className="h-8 w-8 text-yellow-500" />
          </div>
          <div className="mt-4">
            <div className="flex items-center text-sm">
              <span className="text-yellow-500">Requires attention</span>
            </div>
          </div>
        </div>

        <div className="sb-panel-bg rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="body-on-light">Total Revenue</p>
              <p className="text-2xl font-semibold">${stats.totalRevenue}</p>
            </div>
            <DollarSign className="h-8 w-8 text-green-500" />
          </div>
          <div className="mt-4">
            <div className="flex items-center text-sm">
              <span className="body-on-light">
                Avg. ${stats.averageBookingValue.toFixed(2)} per booking
              </span>
            </div>
          </div>
        </div>

        <div className="sb-panel-bg rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="body-on-light">Booking Trends</p>
              <p className="text-2xl font-semibold">
                {dailyStats.length > 0
                  ? dailyStats[dailyStats.length - 1].bookings
                  : 0}
              </p>
            </div>
            <BarChart className="h-8 w-8 text-purple-500" />
          </div>
          <div className="mt-4">
            <div className="flex items-center text-sm">
              {dailyStats.length >= 2 && (
                <>
                  {dailyStats[dailyStats.length - 1].bookings >
                  dailyStats[dailyStats.length - 2].bookings ? (
                    <span className="text-green-500 flex items-center">
                      <ArrowUp className="h-4 w-4 mr-1" />
                      Increasing
                    </span>
                  ) : (
                    <span className="text-red-500 flex items-center">
                      <ArrowDown className="h-4 w-4 mr-1" />
                      Decreasing
                    </span>
                  )}
                </>
              )}
              <span className="ml-2 body-on-light">Today's bookings</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bookings Table */}
      <div className="sb-panel-bg shadow rounded-lg overflow-hidden">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="h4-on-light">Recent Bookings</h2>
            <div className="flex items-center space-x-2">
              {selectedBookings.length > 0 && (
                <>
                  <button
                    onClick={() => handleStatusUpdate('approved')}
                    className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700"
                  >
                    Approve Selected
                  </button>
                  <button
                    onClick={() => handleStatusUpdate('denied')}
                    className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700"
                  >
                    Deny Selected
                  </button>
                </>
              )}
              <button className="p-2 hover:bg-gray-100 rounded-full">
                <Filter className="h-5 w-5 text-gray-500" />
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left table-header-on-light">
                  <input
                    type="checkbox"
                    checked={selectedBookings.length === bookings.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedBookings(bookings.map(b => b.id));
                      } else {
                        setSelectedBookings([]);
                      }
                    }}
                    className="h-4 w-4 text-[var(--brand)] focus:ring-[#C47756] border-gray-300 rounded"
                  />
                </th>
                <th scope="col" className="px-6 py-3 text-left table-header-on-light">
                  Guest
                </th>
                <th scope="col" className="px-6 py-3 text-left table-header-on-light">
                  Property
                </th>
                <th scope="col" className="px-6 py-3 text-left table-header-on-light">
                  Dates
                </th>
                <th scope="col" className="px-6 py-3 text-left table-header-on-light">
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-left table-header-on-light">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {bookings.map((booking) => (
                <tr key={booking.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedBookings.includes(booking.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedBookings([...selectedBookings, booking.id]);
                        } else {
                          setSelectedBookings(selectedBookings.filter(id => id !== booking.id));
                        }
                      }}
                      className="h-4 w-4 text-[var(--brand)] focus:ring-[#C47756] border-gray-300 rounded"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {booking.user?.full_name || 'Unknown User'}
                        </div>
                        <div className="body-on-light">
                          {booking.user?.email || 'No email provided'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{booking.property?.title || 'Unknown Property'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {format(new Date(booking.start_date), 'MMM d')} -{' '}
                      {format(new Date(booking.end_date), 'MMM d, yyyy')}
                    </div>
                    <div className="body-on-light">
                      {booking.guest_count} guests
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      booking.status === 'approved'
                        ? 'bg-green-100 text-green-800'
                        : booking.status === 'denied'
                        ? 'bg-red-100 text-red-800'
                        : booking.status === 'cancelled'
                        ? 'bg-gray-100 text-gray-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap body-on-light">
                    ${booking.total_price}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Denial Reason Modal */}
      {showDenialModal && (
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowDenialModal(false); setDenialReason(''); } }}
        >
          <div className="sb-panel-bg rounded-lg p-6 max-w-md w-full">
            <h3 className="h4-on-light mb-4">
              Provide Reason for Denial
            </h3>
            <textarea
              value={denialReason}
              onChange={(e) => setDenialReason(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-[var(--brand)]"
              rows={4}
              placeholder="Enter reason for denying the booking..."
            />
            <div className="mt-4 flex justify-end space-x-2">
              <button
                onClick={() => setShowDenialModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleStatusUpdate('denied')}
                className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700"
              >
                Confirm Denial
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      ) : (
        <AdminReviewManagement />
      )}
    </div>
  );
}