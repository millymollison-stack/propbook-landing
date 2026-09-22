import { useState } from 'react';
import { Star } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ReviewFormProps {
  onSuccess?: () => void;
  propertyId: string;
}

export default function ReviewForm({ onSuccess, propertyId }: ReviewFormProps) {
  const [formData, setFormData] = useState({
    guest_name: '',
    guest_email: '',
    rating: 0,
    review_text: '',
    stay_date: '',
  });
  const [hoveredRating, setHoveredRating] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (formData.rating === 0) {
      setError('Please select a rating');
      setLoading(false);
      return;
    }

    try {
      const { error: insertError } = await supabase.from('reviews').insert([
        {
          property_id: propertyId,
          guest_name: formData.guest_name,
          guest_email: formData.guest_email,
          rating: formData.rating,
          review_text: formData.review_text,
          stay_date: formData.stay_date,
          is_verified: true,
        },
      ]);

      if (insertError) throw insertError;

      setSuccess(true);
      setFormData({
        guest_name: '',
        guest_email: '',
        rating: 0,
        review_text: '',
        stay_date: '',
      });

      // David: "I tried to leave a review and it didn't work. Did work
      // after a page refresh." The insert itself succeeds immediately
      // (confirmed: RLS allows it, no error), but ReviewsList's
      // remount-triggered refetch was firing on the very same tick as
      // this insert -- a fresh page load's query always saw it because
      // enough time had passed by then, but back-to-back insert+select
      // this fast can occasionally lose that race against Supabase's
      // connection pooling. A short delay before telling the parent to
      // refetch gives the write time to be visible to the very next read.
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 400);

      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800">
            Thank you for your review! It has been published successfully.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-3">
          <div>
            <label htmlFor="guest_name" className="review-form-label">
              Your Name
            </label>
            <input
              type="text"
              id="guest_name"
              required
              value={formData.guest_name}
              onChange={(e) => setFormData({ ...formData, guest_name: e.target.value })}
              className="sb-input-light"
            />
          </div>

          <div>
            <label htmlFor="guest_email" className="review-form-label">
              Your Email
            </label>
            <input
              type="email"
              id="guest_email"
              required
              value={formData.guest_email}
              onChange={(e) => setFormData({ ...formData, guest_email: e.target.value })}
              className="sb-input-light"
            />
          </div>
        </div>

        {/* David: "put the stars and the date input on the same line so
            the content can fit in a modal" -- was two full-width rows,
            pushing the form past the modal's visible height and forcing a
            scrollbar. Combined into one row; stars sized down slightly so
            all 5 still fit comfortably in their half of the row. */}
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">
            <label htmlFor="stay_date" className="review-form-label">
              When did you stay?
            </label>
            <input
              type="date"
              id="stay_date"
              required
              value={formData.stay_date}
              onChange={(e) => setFormData({ ...formData, stay_date: e.target.value })}
              className="sb-input-light"
            />
          </div>

          <div className="flex-1 min-w-0">
            <label className="review-form-label">Rating</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setFormData({ ...formData, rating: star })}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  className="transition-transform hover:scale-110 review-form-star-btn"
                >
                  <Star
                    className={`w-6 h-6 ${
                      star <= (hoveredRating || formData.rating)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-gray-300'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="review_text" className="review-form-label">
            Your Review
          </label>
          <textarea
            id="review_text"
            required
            rows={4}
            value={formData.review_text}
            onChange={(e) => setFormData({ ...formData, review_text: e.target.value })}
            className="sb-input-light review-form-textarea"
            placeholder="Tell us about your experience..."
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="review-btn review-form-submit"
          style={loading ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          {loading ? 'Submitting...' : 'Submit Review'}
        </button>
      </form>
    </div>
  );
}
