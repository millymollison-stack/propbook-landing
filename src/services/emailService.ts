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
      
      // Also send confirmation to guest that their request is pending
      await this.sendEmailViaEdgeFunction('booking_pending', data);
      
      console.log('Emails sent via edge function:', adminResult);
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
