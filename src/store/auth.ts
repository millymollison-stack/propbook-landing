import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

interface AuthState {
  user: Profile | null;
  loading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, phoneNumber: string, isAdmin?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,
  clearError: () => set({ error: null }),

  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id);

        if (profileError) throw profileError;
        const user = profile && profile.length > 0 ? profile[0] : null;
        set({ user, loading: false });
        if (user) document.dispatchEvent(new CustomEvent('auth-state-change', { detail: { user } }));
      } else {
        set({ user: null, loading: false });
      }

      // Set up auth state listener after initial load
      supabase.auth.onAuthStateChange(async (event, session) => {
        console.log('Auth state change:', event, session);
        
        if (event === 'SIGNED_IN' && session?.user) {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id);

          if (!profileError && profile && profile.length > 0) {
            set({ user: profile[0], loading: false, error: null });
            // Tell static HTML buttons auth state changed
            document.dispatchEvent(new CustomEvent('auth-state-change', { detail: { user: profile[0] } }));
          }
        } else if (event === 'SIGNED_OUT') {
          set({ user: null, loading: false, error: null });
          document.dispatchEvent(new CustomEvent('auth-state-change', { detail: { user: null } }));
        }
      });
    } catch (error) {
      console.error('Auth initialization error:', error);
      set({ user: null, error: 'Failed to initialize auth', loading: false });
    }
  },

  signIn: async (email, password) => {
    try {
      const { data: { user }, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;

      if (user) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id);

        if (profileError) throw profileError;
        set({ user: profile && profile.length > 0 ? profile[0] : null, error: null });
      }
    } catch (error) {
      console.error('Sign in error:', error);
      set({ error: 'Failed to sign in. Please check your credentials.' });
      throw error; // re-throw so component can handle it
    }
  },

  signUp: async (email, password, fullName, phoneNumber, isAdmin = false) => {
    try {
      const { data: { user }, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: 'http://localhost:5173/auth/confirm',
          data: {
            full_name: fullName,
            phone_number: phoneNumber,
          },
        },
      });

      if (signUpError) throw signUpError;

      if (user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .insert([
            {
              id: user.id,
              email,
              full_name: fullName,
              phone_number: phoneNumber,
              role: 'user',
            },
          ]);

        if (profileError) throw profileError;
      }

      set({ error: null });
    } catch (error) {
      console.error('Sign up error:', error);
      set({ error: 'Failed to create account. Please try again.' });
      throw error;
    }
  },

  refreshUser: async () => {
    console.log('[refreshUser] starting...');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[refreshUser] session:', !!session?.user);
      if (session?.user) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*, stripe_account_id, stripe_account_status')
          .eq('id', session.user.id);
        console.log('[refreshUser] profileError:', profileError);
        console.log('[refreshUser] profile stripe_subscription_status:', profile?.[0]?.stripe_subscription_status);
        if (!profileError && profile && profile.length > 0) {
          set({ user: profile[0], loading: false, error: null });
          console.log('[refreshUser] auth state updated, user.stripe_subscription_status:', profile[0].stripe_subscription_status);
        }
      }
    } catch (error) {
      console.error('Refresh user error:', error);
    }
  },

  signOut: async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      // Always clear local state — don't let a failed server call leave the UI stuck
      set({ user: null, error: null, loading: false });
    }
  },

  updateProfile: async (updates) => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('No user logged in');

      // If email is being updated, handle it separately
      if (updates.email && updates.email !== user.email) {
        // Update auth email first
        const { error: emailError } = await supabase.auth.updateUser({
          email: updates.email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/confirm`
          }
        });
        
        if (emailError) throw emailError;
        
        // Don't update profile email yet - wait for confirmation
        const profileUpdates = { ...updates };
        delete profileUpdates.email;
        
        if (Object.keys(profileUpdates).length > 0) {
          const { error } = await supabase
            .from('profiles')
            .update({
              ...profileUpdates,
              updated_at: new Date().toISOString()
            })
            .eq('id', user.id);
          
          if (error) throw error;
        }
        
        set({ error: null });
        return { emailChangeRequested: true };
      }
      
      // Regular profile update
      const { error } = await supabase
        .from('profiles')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) throw error;

      // Fetch updated profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id);

      if (profile && profile.length > 0) {
        set({ user: profile[0], error: null });
      }
    } catch (error) {
      console.error('Update profile error:', error);
      set({ error: 'Failed to update profile' });
      throw error;
    }
  },
}));