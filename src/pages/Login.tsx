import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuth, getAuthRedirectUrl } from '../store/auth';
import { supabase } from '../lib/supabase';

// Renders the login form as a modal overlay (no dark page behind it)
interface LoginProps {
  onSuccess?: () => void;
  onClose?: () => void;
  onSwitchToSignup?: () => void;
}

export function Login({ onSuccess, onClose, onSwitchToSignup }: LoginProps = {}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [view, setView] = useState<'login' | 'forgot' | 'sent'>('login');
  const [resetLoading, setResetLoading] = useState(false);
  const { signIn, clearError } = useAuth();
  const navigate = useNavigate();

  // Clear any stale global auth error when this modal opens
  useEffect(() => { clearError(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      // Clear ?auth=login from URL BEFORE calling onSuccess
      // so that any reload goes to the correct page, not root /
      window.history.replaceState({}, '', window.location.pathname);
      if (onSuccess) onSuccess();
      else navigate('/');
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credentials')) {
        setLocalError('Invalid email or password. Please try again.');
      } else if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('no user')) {
        setLocalError('No account found with this email. Please sign up first.');
      } else {
        setLocalError('Failed to sign in. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (onClose) onClose();
    else navigate('/');
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim()) {
      setLocalError('Enter your email address first.');
      return;
    }
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getAuthRedirectUrl(),
      });
      if (error) throw error;
      setView('sent');
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to send reset email. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  if (view === 'forgot' || view === 'sent') {
    return (
      <div className="auth-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
        <div className="auth-modal">
          <button className="popup-close" onClick={handleClose} aria-label="Close"><X className="h-5 w-5" /></button>
          {view === 'sent' ? (
            <>
              <h1>Check your email</h1>
              <p>We've sent a password reset link to <strong>{email}</strong>. Follow it to choose a new password.</p>
              <p><button type="button" className="popup-link" onClick={() => setView('login')}>Back to sign in</button></p>
            </>
          ) : (
            <>
              <h1>Reset your password</h1>
              <p>Enter your email and we'll send you a link to set a new password.</p>
              <form onSubmit={handleForgotPassword}>
                {localError && <p className="popup-error">{localError}</p>}
                <input id="reset-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" autoComplete="email" className="field-dark" />
                <button type="submit" disabled={resetLoading} className="btn">
                  {resetLoading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>
              <p><button type="button" className="popup-link" onClick={() => { setView('login'); setLocalError(null); }}>Back to sign in</button></p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="auth-modal">
        <button className="popup-close" onClick={handleClose} aria-label="Close"><X className="h-5 w-5" /></button>
        <h1>Sign in to your account</h1>
        <p>Or create a <button type="button" className="popup-link" onClick={onSwitchToSignup}>new account</button></p>
        <form onSubmit={handleSubmit}>
          {localError && <p className="popup-error">{localError}</p>}
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" autoComplete="email" className="field-dark" />
          <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" className="field-dark" />
          <button type="submit" disabled={loading} className="btn">
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p><button type="button" className="popup-link" onClick={() => { setView('forgot'); setLocalError(null); }}>Forgot password?</button></p>
      </div>
    </div>
  );
}
