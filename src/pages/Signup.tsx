import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';

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
      // Clear ?auth=signup from URL BEFORE calling onSuccess
      window.history.replaceState({}, '', window.location.pathname);
      if (onSuccess) onSuccess();
      else navigate('/login');
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
    <div className="auth-modal-backdrop">
      <div className="auth-modal">
        <button className="popup-close" onClick={handleClose} aria-label="Close">&times;</button>
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
      </div>
    </div>
  );
}
