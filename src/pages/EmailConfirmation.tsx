import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Check, X, Loader } from 'lucide-react';

export function EmailConfirmation() {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<'manual' | 'loading' | 'success' | 'error'>('manual');
  const [message, setMessage] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [showNewEmailForm, setShowNewEmailForm] = useState(false);

  console.log('=== EMAIL CONFIRMATION COMPONENT RENDERED ===');
  console.log('Location:', location.pathname, location.search, location.hash);

  useEffect(() => {
    // Check if we have auth parameters in the URL
    const urlParams = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.substring(1));
    
    const token = urlParams.get('token') || hashParams.get('access_token');
    const type = urlParams.get('type') || hashParams.get('type');
    
    console.log('URL params:', urlParams.toString());
    console.log('Hash params:', hashParams.toString());
    console.log('Token:', token, 'Type:', type);
    
    if (token && type === 'email_change') {
      verifyToken(token);
    }
  }, [location]);

  const verifyToken = async (token: string) => {
    console.log('Verifying token:', token);
    setStatus('loading');
    
    try {
      // Try different verification methods for email change
      let data, error;
      
      // First try: direct token verification
      const response1 = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'email_change'
      });
      
      if (response1.error) {
        console.log('First method failed, trying second method...');
        // Second try: using the token as-is
        const response2 = await supabase.auth.verifyOtp({
          token: token,
          type: 'email_change'
        });
        
        if (response2.error) {
          console.log('Second method failed, trying third method...');
          // Third try: manual session refresh
          const response3 = await supabase.auth.refreshSession();
          data = response3.data;
          error = response3.error;
        } else {
          data = response2.data;
          error = response2.error;
        }
      } else {
        data = response1.data;
        error = response1.error;
      }

      if (error) {
        console.error('OTP verification error:', error);
        throw error;
      }

      console.log('Email change verification successful:', data);
      setStatus('success');
      setMessage('Email change confirmed successfully! You can now use your new email address to sign in.');
      
      // Update the profile email in the database
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from('profiles')
            .update({ 
              email: user.email,
              updated_at: new Date().toISOString()
            })
            .eq('id', user.id);
        }
      } catch (profileError) {
        console.error('Failed to update profile email:', profileError);
      }
      
      setTimeout(() => {
        navigate('/');
      }, 3000);
    } catch (error: any) {
      console.error('Token verification error:', error);
      setStatus('error');
      setMessage(`Failed to confirm email: ${error.message || 'The token may be expired or invalid.'}`);
    }
  };

  const handleManualVerification = async () => {
    if (!tokenInput.trim()) {
      setMessage('Please enter a token');
      return;
    }
    
    await verifyToken(tokenInput.trim());
  };

  const handleNewEmailRequest = async () => {
    if (!newEmail.trim()) {
      setMessage('Please enter your new email address');
      return;
    }

    setStatus('loading');
    try {
      const { error } = await supabase.auth.updateUser({
        email: newEmail,
        options: {
          emailRedirectTo: 'http://localhost:5173/auth/confirm'
        }
      });

      if (error) throw error;

      setStatus('success');
      setMessage('New confirmation email sent! Please check your inbox and follow the instructions.');
    } catch (error: any) {
      setStatus('error');
      setMessage(`Failed to send new confirmation email: ${error.message}`);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-[1.65rem] text-gray-900 mb-4">Email Confirmation</h1>
          
          <div className="email-confirm-box">
            <strong>DEBUG INFO:</strong><br/>
            Status: {status}<br/>
            Current URL: {location.pathname + location.search + location.hash}<br/>
            Component is rendering properly!
          </div>
          
          {status === 'loading' && (
            <>
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100">
                <Loader className="h-6 w-6 text-blue-600 animate-spin" />
              </div>
              <h2 className="mt-6 text-xl font-bold text-gray-900">
                Confirming your email...
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                Please wait while we verify your email address.
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                <Check className="h-6 w-6 text-green-600" />
              </div>
              <h2 className="mt-6 text-xl font-bold text-gray-900">
                Email Confirmed!
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                {message}
              </p>
              <p className="mt-4 text-sm text-gray-500">
                Redirecting you in 3 seconds...
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                <X className="h-6 w-6 text-red-600" />
              </div>
              <h2 className="mt-6 text-xl font-bold text-gray-900">
                Confirmation Failed
              </h2>
              <p className="mt-2 text-sm text-red-600">
                {message}
              </p>
              <div className="mt-6">
                <button
                  onClick={() => setStatus('manual')}
                  className="text-[var(--brand)] hover:text-[var(--brand-hover)] text-sm font-medium"
                >
                  Try again
                </button>
                <span className="mx-2 text-gray-400">|</span>
                <button
                  onClick={() => setShowNewEmailForm(true)}
                  className="text-[var(--brand)] hover:text-[var(--brand-hover)] text-sm font-medium"
                >
                  Request new confirmation email
                </button>
              </div>
            </>
          )}

          {status === 'manual' && (
            <>
              <div className="bg-blue-50 p-6 rounded-lg text-left">
                <h3 className="font-medium text-blue-900 mb-4">Manual Token Entry</h3>
                <p className="text-sm text-blue-800 mb-4">
                  Copy the token from your confirmation email URL. It's the long string after "token=" in the URL.
                </p>
                <p className="text-xs text-blue-700 mb-4">
                  For example, from: <br/>
                  <code className="bg-blue-100 px-2 py-1 rounded text-xs break-all block mt-1">
                    https://...verify?token=<strong>4503d24ce6675574f536c93119b964480e6c407df5efbc698b56017b</strong>&type=...
                  </code>
                </p>
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Paste your confirmation token here"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-3"
                />
                <button
                  onClick={handleManualVerification}
                  disabled={!tokenInput.trim()}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400"
                >
                  Verify Token
                </button>
              </div>
              
              {message && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-700">{message}</p>
                </div>
              )}
            </>
          )}

          {showNewEmailForm && (
            <>
              <div className="bg-green-50 p-6 rounded-lg text-left">
                <h3 className="font-medium text-green-900 mb-4">Request New Email Confirmation</h3>
                <p className="text-sm text-green-800 mb-4">
                  Enter the new email address you want to change to, and we'll send you a fresh confirmation link.
                </p>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Enter your new email address"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-3"
                />
                <div className="flex space-x-2">
                  <button
                    onClick={handleNewEmailRequest}
                    disabled={!newEmail.trim()}
                    className="flex-1 bg-green-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-green-700 disabled:bg-gray-400"
                  >
                    Send New Confirmation
                  </button>
                  <button
                    onClick={() => setShowNewEmailForm(false)}
                    className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-md text-sm font-medium hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </>
          )}
          
          <div className="mt-6">
            <button
              onClick={() => navigate('/')}
              className="text-gray-600 hover:text-gray-900 text-sm"
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}