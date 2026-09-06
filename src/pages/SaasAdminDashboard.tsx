import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, fromUnixTime } from 'date-fns';
import {
  DollarSign, Building2, TrendingUp, AlertCircle, CheckCircle,
  XCircle, ChevronRight, ChevronLeft, RefreshCw, ExternalLink,
  CreditCard, ArrowDownToLine, Search, Filter,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';

// ── Types ───────────────────────────────────────────────────────────────────

interface AccountSummary {
  property_id: string;
  property_title: string;
  property_slug: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  business_name: string;
  email: string;
  available_balance: number;
  pending_balance: number;
  monthly_volume: number;
  platform_fees_collected: number;
  error: string | null;
}

interface Overview {
  platform_balance: { available: number; pending: number };
  platform_fees_30d: number;
  total_accounts: number;
  accounts: AccountSummary[];
  recent_platform_charges: any[];
}

interface AccountDetail {
  account: any;
  balance: { available: number; pending: number };
  charges: any[];
  payouts: any[];
}

interface DbBooking {
  id: string;
  start_date: string;
  end_date: string;
  guest_count: number;
  total_price: number;
  status: string;
  payment_status: string;
  stripe_payment_intent_id: string | null;
  amount_paid: number | null;
  created_at: string;
  property: { title: string; slug: string; stripe_account_id: string | null };
  user: { email: string; full_name: string | null };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (cents: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
      ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
    }`}>
      {ok ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ? 'text-emerald-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function Loader() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-2.5 w-2.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

type Tab = 'overview' | 'accounts' | 'bookings';

export function SaasAdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [selectedAccount, setSelectedAccount] = useState<AccountSummary | null>(null);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [bookings, setBookings] = useState<DbBooking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingFilter, setBookingFilter] = useState<'all' | 'paid' | 'unpaid' | 'refunded'>('all');

  useEffect(() => {
    if (!user || user.role !== 'saas_admin') {
      navigate('/');
    }
  }, [user, navigate]);

  const apiUrl = (action: string, extra = '') =>
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-admin?action=${action}${extra}`;

  const authHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    return {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    };
  }, []);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl('overview'), { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOverview(data);
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setOverviewLoading(false);
    }
  }, [authHeaders]);

  const loadAccountDetail = useCallback(async (account: AccountSummary) => {
    setSelectedAccount(account);
    setDetail(null);
    setDetailLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl('account_detail', `&account_id=${account.stripe_account_id}`), { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDetail(data);
    } catch (err) {
      console.error('Detail load error:', err);
    } finally {
      setDetailLoading(false);
    }
  }, [authHeaders]);

  const loadBookings = useCallback(async () => {
    setBookingsLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl('bookings'), { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBookings(data.bookings || []);
    } catch (err) {
      console.error('Bookings load error:', err);
    } finally {
      setBookingsLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (tab === 'bookings') loadBookings(); }, [tab, loadBookings]);

  const filteredBookings = bookings.filter(b => {
    const matchSearch = bookingSearch
      ? b.user.email.toLowerCase().includes(bookingSearch.toLowerCase()) ||
        (b.user.full_name || '').toLowerCase().includes(bookingSearch.toLowerCase()) ||
        b.property.title.toLowerCase().includes(bookingSearch.toLowerCase())
      : true;
    const matchFilter = bookingFilter === 'all' ? true : b.payment_status === bookingFilter;
    return matchSearch && matchFilter;
  });

  const totalPlatformFeesFormatted = overview
    ? fmt(overview.platform_fees_30d)
    : '—';

  const totalVolumeAllAccounts = overview?.accounts.reduce((s, a) => s + a.monthly_volume, 0) ?? 0;

  // ── Render ───────────────────────────────────────────────────────────────

  if (!user || user.role !== 'saas_admin') return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">PropBook Payments</p>
                <p className="text-xs text-gray-500">SaaS Admin</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={loadOverview}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
              <button
                onClick={() => navigate('/')}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Back to site
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 -mb-px">
            {(['overview', 'accounts', 'bookings'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedAccount(null); }}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                  tab === t
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <>
            {overviewLoading && <Loader />}
            {overviewError && (
              <div className="flex gap-2 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <p className="text-sm">{overviewError}</p>
              </div>
            )}
            {overview && !overviewLoading && (
              <div className="space-y-8">
                {/* Platform stats */}
                <div>
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Platform Account</h2>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Stat
                      label="Platform Balance (Available)"
                      value={fmt(overview.platform_balance.available)}
                      accent
                    />
                    <Stat
                      label="Platform Balance (Pending)"
                      value={fmt(overview.platform_balance.pending)}
                    />
                    <Stat
                      label="Platform Fees Collected (30d)"
                      value={totalPlatformFeesFormatted}
                      sub="2% of each payout"
                      accent
                    />
                    <Stat
                      label="Connected Accounts"
                      value={overview.total_accounts.toString()}
                      sub="property sites with Stripe"
                    />
                  </div>
                </div>

                {/* Per-account summary cards */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Connected Property Accounts
                    </h2>
                    <p className="text-xs text-gray-400">
                      30-day volume: <span className="font-semibold text-gray-700">{fmt(totalVolumeAllAccounts)}</span>
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {overview.accounts.map(acc => (
                      <button
                        key={acc.stripe_account_id}
                        onClick={() => { setTab('accounts'); loadAccountDetail(acc); }}
                        className="text-left bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-400 hover:shadow-sm transition-all group"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900 truncate">{acc.property_title}</p>
                            <p className="text-xs text-gray-400 font-mono truncate mt-0.5">{acc.stripe_account_id}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600 flex-shrink-0 mt-0.5" />
                        </div>

                        {acc.error ? (
                          <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{acc.error}</p>
                        ) : (
                          <>
                            <div className="flex gap-2 mb-3">
                              <StatusBadge ok={acc.charges_enabled} label={acc.charges_enabled ? 'Charges' : 'No Charges'} />
                              <StatusBadge ok={acc.payouts_enabled} label={acc.payouts_enabled ? 'Payouts' : 'No Payouts'} />
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center">
                              <div className="bg-gray-50 rounded-lg p-2">
                                <p className="text-xs text-gray-400 mb-0.5">Available</p>
                                <p className="text-sm font-bold text-gray-900">{fmt(acc.available_balance)}</p>
                              </div>
                              <div className="bg-gray-50 rounded-lg p-2">
                                <p className="text-xs text-gray-400 mb-0.5">Pending</p>
                                <p className="text-sm font-bold text-gray-900">{fmt(acc.pending_balance)}</p>
                              </div>
                              <div className="bg-emerald-50 rounded-lg p-2">
                                <p className="text-xs text-gray-400 mb-0.5">30d Vol.</p>
                                <p className="text-sm font-bold text-emerald-700">{fmt(acc.monthly_volume)}</p>
                              </div>
                            </div>
                            <div className="mt-3 flex justify-between text-xs text-gray-500">
                              <span>Platform fees (30d)</span>
                              <span className="font-semibold text-gray-700">{fmt(acc.platform_fees_collected)}</span>
                            </div>
                          </>
                        )}
                      </button>
                    ))}

                    {overview.accounts.length === 0 && (
                      <div className="col-span-3 bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-400">
                        <Building2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
                        <p className="text-sm">No connected Stripe accounts yet.</p>
                        <p className="text-xs mt-1">Accounts appear here once a property owner links their bank account.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent platform-level charges */}
                {overview.recent_platform_charges.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Recent Platform Charges</h2>
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">ID</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Amount</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {overview.recent_platform_charges.map(c => (
                            <tr key={c.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.id.slice(0, 16)}…</td>
                              <td className="px-4 py-3 font-semibold">{fmt(c.amount, c.currency)}</td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  c.status === 'succeeded' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                                }`}>{c.status}</span>
                              </td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{format(fromUnixTime(c.created), 'MMM d, yyyy')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── ACCOUNTS TAB ─────────────────────────────────────────────────── */}
        {tab === 'accounts' && (
          <div className="space-y-6">
            {/* Account list sidebar + detail panel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: account list */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Select Account</p>
                {overviewLoading && <Loader />}
                {overview?.accounts.map(acc => (
                  <button
                    key={acc.stripe_account_id}
                    onClick={() => loadAccountDetail(acc)}
                    className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                      selectedAccount?.stripe_account_id === acc.stripe_account_id
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 bg-white hover:border-gray-400'
                    }`}
                  >
                    <p className="text-sm font-bold truncate">{acc.property_title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs ${selectedAccount?.stripe_account_id === acc.stripe_account_id ? 'text-gray-300' : 'text-gray-400'}`}>
                        {fmt(acc.available_balance)} available
                      </span>
                      {!acc.charges_enabled && (
                        <span className="text-xs text-red-400 font-semibold">Setup needed</span>
                      )}
                    </div>
                  </button>
                ))}
                {!overviewLoading && overview?.accounts.length === 0 && (
                  <p className="text-sm text-gray-400 py-4 text-center">No accounts yet</p>
                )}
              </div>

              {/* Right: detail panel */}
              <div className="lg:col-span-2">
                {!selectedAccount && (
                  <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-gray-400">
                    <CreditCard className="h-8 w-8 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">Select an account to view its transaction history</p>
                  </div>
                )}

                {selectedAccount && detailLoading && <Loader />}

                {selectedAccount && detail && !detailLoading && (
                  <div className="space-y-5">
                    {/* Account header */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="text-base font-bold text-gray-900">{detail.account.business_name}</p>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{detail.account.id}</p>
                        </div>
                        <div className="flex flex-col gap-1 items-end">
                          <StatusBadge ok={detail.account.charges_enabled} label={detail.account.charges_enabled ? 'Charges On' : 'No Charges'} />
                          <StatusBadge ok={detail.account.payouts_enabled} label={detail.account.payouts_enabled ? 'Payouts On' : 'Payouts Pending'} />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-0.5">Available</p>
                          <p className="text-base font-bold text-gray-900">{fmt(detail.balance.available)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-0.5">Pending</p>
                          <p className="text-base font-bold text-gray-900">{fmt(detail.balance.pending)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-0.5">Charges</p>
                          <p className="text-base font-bold text-gray-900">{detail.charges.length}</p>
                        </div>
                      </div>
                    </div>

                    {/* Charges */}
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-gray-500" />
                        <p className="text-sm font-semibold text-gray-900">Charges</p>
                        <span className="text-xs text-gray-400 ml-auto">{detail.charges.length} transactions</span>
                      </div>
                      {detail.charges.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">No charges yet</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Date</th>
                                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Amount</th>
                                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Platform Fee</th>
                                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Status</th>
                                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Guest</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {detail.charges.map((c: any) => (
                                <tr key={c.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-xs text-gray-500">
                                    {format(fromUnixTime(c.created), 'MMM d, yyyy')}
                                  </td>
                                  <td className="px-4 py-3 font-semibold">{fmt(c.amount_captured || c.amount, c.currency)}</td>
                                  <td className="px-4 py-3 text-xs text-emerald-600 font-semibold">
                                    {c.application_fee_amount ? fmt(c.application_fee_amount, c.currency) : '—'}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                      c.status === 'succeeded' ? 'bg-emerald-100 text-emerald-700'
                                      : c.refunded ? 'bg-orange-100 text-orange-700'
                                      : 'bg-gray-100 text-gray-600'
                                    }`}>
                                      {c.refunded ? 'refunded' : c.status}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[120px]">
                                    {c.receipt_email || c.metadata?.userId || '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Payouts */}
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                        <ArrowDownToLine className="h-4 w-4 text-gray-500" />
                        <p className="text-sm font-semibold text-gray-900">Payouts to Bank</p>
                        <span className="text-xs text-gray-400 ml-auto">{detail.payouts.length} payouts</span>
                      </div>
                      {detail.payouts.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">No payouts yet</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Created</th>
                                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Amount</th>
                                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Status</th>
                                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Est. Arrival</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {detail.payouts.map((p: any) => (
                                <tr key={p.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-xs text-gray-500">
                                    {format(fromUnixTime(p.created), 'MMM d, yyyy')}
                                  </td>
                                  <td className="px-4 py-3 font-semibold">{fmt(p.amount, p.currency)}</td>
                                  <td className="px-4 py-3">
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                      p.status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                                      : p.status === 'pending' ? 'bg-yellow-100 text-yellow-700'
                                      : p.status === 'in_transit' ? 'bg-blue-100 text-blue-700'
                                      : 'bg-gray-100 text-gray-600'
                                    }`}>{p.status}</span>
                                  </td>
                                  <td className="px-4 py-3 text-xs text-gray-500">
                                    {p.arrival_date ? format(fromUnixTime(p.arrival_date), 'MMM d, yyyy') : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── BOOKINGS TAB ─────────────────────────────────────────────────── */}
        {tab === 'bookings' && (
          <div className="space-y-5">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={bookingSearch}
                  onChange={e => setBookingSearch(e.target.value)}
                  placeholder="Search by guest, email or property..."
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-400" />
                {(['all', 'paid', 'unpaid', 'refunded'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setBookingFilter(f)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors capitalize ${
                      bookingFilter === f
                        ? 'bg-gray-900 text-white'
                        : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {bookingsLoading && <Loader />}

            {!bookingsLoading && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">All Bookings</p>
                  <p className="text-xs text-gray-400">{filteredBookings.length} results</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Guest</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Property</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Dates</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Total</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Booking</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Payment</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Platform Fee</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Stripe PI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredBookings.map(b => {
                        const platformFee = b.amount_paid ? Math.round(b.amount_paid * 0.02) : 0;
                        return (
                          <tr key={b.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-900 text-xs">{b.user.full_name || '—'}</p>
                              <p className="text-xs text-gray-400">{b.user.email}</p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-xs font-medium text-gray-900">{b.property.title}</p>
                              <p className="text-xs text-gray-400 font-mono">{b.property.stripe_account_id?.slice(0, 12) || 'No Connect'}</p>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">
                              {format(new Date(b.start_date), 'MMM d')} – {format(new Date(b.end_date), 'MMM d, yyyy')}
                            </td>
                            <td className="px-4 py-3 font-semibold text-sm">
                              ${b.total_price.toFixed(2)}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                b.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                                : b.status === 'pending' ? 'bg-yellow-100 text-yellow-700'
                                : b.status === 'denied' ? 'bg-red-100 text-red-600'
                                : 'bg-gray-100 text-gray-600'
                              }`}>{b.status}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                b.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                                : b.payment_status === 'pending' ? 'bg-blue-100 text-blue-700'
                                : b.payment_status === 'refunded' ? 'bg-orange-100 text-orange-700'
                                : b.payment_status === 'failed' ? 'bg-red-100 text-red-600'
                                : 'bg-gray-100 text-gray-600'
                              }`}>{b.payment_status}</span>
                            </td>
                            <td className="px-4 py-3 text-xs text-emerald-600 font-semibold">
                              {platformFee > 0 ? fmt(platformFee) : '—'}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-400">
                              {b.stripe_payment_intent_id
                                ? `${b.stripe_payment_intent_id.slice(0, 14)}…`
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredBookings.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                            No bookings match your filters
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
