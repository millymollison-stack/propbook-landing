import { supabase } from '../lib/supabase';

// David 2026-10-19: informational "welcome, here's our info" emails sent
// right after signup -- NOT a verification gate (David: "I don't like the
// idea of having blocked users if that can be avoided"). Supabase's own
// "Confirm email" step is already off in this project, so an account is
// fully usable the instant signUp() resolves; these calls happen AFTER
// that, and a failure here never undoes or blocks the signup that already
// succeeded. Each method returns a plain boolean (did the email actually
// go out) so the calling UI can show an honest "we sent you a
// confirmation" message instead of just assuming it worked.
export class AccountEmailService {
  static async sendGuestSignupEmail(params: { email: string; fullName?: string | null; propertyId: string }): Promise<boolean> {
    try {
      const { error } = await supabase.functions.invoke('send-account-email', {
        body: { type: 'guest_signup', email: params.email, fullName: params.fullName, propertyId: params.propertyId },
      });
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Failed to send guest signup email:', err);
      return false;
    }
  }

  static async sendAdminSignupEmail(params: { email: string; fullName?: string | null }): Promise<boolean> {
    try {
      const { error } = await supabase.functions.invoke('send-account-email', {
        body: { type: 'admin_signup', email: params.email, fullName: params.fullName },
      });
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Failed to send admin signup email:', err);
      return false;
    }
  }
}
