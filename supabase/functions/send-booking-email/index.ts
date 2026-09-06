import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface BookingEmailRequest {
  type: 'booking_request' | 'booking_pending' | 'booking_approved' | 'booking_confirmed' | 'booking_denied';
  booking: {
    id?: string;
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
  adminEmail: string;
  adminName: string;
  adminPhone?: string;
  denialReason?: string;
}

async function sendEmail(to: string, subject: string, html: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Surf House Baja <hello@updates.mollisondavid.com>',
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Resend error:', error);
    throw new Error(`Failed to send email: ${error}`);
  }

  return response.json();
}

function getEmailContent(data: BookingEmailRequest): { subject: string; html: string } {
  const { type, booking, user, property, adminName, denialReason } = data;
  const guestName = user.full_name || 'Guest';
  const siteUrl = 'https://src-sigma-fawn.vercel.app';
  const paymentLink = `${siteUrl}/pay/${booking.id || 'placeholder'}`;
  
  // Booking request - sent to ADMIN
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

  // Booking pending - sent to GUEST when they submit
  if (type === 'booking_pending') {
    return {
      subject: `[PENDING] Booking Request Received - ${property.title}`,
      html: `
        <h1>Booking Request Received!</h1>
        <p>Hi ${guestName},</p>
        <p>Thank you for your booking request at <strong>${property.title}</strong>!</p>
        
        <h2>Your Booking Details</h2>
        <ul>
          <li><strong>Check-in:</strong> ${booking.start_date}</li>
          <li><strong>Check-out:</strong> ${booking.end_date}</li>
          <li><strong>Guests:</strong> ${booking.guest_count}</li>
          <li><strong>Total Price:</strong> $${booking.total_price}</li>
        </ul>
        
        <div style="background-color: #fef3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold;">Your request is pending review</p>
          <p style="margin: 10px 0 0 0;">The host will review your booking and send you a payment link once approved.</p>
        </div>
        
        <p>You'll receive an email shortly with a payment link once the host approves your booking.</p>
        
        <p>- The ${property.title} Team</p>
      `,
    };
  }
  
  // Booking approved - sent to GUEST with payment link
  if (type === 'booking_approved') {
    return {
      subject: `[ACTION REQUIRED] Booking Approved - Complete Payment for ${property.title}`,
      html: `
        <h1>Great News! Your Booking is Approved</h1>
        <p>Hi ${guestName},</p>
        <p>Your booking request for <strong>${property.title}</strong> has been approved!</p>
        
        <h2>Your Booking Details</h2>
        <ul>
          <li><strong>Check-in:</strong> ${booking.start_date}</li>
          <li><strong>Check-out:</strong> ${booking.end_date}</li>
          <li><strong>Guests:</strong> ${booking.guest_count}</li>
          <li><strong>Total Amount Due:</strong> $${booking.total_price}</li>
        </ul>
        
        <div style="margin: 30px 0; text-align: center;">
          <a href="${paymentLink}" style="background-color: #C47756; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; font-size: 16px;">
            Pay Now - $${booking.total_price}
          </a>
        </div>
        
        <p>Click the button above to complete your payment and confirm your booking.</p>
        <p>We look forward to hosting you!</p>
        <p>- The ${property.title} Team</p>
      `,
    };
  }
  
  // Booking confirmed - sent to GUEST after payment
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
  
  // Booking denied
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

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        },
      });
    }

    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not configured');
    }

    const data: BookingEmailRequest = await req.json();
    console.log('Processing email request:', data.type);

    let to: string;
    let subject: string;
    let html: string;

    if (data.type === 'booking_request') {
      to = data.adminEmail;
      const content = getEmailContent(data);
      subject = content.subject;
      html = content.html;
    } else {
      // booking_pending, booking_approved, booking_confirmed, booking_denied all go to guest
      to = data.user.email;
      const content = getEmailContent(data);
      subject = content.subject;
      html = content.html;
    }

    await sendEmail(to, subject, html);

    return new Response(
      JSON.stringify({ success: true, message: 'Email sent' }),
      {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        status: 500,
      }
    );
  }
});
