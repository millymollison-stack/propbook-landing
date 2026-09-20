import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';

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

  return (
    <div className="auth-modal-backdrop">
      <div className="auth-modal">
        <button className="popup-close" onClick={handleClose} aria-label="Close">&times;</button>
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
      </div>
    </div>
  );
}
