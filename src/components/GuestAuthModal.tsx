import React, { useState } from 'react';
import { X, Loader } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createGuestProfile } from '../services/guestService';
import { AccountEmailService } from '../services/accountEmailService';

interface GuestAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  propertyId: string;
  onSuccess?: () => void;
}

export function GuestAuthModal({ isOpen, onClose, propertyId, onSuccess }: GuestAuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [welcomeEmailSent, setWelcomeEmailSent] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signup') {
        if (!name.trim()) throw new Error('Name is required');
        if (!email.trim()) throw new Error('Email is required');
        if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: window.location.origin
          }
        });

        if (signUpError) throw signUpError;
        if (!data.user) throw new Error('Signup failed — no user returned');

        // Associate this user with the property as a guest
        await createGuestProfile(propertyId, { name: name.trim(), email: email.trim() });

        // David 2026-10-19: informational "you're in our system, here's
        // how to find us again" email -- not a verification step, and
        // never blocks signup. Awaited (not fire-and-forget) only so the
        // success screen below can honestly say whether it actually went
        // out instead of assuming it did.
        const sent = await AccountEmailService.sendGuestSignupEmail({
          email: email.trim(),
          fullName: name.trim(),
          propertyId,
        });
        setWelcomeEmailSent(sent);
      } else {
        if (!email.trim()) throw new Error('Email is required');
        if (!password) throw new Error('Password is required');

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInError) throw signInError;

        // Ensure guest profile exists for this property (in case they signed up elsewhere)
        await createGuestProfile(propertyId, { email: email.trim() });
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, mode === 'signup' ? 1800 : 1200);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sb-panel-bg rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-white text-xl font-semibold">
              {mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="text-indigo-100 text-sm mt-0.5">
              {mode === 'signup' ? 'Sign up to request a booking' : 'Sign in to view your bookings'}
            </p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <div className="p-6">
          {success ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">🎉</div>
              <p className="body-on-light font-medium">
                {mode === 'signup' ? 'Account created!' : 'Welcome back!'}
              </p>
              {mode === 'signup' && welcomeEmailSent && (
                <p className="body-on-light mt-1 text-sm">We've sent a confirmation to {email.trim()}.</p>
              )}
              <p className="body-on-light mt-1">Redirecting...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              {mode === 'signup' && (
                <div>
                  <label className="label-on-light">Full Name</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    placeholder="Jane Smith"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              )}

              <div>
                <label className="label-on-light">Email</label>
                <input
                  type="email"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  placeholder="jane@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label-on-light">Password</label>
                <input
                  type="password"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading && <Loader size={18} className="animate-spin" />}
                {mode === 'signup' ? 'Create Account' : 'Sign In'}
              </button>
            </form>
          )}

          {!success && (
            <div className="mt-5 text-center">
              <span className="body-on-light">
                {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}
              </span>
              <button
                type="button"
                onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); }}
                className="ml-2 text-indigo-600 hover:text-indigo-800 font-medium text-sm"
              >
                {mode === 'signup' ? 'Sign in' : 'Sign up'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
