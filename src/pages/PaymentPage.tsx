import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { stripePromise } from '../lib/stripe';
import { supabase } from '../lib/supabase';

interface BookingDetails {
  id: string;
  property_id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  total_price: number;
  guest_count: number;
  status: string;
  payment_status: string;
}

interface Property {
  title: string;
  address: string;
}

// Inner form — only mounted once Elements has a clientSecret
function CheckoutForm({ booking, property }: { booking: BookingDetails; property: Property | null }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);
    setError(null);

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/`,
      },
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message || 'Payment failed. Please try again.');
      setProcessing(false);
      return;
    }

    setSuccess(true);
    setProcessing(false);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful!</h2>
          <p className="text-gray-600 mb-6">Your booking has been confirmed. You will receive a confirmation email shortly.</p>
          <button onClick={() => navigate('/')} className="bg-[var(--brand)] text-white px-6 py-3 rounded-lg font-medium hover:bg-[var(--brand-hover)] transition-colors">
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl overflow-hidden">
          <div className="bg-[var(--brand)] px-8 py-6">
            <h1 className="text-2xl font-bold text-white">Complete Your Payment</h1>
            <p className="text-white/80 mt-1">Secure your booking at {property?.title || 'the property'}</p>
          </div>
          <div className="p-8">
            <div className="bg-gray-50 rounded-lg p-6 mb-8">
              <h2 className="font-semibold text-gray-900 mb-4">Booking Summary</h2>
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <p className="text-gray-500">Check-in</p>
                  <p className="font-medium">{booking.start_date}</p>
                </div>
                <div>
                  <p className="text-gray-500">Check-out</p>
                  <p className="font-medium">{booking.end_date}</p>
                </div>
                <div>
                  <p className="text-gray-500">Guests</p>
                  <p className="font-medium">{booking.guest_count}</p>
                </div>
              </div>
              <div className="border-t border-gray-200 pt-4 space-y-2 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Rental subtotal</span>
                  <span>${booking.total_price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Handling fee (2%)</span>
                  <span>${(booking.total_price * 0.02).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-200">
                  <span>Total due</span>
                  <span className="text-[var(--brand)]">${(booking.total_price * 1.02).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Details</label>
                <div className="border border-gray-300 rounded-lg p-4">
                  <PaymentElement />
                </div>
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-6">{error}</div>
              )}
              <button
                type="submit"
                disabled={!stripe || processing}
                className="w-full bg-[var(--brand)] text-white py-4 px-6 rounded-lg font-medium text-lg hover:bg-[var(--brand-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processing ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </span>
                ) : `Pay $${(booking.total_price * 1.02).toFixed(2)}`}
              </button>
              <p className="text-center text-gray-500 text-sm mt-4">Your payment is secured by Stripe</p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PaymentPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();

  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  useEffect(() => {
    async function init() {
      if (!bookingId) { setLoading(false); return; }

      try {
        const { data: bookingData, error: bookingError } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', bookingId)
          .single();

        if (bookingError || !bookingData) {
          setError('Booking not found');
          setLoading(false);
          return;
        }

        setBooking(bookingData);

        if (bookingData.payment_status === 'paid') {
          setAlreadyPaid(true);
          setLoading(false);
          return;
        }

        const { data: propertyData } = await supabase
          .from('properties')
          .select('title, address')
          .eq('id', bookingData.property_id)
          .single();

        if (propertyData) setProperty(propertyData);

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Please log in to complete payment');

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-payment-intent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              bookingId: bookingData.id,
              amount: parseFloat((bookingData.total_price * 1.02).toFixed(2)),
              rentalAmount: bookingData.total_price,
              propertyTitle: propertyData?.title || 'Property Rental',
              dates: `${bookingData.start_date} - ${bookingData.end_date}`,
            }),
          }
        );

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to initialise payment');
        setClientSecret(json.clientSecret);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [bookingId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--brand)]"></div>
      </div>
    );
  }

  if (alreadyPaid) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Already Paid</h2>
          <p className="text-gray-600 mb-6">This booking has already been paid for.</p>
          <button onClick={() => navigate('/')} className="bg-[var(--brand)] text-white px-6 py-3 rounded-lg font-medium hover:bg-[var(--brand-hover)] transition-colors">
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-2">Payment Error</h2>
          <p className="text-gray-600 mb-6">{error || 'Booking not found'}</p>
          <button onClick={() => navigate('/')} className="bg-[var(--brand)] text-white px-6 py-3 rounded-lg font-medium hover:bg-[var(--brand-hover)] transition-colors">
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--brand)]"></div>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CheckoutForm booking={booking} property={property} />
    </Elements>
  );
}
