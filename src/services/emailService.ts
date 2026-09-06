import { supabase } from '../lib/supabase';

interface BookingEmailData {
  booking: {
    start_date: string;
    end_date: string;
    guest_count: number;
    total_price: number;
    special_requests?: string;
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
      const { data: adminProfile, error } = await supabase
        .from('profiles')
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

  private static getEmailContent(type: string, data: BookingEmailData & { adminName?: string; denialReason?: string }) {
    const { booking, user, property, adminName, denialReason } = data;
    const guestName = user.full_name || 'Guest';
    
    if (type === 'booking_request') {
      return {
        subject: `New Booking Request - ${property.title}`,
        html: `
          <h1>New Booking Request</h1>
          <p>You have a new booking request for <strong>${property.title}</strong>.</p>
          
          <h2>Guest Details</h2>
          <ul>
            <li><strong>Name:</strong> ${guestName}</li>
            <li><strong>Email:</strong> ${user.email}</li>
            <li><strong>Phone:</strong> ${user.phone_number || 'Not provided'}</li>
          </ul>
          
          <h2>Booking Details</h2>
          <ul>
            <li><strong>Check-in:</strong> ${booking.start_date}</li>
            <li><strong>Check-out:</strong> ${booking.end_date}</li>
            <li><strong>Guests:</strong> ${booking.guest_count}</li>
            <li><strong>Total Price:</strong> $${booking.total_price}</li>
          </ul>
          
          ${booking.special_requests ? `<h2>Special Requests</h2><p>${booking.special_requests}</p>` : ''}
          
          <p>Log in to your admin dashboard to approve or deny this booking.</p>
        `,
      };
    }
    
    if (type === 'booking_approved') {
      const paymentLink = `https://surfhousebaja.com/pay/${booking.id || 'placeholder'}`;
      return {
        subject: `Booking Approved - Complete Payment for ${property.title}`,
        html: `
          <h1>Great News! Your Booking is Approved 🎉</h1>
          <p>Hi ${guestName},</p>
          <p>Your booking request for <strong>${property.title}</strong> has been approved!</p>
          
          <h2>Your Booking Details</h2>
          <ul>
            <li><strong>Check-in:</strong> ${booking.start_date}</li>
            <li><strong>Check-out:</strong> ${booking.end_date}</li>
            <li><strong>Guests:</strong> ${booking.guest_count}</li>
            <li><strong>Total Amount Due:</strong> $${booking.total_price}</li>
          </ul>
          
          <div style="margin: 30px 0;">
            <a href="${paymentLink}" style="background-color: #C47756; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
              Pay Now - $${booking.total_price}
            </a>
          </div>
          
          <p>Click the button above to complete your payment and confirm your booking.</p>
          <p>We look forward to hosting you!</p>
          <p>- The ${property.title} Team</p>
        `,
      };
    }
    
    if (type === 'booking_confirmed') {
      return {
        subject: `Booking Confirmed - ${property.title}`,
        html: `
          <h1>Booking Confirmed!</h1>
          <p>Hi ${guestName},</p>
          <p>Your booking at <strong>${property.title}</strong> has been confirmed!</p>
          
          <h2>Your Booking Details</h2>
          <ul>
            <li><strong>Check-in:</strong> ${booking.start_date}</li>
            <li><strong>Check-out:</strong> ${booking.end_date}</li>
            <li><strong>Guests:</strong> ${booking.guest_count}</li>
            <li><strong>Total Price:</strong> $${booking.total_price}</li>
          </ul>
          
          <p>We look forward to hosting you!</p>
          <p>- The ${property.title} Team</p>
        `,
      };
    }
    
    if (type === 'booking_denied') {
      return {
        subject: `Booking Not Available - ${property.title}`,
        html: `
          <h1>Booking Update</h1>
          <p>Hi ${guestName},</p>
          <p>Unfortunately, your booking request for <strong>${property.title}</strong> could not be accommodated.</p>
          ${denialReason ? `<p><strong>Reason:</strong> ${denialReason}</p>` : ''}
          <p>We apologize for any inconvenience. Please try different dates or contact us directly.</p>
        `,
      };
    }
    
    return {
      subject: 'Booking Update',
      html: '<p>Update regarding your booking.</p>',
    };
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
}
