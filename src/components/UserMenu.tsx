import { useState, useEffect } from 'react';
import { X, User, LogOut, AlertCircle, Building, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { supabase } from '../lib/supabase';
import { EmailNotificationService } from '../services/emailService';
import UserBookings from './UserBookings';
import type { Booking, Property, Profile } from '../types';

export function UserMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [bookings, setBookings] = useState<(Booking & { property: Property; user: Profile })[]>([]);
  const [loading, setLoading] = useState(false);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    full_name: '',
    email: '',
    phone_number: '',
    stripe_account_id: '',
    stripe_account_status: ''
  });
  const [userProperty, setUserProperty] = useState<Property | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [showPayoutPanel, setShowPayoutPanel] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const isSaaSAdmin = user?.role === 'saas_admin';
  const isAdmin = user?.role === 'admin';
  const isGuest = !isSaaSAdmin && !isAdmin;
  const isOnPropertySite = !!(window as any).__PROPERTY_DATA__?.id;

  // Close menu on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const menuPanel = document.querySelector('[data-user-menu-panel]');
      const menuButton = document.querySelector('[data-user-menu-button]');
      if (menuPanel && !menuPanel.contains(target) && menuButton && !menuButton.contains(target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setBookings([]);
      setBookingsLoading(false);
      setShowPayoutPanel(false);
      return;
    }
    if (!user) return;

    setBookings([]);
    setBookingsLoading(true);
    setBookingError(null);
    setShowPayoutPanel(false);

    const load = async () => {
      try {
        let query = supabase
          .from('bookings')
          .select(`*, property:properties!inner(*), user:profiles!inner(*)`);

        if (isSaaSAdmin) {
          query = query.order('status', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
        } else if (isAdmin) {
          query = query.order('status', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
        } else {
          query = query.eq('user_id', user.id).order('created_at', { ascending: false });
        }

        const { data, error } = await query;
        if (error) throw error;
        const valid = (data || []).filter((b: any) => b && b.property && b.user);
        setBookings(valid);
      } catch (err: any) {
        setBookingError(err.message || 'Failed to load bookings');
      } finally {
        setBookingsLoading(false);
      }
    };

    const loadProperty = async () => {
      if (!user) return;
      const { data: property } = await supabase.from('properties').select('*').eq('owner_id', user.id).maybeSingle();
      if (property) setUserProperty(property);
    };

    load();
    loadProperty();

    setProfileData({
      full_name: user.full_name || '',
      email: user.email || '',
      phone_number: user.phone_number || '',
      stripe_account_id: (user as any).stripe_account_id || '',
      stripe_account_status: (user as any).stripe_account_status || ''
    });
    setProfileError(null);
    setProfileSuccess(null);
  }, [isOpen, user, isSaaSAdmin, isAdmin]);

  const loadBookings = async () => {
    if (!user) return;

    setBookingsLoading(true);
    setBookingError(null);

    try {
      let query = supabase
        .from('bookings')
        .select(`
          *,
          property:properties!inner(*),
          user:profiles!inner(*)
        `);

      if (isSaaSAdmin) {
        query = query.order('status', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
      } else if (isAdmin) {
        query = query.order('status', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
      } else {
        query = query.eq('user_id', user.id).order('created_at', { ascending: false });
      }

      const { data, error } = await query;
      if (error) throw error;
      const validBookings = (data || []).filter((b: any) => b && b.property && b.user);
      setBookings(validBookings);
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Failed to load bookings');
    } finally {
      setBookingsLoading(false);
    }
  };

  const handleUpdateBookingStatus = async (bookingId: string, status: 'approved' | 'denied', reason?: string) => {
    if (!user || (!isAdmin && !isSaaSAdmin)) return;

    setBookingError(null);
    setBookingsLoading(true);

    try {
      const { error } = await supabase
        .from('bookings')
        .update({
          status,
          updated_at: new Date().toISOString(),
          ...(reason ? { denial_reason: reason } : {})
        })
        .eq('id', bookingId);

      if (error) throw error;

      const booking = bookings.find(b => b.id === bookingId);
      if (booking) {
        try {
          if (status === 'approved') {
            const confirmedBookingEmailData = {
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
            await EmailNotificationService.sendBookingConfirmationEmail(confirmedBookingEmailData);
            // David (item 9): follow-up ID-on-file request after confirmation.
            EmailNotificationService.sendIdRequestEmail(confirmedBookingEmailData).catch((emailError) => {
              console.error('Failed to send ID request email:', emailError);
            });
          } else if (status === 'denied') {
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
              denialReason: reason
            });
          }
        } catch (emailError) {
          console.error('Failed to send status update email:', emailError);
        }
      }

      await loadBookings();
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Failed to update booking status');
    } finally {
      setBookingsLoading(false);
    }
  };

  const handleRefund = async (bookingId: string) => {
    if (!user || (!isAdmin && !isSaaSAdmin)) return;

    setBookingError(null);
    setBookingsLoading(true);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) throw new Error('No authentication session found');

      const response = await fetch(`${supabaseUrl}/functions/v1/process-refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ bookingId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process refund');
      }

      await loadBookings();
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Failed to process refund');
      throw err;
    } finally {
      setBookingsLoading(false);
    }
  };

  const handleProfileUpdate = async () => {
    if (!user) return;

    setLoading(true);
    setProfileError(null);
    setProfileSuccess(null);

    try {
      if (!profileData.full_name?.trim()) throw new Error('Full name is required');
      if (!profileData.email?.trim()) throw new Error('Email is required');

      const updates: any = {
        full_name: profileData.full_name.trim(),
        phone_number: profileData.phone_number?.trim() || null,
        stripe_account_id: profileData.stripe_account_id?.trim() || null,
        stripe_account_status: profileData.stripe_account_status?.trim() || null
      };

      if (profileData.email.trim() !== user.email) {
        updates.email = profileData.email.trim();
      }

      const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!currentUser) throw new Error('User session expired. Please sign in again.');

      const profileUpdates = { ...updates };
      delete profileUpdates.email;

      if (Object.keys(profileUpdates).length > 0) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ ...profileUpdates, updated_at: new Date().toISOString() })
          .eq('id', currentUser.id);
        if (profileError) throw profileError;
      }

      if (updates.email && updates.email !== currentUser.email) {
        const { error: emailError } = await supabase.auth.updateUser(
          { email: updates.email },
          { emailRedirectTo: `${window.location.origin}/auth/confirm` }
        );
        if (emailError) throw emailError;
        setProfileSuccess('Profile updated! Please check your new email for a confirmation link.');
      } else {
        setProfileSuccess('Profile updated successfully!');
      }

      // Save property address and custom_domain if changed (admin/saas_admin only)
      if (userProperty && (isAdmin || isSaaSAdmin)) {
        const propUpdates: any = {};
        if (userProperty.address !== undefined) propUpdates.address = userProperty.address;
        if (userProperty.custom_domain !== undefined) propUpdates.custom_domain = userProperty.custom_domain;
        if (Object.keys(propUpdates).length > 0) {
          propUpdates.updated_at = new Date().toISOString();
          await supabase.from('properties').update(propUpdates).eq('id', userProperty.id);
        }
      }

      // Always reinitialize auth state so user object reflects latest data
      setTimeout(() => { useAuth.getState().initialize(); }, 500);

      setIsEditingProfile(false);
    } catch (error: any) {
      if (error.message?.includes('session')) {
        setProfileError('Your session has expired. Please sign out and sign in again.');
      } else if (error.message?.includes('email')) {
        setProfileError('Email update failed. Please check the email format and try again.');
      } else {
        setProfileError(error.message || 'Failed to update profile. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleProfileInputChange = (field: keyof typeof profileData, value: string) => {
    setProfileData(prev => ({ ...prev, [field]: value }));
    setProfileError(null);
    setProfileSuccess(null);
  };

  if (!user) return null;

  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  const bookingStatusHandler = (isAdmin || isSaaSAdmin) ? handleUpdateBookingStatus : undefined;
  const refundHandler = (isAdmin || isSaaSAdmin) ? handleRefund : undefined;

  return (
    <>
      <button
        onClick={toggleMenu}
        data-user-menu-button
        className="nav-btn nav-btn-glass"
      >
        <User className="h-4 w-4" />
        <span>{user.full_name?.split(' ')[0] || 'Profile'}</span>
      </button>

      {isOpen && (
        <div data-user-menu-panel className="sidebar-panel">

          {/* ── Header ── */}
          <div className="sidebar-header">
            <h1 className="sidebar-header-label">Profile</h1>
            <div className="sidebar-header-actions">
              {!isEditingProfile ? (
                <button onClick={() => setIsEditingProfile(true)} className="sidebar-btn-edit">
                  <span>Edit</span>
                </button>
              ) : (
                <>
                  <button onClick={() => setIsEditingProfile(false)} className="sidebar-btn-cancel inline-flex-row"><span className="btn-text">Cancel</span></button>
                  <button
                    onClick={async () => { try { await handleProfileUpdate(); } catch (e) { console.error(e); } }}
                    className="sidebar-btn-save"
                    disabled={loading}
                  >
                    <span>Save</span>
                  </button>
                </>
              )}
              <button onClick={closeMenu} aria-label="Close menu" className="sidebar-btn-close">
                <X />
              </button>
            </div>
          </div>

          {/* ── Content ── */}
          <div className="sidebar-content">

            {profileError && (
              <div className="sidebar-alert sidebar-alert-error">
                <AlertCircle /><p>{profileError}</p>
              </div>
            )}
            {profileSuccess && (
              <div className="sidebar-alert sidebar-alert-success">
                <p>{profileSuccess}</p>
              </div>
            )}

            {/* ── SECTION 1: SITE ── */}
            <div className="sidebar-fields">
              <div className="sidebar-field">
                <h3 className="sidebar-label">Site</h3>
                <div className="sidebar-input-wrap">
                  <p className="sidebar-value">
                    {isSaaSAdmin ? 'Offairbnb.com'
                      : isAdmin ? 'Offairbnb.com/Newsite'
                      : 'offairbnb.pro/newsite'}
                  </p>
                </div>
              </div>
            </div>

            <hr className="sidebar-divider" />

            {/* ── SECTION 2: SUBHOST / OWN DOMAIN ── */}
            {(isSaaSAdmin || isAdmin) && (
              <>
                <div className="sidebar-fields">
                  <div className="sidebar-field">
                    <h3 className="sidebar-label">Subhost / Own Domain</h3>
                    <div className="sidebar-input-wrap">

                      {isSaaSAdmin ? (
                        <>
                          <p className="sidebar-value">Yes — Edit DNS list for sites</p>
                          {/* Dev sandbox / Live site / Push update */}
                          <div className="sb-mt-8">
                            <p className="sidebar-value-link sb-value-sm sb-mb-4">
                              <Building /><span>Dev sandbox: localhost:5174</span>
                            </p>
                            <p className="sidebar-value-link sb-value-sm sb-mb-4">
                              <Building /><span>Live site: offairbnb.com</span>
                            </p>
                            <button className="sidebar-action-btn sb-btn-blue">Push update</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="sidebar-value sb-mb-6">Yes</p>
                          {isEditingProfile ? (
                            <input
                              type="text"
                              className="sb-input-light"
                              value={userProperty?.custom_domain || ''}
                              onChange={(e) => setUserProperty((prev: any) => prev ? { ...prev, custom_domain: e.target.value } : null)}
                              placeholder="your-domain.com"
                              disabled={loading}
                            />
                          ) : (
                            <p className="sidebar-value">{userProperty?.custom_domain || 'Not set'}</p>
                          )}
                        </>
                      )}

                    </div>
                  </div>
                </div>
                <hr className="sidebar-divider" />
              </>
            )}

            {/* ── SECTION 3: PROFILE ── */}
            <div className="sidebar-fields">

              <div className="sidebar-field">
                <h3 className="sidebar-label">Full Name</h3>
                <div className="sidebar-input-wrap">
                  {isEditingProfile ? (
                    <input type="text" className="sb-input-light" value={profileData.full_name}
                      onChange={(e) => handleProfileInputChange('full_name', e.target.value)} disabled={loading} />
                  ) : (
                    <p className="sidebar-value">{user.full_name}</p>
                  )}
                </div>
              </div>

              <div className="sidebar-field">
                <h3 className="sidebar-label">Email</h3>
                <div className="sidebar-input-wrap">
                  {isEditingProfile ? (
                    <input type="email" className="sb-input-light" value={profileData.email}
                      onChange={(e) => handleProfileInputChange('email', e.target.value)} disabled={loading} />
                  ) : (
                    <p className="sidebar-value">{user.email}</p>
                  )}
                </div>
              </div>

              <div className="sidebar-field">
                <h3 className="sidebar-label">Password</h3>
                <div className="sidebar-input-wrap">
                  {isEditingProfile ? (
                    <input type="password" className="sb-input-light" placeholder="Enter new password" disabled={loading} />
                  ) : (
                    <p className="sidebar-value">••••••••</p>
                  )}
                </div>
              </div>

              <div className="sidebar-field">
                <h3 className="sidebar-label">Phone</h3>
                <div className="sidebar-input-wrap">
                  {isEditingProfile ? (
                    <input type="tel" className="sb-input-light" value={profileData.phone_number}
                      onChange={(e) => handleProfileInputChange('phone_number', e.target.value)}
                      placeholder="Enter phone number" disabled={loading} />
                  ) : (
                    <p className="sidebar-value">{user.phone_number || 'Not provided'}</p>
                  )}
                </div>
              </div>

            </div>

            <hr className="sidebar-divider" />

            {/* ── SECTION 4: PROPERTY ── */}
            <div className="sidebar-fields">
              <div className="sidebar-field">
                <h3 className="sidebar-label">Property</h3>
                <div className="sidebar-input-wrap">

                  {(isSaaSAdmin || isAdmin) ? (
                    isEditingProfile ? (
                      <>
                        <input
                          type="text"
                          className="sidebar-input sb-mb-8"
                          value={userProperty?.address || ''}
                          onChange={(e) => setUserProperty((prev: any) => prev ? { ...prev, address: e.target.value } : null)}
                          placeholder="Property address"
                          disabled={loading}
                        />
                        <button className="sidebar-action-btn sb-btn-gray">Photos</button>
                        <button className="sidebar-action-btn sb-btn-gray">Text</button>
                      </>
                    ) : (
                      <>
                        <p className="sidebar-value sb-mb-6">{userProperty?.address || 'No address set'}</p>
                        <p className="sidebar-value-link sb-value-sm sb-mb-4"><Building /><span>Photos</span></p>
                        <p className="sidebar-value-link sb-value-sm"><Building /><span>Text</span></p>
                      </>
                    )
                  ) : (
                    <p className="sidebar-value">{userProperty?.address || 'Address not available'}</p>
                  )}

                </div>
              </div>
            </div>

            <hr className="sidebar-divider" />

            {/* ── SECTION 5: PAYOUT ACCOUNT ── */}
            {(isSaaSAdmin || isAdmin) && (
              <>
                <div className="sidebar-fields">
                  <div className="sidebar-field">
                    <h3 className="sidebar-label">Payout Account</h3>
                    <div className="sidebar-input-wrap">

                      {isAdmin ? (
                        !showPayoutPanel ? (
                          <button
                            className="sidebar-action-btn sb-btn-view-payouts"
                            onClick={() => setShowPayoutPanel(true)}
                          >
                            <Building /><span>View payouts</span>
                            <ChevronDown size={14} className="sb-ml-auto" />
                          </button>
                        ) : (
                          <div>
                            <button
                              className="sidebar-action-btn sb-btn-view-payouts"
                              onClick={() => setShowPayoutPanel(false)}
                            >
                              <Building /><span>View payouts</span>
                              <ChevronUp size={14} className="sb-ml-auto" />
                            </button>
                            <div className="sb-payout-panel sb-mt-8">
                              <div className="sidebar-field">
                                <h3 className="sidebar-label">Account Details</h3>
                                {isEditingProfile ? (
                                  <input type="text" className="sb-input-light"
                                    value={profileData.stripe_account_id}
                                    onChange={(e) => handleProfileInputChange('stripe_account_id', e.target.value)}
                                    placeholder="Stripe Account ID" disabled={loading} />
                                ) : (
                                  <p className="sidebar-value">{profileData.stripe_account_id || 'Not connected'}</p>
                                )}
                              </div>
                              <div className="sidebar-field sb-mt-8">
                                <h3 className="sidebar-label">Show History</h3>
                                <p className="sidebar-value">View in Stripe dashboard</p>
                              </div>
                              <div className="sidebar-field sb-mt-8">
                                <h3 className="sidebar-label">Current Balance</h3>
                                <p className="sidebar-value">$0.00</p>
                              </div>
                              <button className="sidebar-action-btn sidebar-action-btn-green sb-mt-10">Withdraw</button>
                            </div>
                          </div>
                        )
                      ) : (
                        <>
                          <p className="sb-balance-label">Platform Balance</p>
                          <p className="sb-value-lg">$0.00</p>
                          <p className="sidebar-empty sb-mb-4">2% processing fee applies</p>
                          <button className="sidebar-action-btn sidebar-action-btn-green sb-mt-8">Withdraw</button>
                        </>
                      )}

                    </div>
                  </div>
                </div>
                <hr className="sidebar-divider" />
              </>
            )}

            {/* ── SECTION 6: GUEST PAYMENTS (SaaS admin only) ── */}
            {isSaaSAdmin && (
              <>
                <div className="sidebar-fields">
                  <div className="sidebar-field">
                    <h3 className="sidebar-label">Guest Payments</h3>
                    <div className="sidebar-input-wrap">
                      <p className="sidebar-value sb-mb-4">2% processing fee</p>
                      <p className="sb-balance-amount sb-mb-4">Balance: <strong>$0.00</strong></p>
                      <p className="sb-balance-amount sb-mb-4">Withdrawals: <strong>$0.00</strong></p>
                    </div>
                  </div>
                </div>
                <hr className="sidebar-divider" />
              </>
            )}

            {/* ── SECTION 7: SERVICES ── */}
            {(isSaaSAdmin || isAdmin) && (
              <>
                <div className="sidebar-fields">
                  <div className="sidebar-field">
                    <h3 className="sidebar-label">Services</h3>
                    <div className="sidebar-input-wrap">
                      {isSaaSAdmin ? (
                        <p className="sb-sub-text">Add tools here when developed</p>
                      ) : (
                        <>
                          <p className="sidebar-value-link sb-service-link"><Building /><span>Marketing</span></p>
                          <p className="sidebar-value-link sb-service-link"><Building /><span>Social</span></p>
                          <p className="sidebar-value-link sb-service-link"><Building /><span>Ads</span></p>
                          <p className="sidebar-value-link sb-service-link"><Building /><span>Analytics</span></p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <hr className="sidebar-divider" />
              </>
            )}

            {/* ── SECTION 9: GUEST BOOKINGS ── */}
            {isGuest && isOnPropertySite && (
              <>
                <div className="sidebar-fields">
                  <div className="sidebar-field">
                    <h3 className="sidebar-label">Guest</h3>
                    <div className="sidebar-input-wrap">
                      <button
                        onClick={() => { closeMenu(); navigate('/guest/account'); }}
                        className="sidebar-action-btn sb-btn-gray w-full text-left"
                      >
                        My Bookings
                      </button>
                    </div>
                  </div>
                </div>
                <hr className="sidebar-divider" />
              </>
            )}

            {/* ── SECTION 9: SUBSCRIPTION ── */}
            <div className="sidebar-fields">
              <div className="sidebar-field">
                <h3 className="sidebar-label">Subscription</h3>
                <div className="sidebar-input-wrap">
                  <p className="sb-sub-text">{isSaaSAdmin ? 'Payment History' : 'Billing History'}</p>
                </div>
              </div>
            </div>

            {/* ── Sign Out ── */}
            <button
              onClick={async () => { await signOut(); setIsOpen(false); }}
              className="sidebar-signout"
              disabled={loading}
            >
              <LogOut /><span>Sign Out</span>
            </button>

            {/* Mobile bottom spacing */}
            <div style={{ height: '80px' }} />

          </div>{/* /sidebar-content */}

          {/* ── SECTION 8: BOOKINGS ── */}
          <div className="sidebar-bookings">
            <div className="sidebar-bookings-inner">
              <h1 className="sidebar-section-header">
                {isSaaSAdmin ? 'All Bookings' : isAdmin ? 'Bookings' : 'My Bookings'}
              </h1>

              {bookingError && (
                <div className="sidebar-alert sidebar-alert-error">
                  <AlertCircle /><p>{bookingError}</p>
                  <button onClick={loadBookings} className="sb-btn-retry">Try again</button>
                </div>
              )}

              {bookingsLoading ? (
                <div className="sidebar-spinner-wrap">
                  <div className="sidebar-spinner" />
                  <span className="sidebar-spinner-label">Loading bookings...</span>
                </div>
              ) : !bookingError && bookings.length === 0 ? (
                <div className="sidebar-empty">No bookings found.</div>
              ) : !bookingError ? (
                <UserBookings
                  bookings={bookings}
                  onUpdateStatus={bookingStatusHandler}
                  onRefund={refundHandler}
                />
              ) : null}
            </div>
          </div>

        </div>
      )}
    </>
  );
}
