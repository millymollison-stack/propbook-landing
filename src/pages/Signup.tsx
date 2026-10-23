import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuth } from '../store/auth';
import { AccountEmailService } from '../services/accountEmailService';

interface SignupProps {
  onSuccess?: () => void;
  onClose?: () => void;
  onSwitchToLogin?: () => void;
}

export function Signup({ onSuccess, onClose, onSwitchToLogin }: SignupProps = {}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [welcomeEmailSent, setWelcomeEmailSent] = useState(false);
  const { signUp, clearError } = useAuth();
  const navigate = useNavigate();

  // Clear any stale global auth error when this modal opens
  useEffect(() => { clearError(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLoading(true);
    try {
      await signUp(email, password, fullName, phoneNumber, false);

      // David 2026-10-19: informational "welcome, here's our info" email --
      // not a verification step, never blocks the account that was just
      // created. Awaited only so the brief success screen below can
      // honestly say whether it actually went out.
      //
      // This same Signup modal is shared by two very different contexts --
      // CustomerSite.tsx opens it for a GUEST signing up to book a specific
      // property, while Home.tsx/App.tsx's top-level signup opens it for an
      // ADMIN creating their own propbook.pro account. There's no prop that
      // tells us which; window.__PROPERTY_DATA__ is the same global
      // App.tsx/Home.tsx/CustomerSite.tsx already use to tell property
      // sites apart from the main site, so it's used here too.
      const propertyData = (window as any).__PROPERTY_DATA__;
      const sent = propertyData?.id
        ? await AccountEmailService.sendGuestSignupEmail({ email, fullName, propertyId: propertyData.id })
        : await AccountEmailService.sendAdminSignupEmail({ email, fullName });
      setWelcomeEmailSent(sent);

      // Clear ?auth=signup from URL BEFORE calling onSuccess
      window.history.replaceState({}, '', window.location.pathname);

      setSuccess(true);
      setTimeout(() => {
        if (onSuccess) onSuccess();
        else navigate('/login');
      }, 1800);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists')) {
        setLocalError('An account with this email already exists. Please sign in instead.');
      } else if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('email')) {
        setLocalError('Please enter a valid email address.');
      } else {
        setLocalError('Failed to create account. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (onClose) onClose();
    else navigate('/');
  };

  return (
    <div className="auth-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="auth-modal">
        <button className="popup-close" onClick={handleClose} aria-label="Close"><X className="h-5 w-5" /></button>
        {success ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">🎉</div>
            <p className="body-on-light font-medium">Account created!</p>
            {welcomeEmailSent && (
              <p className="body-on-light mt-1 text-sm">We've sent a confirmation to {email}.</p>
            )}
            <p className="body-on-light mt-1">Redirecting...</p>
          </div>
        ) : (
          <>
            <h1>Create your account</h1>
            <p>Already have an account? <button type="button" className="popup-link" onClick={onSwitchToLogin}>Sign in</button></p>
            <form onSubmit={handleSubmit}>
              {localError && <p className="popup-error">{localError}</p>}
              <input id="fullName" type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" className="field-dark" />
              <input id="phoneNumber" type="tel" required value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Phone number" className="field-dark" />
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className="field-dark" />
              <input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="field-dark" />
              <button type="submit" disabled={loading} className="btn">
                {loading ? 'Creating account...' : 'Create account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
