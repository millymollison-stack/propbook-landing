import { useState, useEffect, useCallback } from 'react';
import { CreditCard, CheckCircle, XCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ConnectAccount {
  account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  business_name: string;
  email: string;
  available_balance: number;
  pending_balance: number;
  currency: string;
}

interface StripeConnectSetupProps {
  /** Visual style: 'sidebar' (compact, dark labels) or 'onboarding' (larger, card-style) */
  variant?: 'sidebar' | 'onboarding';
  /** Called after the user is redirected back from Stripe onboarding */
  onAccountLinked?: (accountId: string) => void;
}

async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session;
}

function fmt(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
      ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
    }`}>
      {ok
        ? <CheckCircle className="h-3 w-3" />
        : <XCircle className="h-3 w-3" />
      }
      {label}
    </span>
  );
}

export function StripeConnectSetup({ variant = 'sidebar', onAccountLinked }: StripeConnectSetupProps) {
  const [account, setAccount] = useState<ConnectAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutSuccess, setPayoutSuccess] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-connect`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAccount(data.account_id ? data : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load account');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleOnboard = async () => {
    setOnboarding(true);
    setError(null);
    try {
      const session = await getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-connect`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'create_account_link', return_url: window.location.href }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (onAccountLinked) onAccountLinked(data.url);
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start setup');
      setOnboarding(false);
    }
  };

  const handlePayout = async () => {
    if (!account || account.available_balance <= 0) return;
    setPayoutLoading(true);
    setError(null);
    try {
      const session = await getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-connect`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'payout' }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPayoutSuccess(true);
      setTimeout(() => { setPayoutSuccess(false); load(); }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payout failed');
    } finally {
      setPayoutLoading(false);
    }
  };

  const handleDashboard = async () => {
    setDashboardLoading(true);
    setError(null);
    try {
      const session = await getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-connect`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'get_dashboard_link' }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.open(data.url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open dashboard');
    } finally {
      setDashboardLoading(false);
    }
  };

  const platformFee = account ? Math.round(account.available_balance * 0.02) : 0;
  const payoutAmount = account ? account.available_balance - platformFee : 0;

  if (loading) {
    return variant === 'onboarding' ? (
      <div className="flex justify-center py-6">
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    ) : (
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    );
  }

  // ── No account yet ───────────────────────────────────────────────────────────
  if (!account) {
    if (variant === 'onboarding') {
      return (
        <div className="space-y-4">
          <p className="text-sm text-gray-300 leading-relaxed">
            Connect a bank account via Stripe to receive booking payouts directly. We take a <strong className="text-white">2% platform fee</strong> on each payout — all other revenue is yours.
          </p>
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-2 text-sm">
            <p className="font-semibold text-gray-200">Your payout account is property-scoped</p>
            <p className="text-gray-400 text-xs leading-relaxed">
              Each property site gets its own Stripe Express account, giving you a clean transaction history per property at year-end.
            </p>
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-xs text-gray-400">
            Use test routing number <span className="font-mono font-bold text-gray-200">110000000</span> and account number <span className="font-mono font-bold text-gray-200">000123456789</span> during setup to test without real bank details.
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            onClick={handleOnboard}
            disabled={onboarding}
            className="w-full flex items-center justify-center gap-2 bg-[var(--brand)] hover:opacity-90 text-white text-sm font-semibold rounded-lg py-3 transition-opacity disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" />
            {onboarding ? 'Redirecting to Stripe...' : 'Link Bank Account via Stripe'}
          </button>
          <p className="text-xs text-gray-500 text-center">You'll be taken to Stripe to complete setup securely.</p>
        </div>
      );
    }

    // sidebar variant
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Connect a bank account to receive payouts when guests book your property. We take a <strong>2% platform fee</strong> on each payout.
        </p>
        <div className="bg-blue-50 rounded-lg p-3 text-xs text-gray-500">
          Each property has its own Stripe account for separate year-end transaction history.
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs font-semibold text-gray-600 mb-1">Test mode</p>
          <p className="text-xs text-gray-500">
            Use routing <span className="font-mono font-bold">110000000</span> and account <span className="font-mono font-bold">000123456789</span> to test without real bank details.
          </p>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={handleOnboard}
          disabled={onboarding}
          className="w-full bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg py-2.5 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <CreditCard className="h-4 w-4" />
          {onboarding ? 'Redirecting to Stripe...' : 'Link Bank Account'}
        </button>
      </div>
    );
  }

  // ── Account exists ───────────────────────────────────────────────────────────
  const isFullySetup = account.charges_enabled && account.payouts_enabled && account.details_submitted;

  if (variant === 'onboarding') {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-white">{account.business_name || account.email}</p>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{account.account_id}</p>
          </div>
          <div className="flex flex-col gap-1.5 items-end">
            <StatusPill ok={account.charges_enabled} label={account.charges_enabled ? 'Charges On' : 'Setup Needed'} />
            <StatusPill ok={account.payouts_enabled} label={account.payouts_enabled ? 'Payouts On' : 'Payouts Pending'} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-0.5">Available</p>
            <p className="text-base font-bold text-white">{fmt(account.available_balance)}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-0.5">Pending</p>
            <p className="text-base font-bold text-white">{fmt(account.pending_balance)}</p>
          </div>
        </div>

        {!isFullySetup && (
          <button
            onClick={handleOnboard}
            disabled={onboarding}
            className="w-full border border-gray-600 hover:bg-gray-800 text-gray-300 text-sm font-semibold rounded-lg py-2.5 transition-colors disabled:opacity-50"
          >
            {onboarding ? 'Redirecting...' : 'Complete Account Setup'}
          </button>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleDashboard}
            disabled={dashboardLoading}
            className="flex-1 flex items-center justify-center gap-1.5 border border-gray-600 hover:bg-gray-800 text-gray-300 text-xs font-semibold rounded-lg py-2 transition-colors disabled:opacity-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {dashboardLoading ? 'Opening...' : 'Stripe Dashboard'}
          </button>
          <button
            onClick={load}
            className="p-2 border border-gray-600 hover:bg-gray-800 text-gray-400 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  // sidebar variant — account exists
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-bold text-gray-900">{account.business_name || account.email}</p>
          <p className="text-xs text-gray-400 mt-0.5 font-mono truncate max-w-[160px]">{account.account_id}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill ok={account.charges_enabled} label={account.charges_enabled ? 'Charges On' : 'Setup Required'} />
          <StatusPill ok={account.payouts_enabled} label={account.payouts_enabled ? 'Payouts On' : 'Payouts Pending'} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-50 rounded-lg p-2.5">
          <p className="text-xs text-gray-500 mb-0.5">Available</p>
          <p className="text-base font-bold text-gray-900">{fmt(account.available_balance)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5">
          <p className="text-xs text-gray-500 mb-0.5">Pending</p>
          <p className="text-base font-bold text-gray-900">{fmt(account.pending_balance)}</p>
        </div>
      </div>

      {account.available_balance > 0 && account.payouts_enabled && (
        <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Available balance</span>
            <span className="font-semibold text-gray-900">{fmt(account.available_balance)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Platform fee (2%)</span>
            <span className="text-gray-500">− {fmt(platformFee)}</span>
          </div>
          <div className="border-t border-gray-100 pt-2 flex justify-between text-sm">
            <span className="font-bold text-gray-900">You receive</span>
            <span className="font-bold text-green-700">{fmt(payoutAmount)}</span>
          </div>
          {payoutSuccess ? (
            <div className="flex items-center justify-center gap-2 bg-green-50 rounded-lg py-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm font-semibold text-green-700">Payout initiated!</span>
            </div>
          ) : (
            <button
              onClick={handlePayout}
              disabled={payoutLoading}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg py-2 transition-colors disabled:opacity-50"
            >
              {payoutLoading ? 'Processing...' : 'Request Payout'}
            </button>
          )}
        </div>
      )}

      {!isFullySetup && (
        <button
          onClick={handleOnboard}
          disabled={onboarding}
          className="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-lg py-2 transition-colors disabled:opacity-50"
        >
          {onboarding ? 'Redirecting...' : 'Complete Account Setup'}
        </button>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleDashboard}
          disabled={dashboardLoading}
          className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg py-1.5 transition-colors disabled:opacity-50"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {dashboardLoading ? 'Opening...' : 'Stripe Dashboard'}
        </button>
        <button
          onClick={load}
          className="p-1.5 border border-gray-200 hover:bg-gray-50 text-gray-400 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
