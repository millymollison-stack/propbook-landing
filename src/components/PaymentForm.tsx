import React, { useState, useEffect, useRef } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { CreditCard, Loader, AlertCircle, Check, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { stripePromise } from '../lib/stripe';
import { supabase } from '../lib/supabase';

interface PaymentFormProps {
  bookingId: string;
  amount: number;
  propertyTitle: string;
  dates: string;
  onPaymentSuccess: () => void;
  onPaymentError: (error: string) => void;
}

// ─── Diagnostic log types ─────────────────────────────────────────────────────
type LogLevel = 'info' | 'ok' | 'warn' | 'error';
interface LogEntry { time: string; level: LogLevel; msg: string; }

function ts() { return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }); }

// ─── DiagPanel ────────────────────────────────────────────────────────────────
function DiagPanel({ logs }: { logs: LogEntry[] }) {
  const [open, setOpen] = useState(true);
  const colors: Record<LogLevel, string> = {
    info: 'text-blue-600',
    ok: 'text-green-600',
    warn: 'text-yellow-600',
    error: 'text-red-600',
  };
  return (
    <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden text-xs font-mono">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-gray-600 hover:bg-gray-100"
      >
        <span className="font-semibold">Stripe Diagnostics ({logs.length} events)</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="max-h-56 overflow-y-auto p-3 space-y-1 bg-white">
          {logs.length === 0 && <p className="text-gray-400">No events yet…</p>}
          {logs.map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-gray-400 shrink-0">{l.time}</span>
              <span className={`${colors[l.level]} break-all`}>[{l.level.toUpperCase()}] {l.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CheckoutForm ─────────────────────────────────────────────────────────────
function CheckoutForm({
  amount,
  logs,
  addLog,
  onPaymentSuccess,
  onPaymentError,
}: {
  amount: number;
  logs: LogEntry[];
  addLog: (level: LogLevel, msg: string) => void;
  onPaymentSuccess: () => void;
  onPaymentError: (error: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [ready, setReady] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    addLog('info', `stripe hook: ${stripe ? 'loaded' : 'null'}`);
    addLog('info', `elements hook: ${elements ? 'loaded' : 'null'}`);
  }, [stripe, elements]);

  // Check for Stripe iframe after a short delay
  useEffect(() => {
    if (!stripe || !elements) return;
    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (!container) { addLog('error', 'PaymentElement container ref is null'); return; }
      const iframes = container.querySelectorAll('iframe');
      addLog('info', `DOM check: ${iframes.length} iframe(s) inside PaymentElement container`);
      if (iframes.length === 0) {
        addLog('error', 'No Stripe iframe found — domain likely not authorized in Stripe dashboard, or a browser extension is blocking iframes');
        addLog('warn', `Current origin: ${window.location.origin}`);
        addLog('warn', 'Fix: Go to Stripe Dashboard → Settings → Business → Domain, add this origin. OR switch to a test key (pk_test_…) for development.');
      } else {
        iframes.forEach((f, i) => addLog('info', `iframe[${i}] src: ${f.src.slice(0, 80)}`));
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [stripe, elements]);

  if (succeeded) {
    return (
      <div className="flex items-center gap-3 text-green-600 p-4 bg-green-50 rounded-lg">
        <Check className="h-8 w-8 flex-shrink-0" />
        <div>
          <p className="font-semibold text-base">Payment Successful!</p>
          <p className="text-sm text-gray-600 mt-0.5">Your booking has been confirmed.</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    addLog('info', 'Pay button clicked');

    if (!stripe) { addLog('error', 'stripe is null — cannot confirm payment'); return; }
    if (!elements) { addLog('error', 'elements is null — cannot confirm payment'); return; }

    setProcessing(true);
    setError(null);

    addLog('info', 'Calling stripe.confirmPayment…');

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: window.location.href },
    });

    if (confirmError) {
      const msg = confirmError.message || 'Payment failed. Please try again.';
      addLog('error', `confirmPayment error: ${confirmError.type} — ${msg}`);
      setError(msg);
      onPaymentError(msg);
      setProcessing(false);
      return;
    }

    addLog('ok', `paymentIntent status: ${paymentIntent?.status}`);

    if (paymentIntent?.status === 'succeeded') {
      setSucceeded(true);
      onPaymentSuccess();
    } else {
      const msg = `Payment status: ${paymentIntent?.status || 'unknown'}. Please try again.`;
      addLog('warn', msg);
      setError(msg);
      onPaymentError(msg);
    }
    setProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="relative">
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-white rounded-lg z-10 border border-gray-200 min-h-[180px]">
            <div className="flex flex-col items-center gap-2 text-gray-400">
              <Loader className="h-5 w-5 animate-spin" />
              <span className="text-xs">Loading card fields…</span>
            </div>
          </div>
        )}
        <div ref={containerRef} className="p-4 border border-gray-200 rounded-lg bg-white min-h-[180px]">
          <PaymentElement
            onReady={() => { setReady(true); addLog('ok', 'PaymentElement onReady fired — card fields visible'); }}
            onChange={(e) => addLog('info', `PaymentElement onChange: complete=${e.complete}, empty=${e.empty}`)}
            onLoadError={(e) => addLog('error', `PaymentElement onLoadError: ${JSON.stringify(e)}`)}
            options={{
              layout: 'tabs',
              defaultValues: { billingDetails: { address: { country: 'US' } } },
            }}
          />
        </div>
      </div>

      {error && (
        <div className="flex gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || processing || !ready}
        className="w-full flex justify-center items-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-[var(--brand)] hover:bg-[var(--brand-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {processing ? (
          <><Loader className="h-4 w-4 animate-spin" />Processing…</>
        ) : (
          <><CreditCard className="h-4 w-4" />Pay ${amount.toFixed(2)}</>
        )}
      </button>

      <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
        <ShieldCheck className="h-3.5 w-3.5" />
        Secured by Stripe · Card, Apple Pay, Google Pay
      </div>

      <DiagPanel logs={logs} />
    </form>
  );
}

// ─── PaymentForm (outer) ──────────────────────────────────────────────────────
export function PaymentForm({
  bookingId,
  amount,
  propertyTitle,
  dates,
  onPaymentSuccess,
  onPaymentError,
}: PaymentFormProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const fetchedRef = useRef(false);

  const addLog = (level: LogLevel, msg: string) =>
    setLogs(prev => [...prev, { time: ts(), level, msg }]);

  useEffect(() => {
    // Guard: only ever fetch once per mount
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;

    async function init() {
      addLog('info', `PaymentForm mounted — bookingId=${bookingId} amount=${amount}`);

      // 1. Check Stripe publishable key
      const pubKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
      if (!pubKey) {
        addLog('error', 'VITE_STRIPE_PUBLISHABLE_KEY is missing from .env');
      } else {
        addLog('ok', `Publishable key present: ${pubKey.slice(0, 12)}…`);
      }

      // 2. Check stripePromise resolved
      try {
        const stripeInstance = await stripePromise;
        if (stripeInstance) {
          addLog('ok', 'stripePromise resolved successfully');
        } else {
          addLog('error', 'stripePromise resolved to null — invalid publishable key?');
        }
      } catch (e: any) {
        addLog('error', `stripePromise rejected: ${e?.message}`);
      }

      // 3. Check auth session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        addLog('error', `getSession error: ${sessionError.message}`);
      } else if (!session) {
        addLog('error', 'No active session — user is not signed in');
        if (!cancelled) { setError('Please sign in to complete payment.'); setLoading(false); }
        return;
      } else {
        addLog('ok', `Session found — user ${session.user.email}`);
      }

      // 4. Call create-payment-intent
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-payment-intent`;
      addLog('info', `POST ${url}`);
      addLog('info', `Body: bookingId=${bookingId} amount=${amount}`);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session!.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ bookingId, amount, propertyTitle, dates }),
        });

        const text = await res.text();
        addLog('info', `Response status: ${res.status}`);
        addLog('info', `Response body: ${text.slice(0, 300)}`);

        let json: any;
        try { json = JSON.parse(text); } catch { json = null; }

        if (!res.ok) {
          const msg = json?.error || `HTTP ${res.status}`;
          addLog('error', `Edge function error: ${msg}`);
          if (!cancelled) { setError(msg); onPaymentError(msg); setLoading(false); }
          return;
        }

        if (!json?.clientSecret) {
          addLog('error', `No clientSecret in response. Keys: ${Object.keys(json || {}).join(', ')}`);
          if (!cancelled) { setError('No client secret returned from server.'); setLoading(false); }
          return;
        }

        addLog('ok', `clientSecret received: ${json.clientSecret.slice(0, 20)}…`);
        if (!cancelled) setClientSecret(json.clientSecret);
      } catch (fetchErr: any) {
        addLog('error', `Fetch failed: ${fetchErr?.message}`);
        if (!cancelled) { setError(fetchErr?.message || 'Network error'); onPaymentError(fetchErr?.message); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [bookingId]);

  return (
    <div className="bg-white rounded-lg space-y-5">
      {/* Booking summary */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Complete Payment</h3>
        <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-500">Property</span>
            <span className="font-medium text-gray-900 text-right max-w-[60%]">{propertyTitle}</span>
          </div>
          {dates && (
            <div className="flex justify-between">
              <span className="text-gray-500">Dates</span>
              <span className="font-medium text-gray-900 text-right">{dates}</span>
            </div>
          )}
          <div className="flex justify-between pt-2 border-t border-gray-200">
            <span className="font-semibold text-gray-900">Total</span>
            <span className="font-bold text-[var(--brand)] text-base">${amount.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-gray-400">
          <Loader className="h-6 w-6 animate-spin" />
          <p className="text-sm">Preparing payment…</p>
          <DiagPanel logs={logs} />
        </div>
      )}

      {error && !loading && (
        <div className="space-y-3">
          <div className="flex gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
          <DiagPanel logs={logs} />
        </div>
      )}

      {clientSecret && !loading && (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: 'stripe',
              variables: {
                colorPrimary: '#C47756',
                borderRadius: '8px',
                fontFamily: 'inherit',
              },
            },
          }}
        >
          <CheckoutForm
            amount={amount}
            logs={logs}
            addLog={addLog}
            onPaymentSuccess={onPaymentSuccess}
            onPaymentError={onPaymentError}
          />
        </Elements>
      )}
    </div>
  );
}
