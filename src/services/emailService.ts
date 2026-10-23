import { supabase } from '../lib/supabase';

interface BookingEmailData {
  booking: {
    start_date: string;
    end_date: string;
    guest_count: number;
    total_price: number;
    special_requests?: string | null;
  };
  user: {
    id: string;
    email: string;
    full_name: string | null;
    phone_number: string | null;
  };
  property: {
    id: string;
    title: string;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    location_type?: string | null;
  };
}

export class EmailNotificationService {
  private static async getAdminProfile() {
    try {
      // Public view — see David 2026-09-22 RLS lockdown, the full `profiles`
      // table is no longer publicly readable.
      const { data: adminProfile, error } = await supabase
        .from('host_contact')
        .select('*')
        .eq('role', 'admin')
        .limit(1)
        .single();

      if (error) {
        console.warn('No admin profile found, using defaults');
        return {
          email: 'davidmollison1@gmail.com',
          full_name: 'Property Manager',
          phone_number: null
        };
      }

      return adminProfile;
    } catch (error) {
      console.error('Failed to load admin profile:', error);
      return {
        email: 'davidmollison1@gmail.com',
        full_name: 'Property Manager',
        phone_number: null
      };
    }
  }

  // Call the Supabase Edge Function instead of calling Resend directly
  private static async sendEmailViaEdgeFunction(type: string, data: BookingEmailData & { adminName?: string; denialReason?: string; adminEmail?: string }) {
    const { booking, user, property, adminName, denialReason, adminEmail } = data;
    
    const payload = {
      type,
      booking,
      user,
      property,
      adminName: adminName || 'Property Manager',
      adminEmail: adminEmail || 'davidmollison1@gmail.com',
      denialReason
    };

    // Call the Supabase Edge Function
    const { data: response, error } = await supabase.functions.invoke('send-booking-email', {
      body: payload
    });

    if (error) {
      console.error('Edge function error:', error);
      throw error;
    }

    console.log('Edge function response:', response);
    return response;
  }

  // David 2026-10-20: used to also send a separate 'booking_pending' email
  // to the guest here, right at submission -- but sendBookingPaymentHeldEmail
  // (below) fires moments later once the card hold lands, and its template
  // now carries that same "Booking Request Received" content (David: "I
  // just did the test booking and got a few too many emails... Should we
  // combine them?"). So this now only notifies the admin; the guest gets a
  // single combined email at the payment-hold step instead of two.
  static async sendBookingRequestEmail(data: BookingEmailData) {
    try {
      console.log('=== EMAIL SERVICE: sendBookingRequestEmail called ===');
      
      const adminProfile = await this.getAdminProfile();
      
      // Send notification to admin
      const adminResult = await this.sendEmailViaEdgeFunction('booking_request', { 
        ...data, 
        adminName: adminProfile.full_name,
        adminEmail: adminProfile.email 
      });
      
      console.log('Admin email sent via edge function:', adminResult);
      return adminResult;
    } catch (error) {
      console.error('Email service error:', error);
      // Don't throw - don't block booking if email fails
      return null;
    }
  }

  static async sendBookingConfirmationEmail(data: BookingEmailData) {
    try {
      const result = await this.sendEmailViaEdgeFunction('booking_confirmed', data);
      return result;
    } catch (error) {
      console.error('Email service error:', error);
      return null;
    }
  }

  // David 2026-10-18: sent right after the guest's card is AUTHORIZED
  // (held, not charged) under the manual-capture auth-hold flow -- tells
  // them their host now has 24 hours to approve, and they won't be charged
  // unless/until that happens. Replaces sendBookingConfirmationEmail at
  // that moment in the flow; the real "you're confirmed" email is now
  // sendBookingApprovedEmail, sent once the host actually approves.
  static async sendBookingPaymentHeldEmail(data: BookingEmailData) {
    try {
      const result = await this.sendEmailViaEdgeFunction('booking_payment_held', data);
      return result;
    } catch (error) {
      console.error('Email service error:', error);
      return null;
    }
  }

  static async sendBookingApprovedEmail(data: BookingEmailData) {
    try {
      const result = await this.sendEmailViaEdgeFunction('booking_approved', data);
      return result;
    } catch (error) {
      console.error('Email service error:', error);
      return null;
    }
  }

  static async sendBookingDenialEmail(data: BookingEmailData & { denialReason?: string }) {
    try {
      const result = await this.sendEmailViaEdgeFunction('booking_denied', data);
      return result;
    } catch (error) {
      console.error('Email service error:', error);
      return null;
    }
  }

  // David (item 9): follow-up email after a booking is confirmed, asking
  // the guest to provide the owner with an ID to keep on file.
  static async sendIdRequestEmail(data: BookingEmailData) {
    try {
      const result = await this.sendEmailViaEdgeFunction('booking_id_request', data);
      return result;
    } catch (error) {
      console.error('Email service error:', error);
      return null;
    }
  }
}
