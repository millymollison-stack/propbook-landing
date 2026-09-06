import { useEffect, useState } from 'react';
import { Star, Trash2, ArrowUp, ArrowDown, Check, X, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Review } from '../types';
import { format } from 'date-fns';

export default function AdminReviewManagement() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'verified' | 'pending'>('all');

  console.log('=== ADMIN REVIEW MANAGEMENT COMPONENT RENDERED ===');
  console.log('Reviews state:', reviews);
  console.log('Loading state:', loading);
  console.log('Filter state:', filter);

  useEffect(() => {
    loadReviews();
  }, []);

  const loadReviews = async () => {
    try {
      console.log('AdminReviewManagement: Loading all reviews...');
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });

      console.log('AdminReviewManagement: Query result:', { data, error });
      if (error) throw error;
      setReviews(data || []);
      console.log('AdminReviewManagement: Set reviews:', data?.length || 0);
    } catch (error) {
      console.error('Error loading reviews:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleVerification = async (review: Review) => {
    try {
      const { error } = await supabase
        .from('reviews')
        .update({ is_verified: !review.is_verified })
        .eq('id', review.id);

      if (error) throw error;
      await loadReviews();
    } catch (error) {
      console.error('Error updating review:', error);
      alert('Failed to update review verification');
    }
  };

  const deleteReview = async (id: string) => {
    if (!confirm('Are you sure you want to delete this review? This action cannot be undone.')) {
      return;
    }

    try {
      const { error } = await supabase.from('reviews').delete().eq('id', id);

      if (error) throw error;
      await loadReviews();
    } catch (error) {
      console.error('Error deleting review:', error);
      alert('Failed to delete review');
    }
  };

  const moveReview = async (review: Review, direction: 'up' | 'down') => {
    const currentIndex = reviews.findIndex((r) => r.id === review.id);
    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (swapIndex < 0 || swapIndex >= reviews.length) return;

    const currentReview = reviews[currentIndex];
    const swapReview = reviews[swapIndex];

    try {
      const { error: error1 } = await supabase
        .from('reviews')
        .update({ display_order: swapReview.display_order })
        .eq('id', currentReview.id);

      const { error: error2 } = await supabase
        .from('reviews')
        .update({ display_order: currentReview.display_order })
        .eq('id', swapReview.id);

      if (error1 || error2) throw error1 || error2;
      await loadReviews();
    } catch (error) {
      console.error('Error reordering reviews:', error);
      alert('Failed to reorder reviews');
    }
  };

  const filteredReviews = reviews.filter((review) => {
    if (filter === 'verified') return review.is_verified;
    if (filter === 'pending') return !review.is_verified;
    return true;
  });

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Review Management</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All ({reviews.length})
          </button>
          <button
            onClick={() => setFilter('verified')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'verified'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Verified ({reviews.filter((r) => r.is_verified).length})
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'pending'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Pending ({reviews.filter((r) => !r.is_verified).length})
          </button>
        </div>
      </div>

      {filteredReviews.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow">
          <p className="text-gray-500 text-lg">No reviews found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredReviews.map((review, index) => (
            <div
              key={review.id}
              className={`bg-white rounded-xl shadow p-6 border-2 ${
                review.is_verified ? 'border-green-200' : 'border-yellow-200'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => moveReview(review, 'up')}
                    disabled={index === 0}
                    className="p-3 rounded-lg bg-blue-100 hover:bg-blue-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Move up"
                  >
                    <ArrowUp className="w-6 h-6 text-blue-700" />
                  </button>
                  <button
                    onClick={() => moveReview(review, 'down')}
                    disabled={index === filteredReviews.length - 1}
                    className="p-3 rounded-lg bg-blue-100 hover:bg-blue-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Move down"
                  >
                    <ArrowDown className="w-6 h-6 text-blue-700" />
                  </button>
                </div>

                <div className="flex-1">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h4 className="text-lg font-semibold text-gray-900">{review.guest_name}</h4>
                        {review.is_verified ? (
                          <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                            Verified
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">
                            Pending
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{review.guest_email}</p>
                      <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                        <Calendar className="w-4 h-4" />
                        Stayed {format(new Date(review.stay_date), 'MMMM d, yyyy')}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-5 h-5 ${
                            star <= review.rating
                              ? 'fill-yellow-400 text-yellow-400'
                              : 'text-gray-300'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <p className="text-gray-700 leading-relaxed mb-4">{review.review_text}</p>

                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>Submitted {format(new Date(review.created_at), 'MMM d, yyyy')}</span>
                    <span>•</span>
                    <span>Order: {review.display_order}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => toggleVerification(review)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      review.is_verified
                        ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                        : 'bg-green-500 hover:bg-green-600 text-white'
                    }`}
                    title={review.is_verified ? 'Unverify' : 'Verify'}
                  >
                    {review.is_verified ? 'Unverify' : 'Verify'}
                  </button>
                  <button
                    onClick={() => deleteReview(review.id)}
                    className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
                    title="Delete"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
