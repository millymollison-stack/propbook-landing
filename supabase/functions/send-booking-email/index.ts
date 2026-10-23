import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface BookingEmailRequest {
  type: 'booking_request' | 'booking_pending' | 'booking_payment_held' | 'booking_approved' | 'booking_confirmed' | 'booking_denied' | 'booking_id_request';
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
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    location_type?: string | null;
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

// David 2026-10-22: "Allow coordinates to work as an address in our system
// if needed as my vacation rental doesn't have an address as it's off
// grid." A saved lat/long (location_type: 'coordinates') is rendered as a
// Google Maps link when there's no street address on file.
function propertyLocationHtml(property: BookingEmailRequest['property']): string {
  if (property.address) {
    return `<h2>Property Address</h2><p>${property.address}</p>`;
  }
  if (property.location_type === 'coordinates' && property.latitude != null && property.longitude != null) {
    const mapsUrl = `https://www.google.com/maps?q=${property.latitude},${property.longitude}`;
    return `<h2>Property Location</h2><p><a href="${mapsUrl}">${property.latitude.toFixed(5)}, ${property.longitude.toFixed(5)} (view on map)</a></p>`;
  }
  return '';
}

function getEmailContent(data: BookingEmailRequest): { subject: string; html: string } {
  const { type, booking, user, property, denialReason } = data;
  const guestName = user.full_name || 'Guest';

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

        <p><strong>Please respond within 24 hours</strong> — your guest has been told you'll get back to them by then. Their card is already authorized and on hold; approving will charge it, denying (or not responding in time) releases the hold with no charge.</p>
        <p>Log in to your admin dashboard to approve or deny this booking.</p>
      `,
    };
  }

  // David 2026-10-20: no longer sent in the main flow -- its content was
  // folded into booking_payment_held below, per David's request to combine
  // the "Booking Request Received" and "card authorized/held" guest emails
  // into one (sendBookingRequestEmail in emailService.ts no longer calls
  // this type). Left in place for backward compatibility / other callers.
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
          <p style="margin: 10px 0 0 0;">Your host will get back to you within 24 hours to confirm your dates.</p>
        </div>

        <p>You'll hear from us by email as soon as your host responds.</p>

        <p>- The ${property.title} Team</p>
      `,
    };
  }

  // David 2026-10-20: this is now the ONE email the guest gets right after
  // submitting a booking -- it used to be two separate emails ("Booking
  // Request Received" sent at submission, then a second "Your Card Has
  // Been Authorized" sent moments later once the hold landed). David: "I
  // just did the test booking and got a few too many emails... Should we
  // combine them? The card being held really isn't important and can be
  // included in the Booking Request Received email as tiny <h6> text
  // after the important 24 hours to review text." So this now fires once,
  // at the payment-hold point (see BookingCalendar.tsx's
  // handlePaymentSuccess / emailService.ts's sendBookingPaymentHeldEmail),
  // with the old booking_pending content as the main message and the
  // card-hold status demoted to a small <h6> footnote.
  if (type === 'booking_payment_held') {
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
          <p style="margin: 0; font-weight: bold;">Your host has 24 hours to review your request</p>
          <p style="margin: 10px 0 0 0;">If approved, your card will be charged and you'll get a confirmation email. If declined, or if we don't hear from your host within 24 hours, the hold is released automatically and you will not be charged.</p>
        </div>

        <h6 style="margin: 16px 0 0 0; font-size: 0.75em; font-weight: normal; color: #888;">Card held, not charged — we've placed a $${booking.total_price} hold on your card to secure this request. It's only charged if your host approves.</h6>

        <p>- The ${property.title} Team</p>
      `,
    };
  }

  // David 2026-10-18: this used to be the pre-payment "approved, here's a
  // payment link" email from the old two-step flow (host approves first,
  // guest pays after) -- that order is reversed now (guest pays/authorizes
  // first, host approves second), so this is the REAL final confirmation:
  // sent once the host approves and the held card has actually been
  // charged. Dropped the "Pay Now" button and the dead payment-link URL.
  if (type === 'booking_approved') {
    return {
      subject: `Booking Confirmed - ${property.title}`,
      html: `
        <h1>Booking Confirmed!</h1>
        <p>Hi ${guestName},</p>
        <p>Great news — your host has approved your booking at <strong>${property.title}</strong> and your card has been charged.</p>

        <h2>Your Booking Details</h2>
        <ul>
          <li><strong>Check-in:</strong> ${booking.start_date}</li>
          <li><strong>Check-out:</strong> ${booking.end_date}</li>
          <li><strong>Guests:</strong> ${booking.guest_count}</li>
          <li><strong>Total Charged:</strong> $${booking.total_price}</li>
        </ul>

        ${propertyLocationHtml(property)}

        <p>We look forward to hosting you!</p>
        <p>- The ${property.title} Team</p>
      `,
    };
  }

  // Booking confirmed - kept for backward compatibility / other callers.
  // No longer used in the main instant-book flow (see booking_payment_held
  // and booking_approved above), but left intact rather than removed.
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

        ${propertyLocationHtml(property)}

        <p>We look forward to hosting you!</p>
        <p>- The ${property.title} Team</p>
      `,
    };
  }

  // ID request -- sent to GUEST shortly after their booking is confirmed,
  // asking them to send the host a copy of their ID to keep on file.
  // David (item 9): "Guests should be sent an extra email after the
  // booking has been confirmed asking them to provide the owner with an
  // ID to keep on file." Now fires at approval time (see booking_approved
  // above), not at payment-authorization time.
  if (type === 'booking_id_request') {
    return {
      subject: `One More Thing - ID on File for ${property.title}`,
      html: `
        <h1>Just One More Step</h1>
        <p>Hi ${guestName},</p>
        <p>Thanks again for booking <strong>${property.title}</strong> -- we're looking forward to hosting you!</p>

        <p>As part of our standard check-in process, we ask every guest to provide a copy of a
        valid photo ID (driver's license, passport, or similar) for us to keep on file. This is
        just for our records and helps us keep the property safe for all guests.</p>

        <p>You can reply directly to this email with a photo of your ID, or bring it with you
        to show at check-in.</p>

        <h2>Your Booking Details</h2>
        <ul>
          <li><strong>Check-in:</strong> ${booking.start_date}</li>
          <li><strong>Check-out:</strong> ${booking.end_date}</li>
        </ul>

        <p>If you have any questions, just reply to this email.</p>
        <p>- The ${property.title} Team</p>
      `,
    };
  }

  // Booking denied -- also used by expire-pending-bookings for the
  // 24-hour-timeout case, with its own denialReason.
  if (type === 'booking_denied') {
    return {
      subject: `Booking Not Available - ${property.title}`,
      html: `
        <h1>Booking Update</h1>
        <p>Hi ${guestName},</p>
        <p>Unfortunately, your booking request for <strong>${property.title}</strong> could not be accommodated.</p>
        ${denialReason ? `<p><strong>Reason:</strong> ${denialReason}</p>` : ''}
        <p>The hold on your card has been released -- you have not been charged.</p>
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
      // booking_pending, booking_payment_held, booking_approved,
      // booking_confirmed, booking_denied, booking_id_request all go to guest
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
