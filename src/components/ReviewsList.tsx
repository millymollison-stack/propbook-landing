import { useEffect, useState, useRef } from 'react';
import { Star, Trash2, ArrowUp, ArrowDown, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';
import { Review } from '../types';
import { format } from 'date-fns';

interface ReviewsListProps {
  showStars?: boolean;
  isEditing?: boolean;
}

export default function ReviewsList({ showStars = true, isEditing = false }: ReviewsListProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const sliderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadReviews();
  }, [isAdmin]);

  const loadReviews = async () => {
    try {
      let query = supabase.from('reviews').select('*');

      if (!isAdmin) {
        query = query.eq('is_verified', true);
      }

      const { data, error } = await query
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReviews(data || []);
    } catch (error) {
      console.error('Error loading reviews:', error);
      setError('Failed to load reviews');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (reviewId: string) => {
    if (!confirm('Are you sure you want to delete this review?')) return;

    setActionLoading(reviewId);
    setError(null);
    try {
      const { error } = await supabase
        .from('reviews')
        .delete()
        .eq('id', reviewId);

      if (error) throw error;
      await loadReviews();
    } catch (err) {
      console.error('Error deleting review:', err);
      setError('Failed to delete review');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReorder = async (reviewId: string, direction: 'up' | 'down') => {
    setActionLoading(reviewId);
    setError(null);
    try {
      const currentIndex = reviews.findIndex(r => r.id === reviewId);
      if (currentIndex === -1) return;

      const currentReview = reviews[currentIndex];
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

      if (targetIndex < 0 || targetIndex >= reviews.length) return;

      const targetReview = reviews[targetIndex];

      await supabase
        .from('reviews')
        .update({ display_order: targetReview.display_order })
        .eq('id', currentReview.id);

      await supabase
        .from('reviews')
        .update({ display_order: currentReview.display_order })
        .eq('id', targetReview.id);

      await loadReviews();
    } catch (err) {
      console.error('Error reordering review:', err);
      setError('Failed to reorder review');
    } finally {
      setActionLoading(null);
    }
  };

  const nextSlide = () => {
    setCurrentIndex((prev) => (prev + 1) % reviews.length);
  };

  const prevSlide = () => {
    setCurrentIndex((prev) => (prev - 1 + reviews.length) % reviews.length);
  };

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand)]"></div>
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-lg">No reviews yet. Be the first to share your experience!</p>
      </div>
    );
  }

  const reviewsPerPage = () => {
    if (typeof window === 'undefined') return 1;
    if (window.innerWidth < 768) return 1;
    if (window.innerWidth < 1024) return 2;
    return 3;
  };

  const getVisibleReviews = () => {
    // Show one review at a time for full width
    return [reviews[currentIndex]];
  };

  return (
    <div className="relative">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 mb-6">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Slider Container */}
      <div className="relative px-4 sm:px-8">
        {/* Navigation Arrows */}
        {reviews.length > 1 && (
          <>
            <button
              onClick={prevSlide}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 z-10 px-3 py-2 bg-white/20 backdrop-blur-sm border border-white/15 rounded text-gray-600/90 hover:bg-white/30 hover:text-gray-900 transition-all"
              aria-label="Previous review"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              onClick={nextSlide}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 z-10 px-3 py-2 bg-white/20 backdrop-blur-sm border border-white/15 rounded text-gray-600/90 hover:bg-white/30 hover:text-gray-900 transition-all"
              aria-label="Next review"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}

        {/* Reviews Container - Full Width */}
        <div 
          ref={sliderRef}
          className="flex gap-6 px-8 overflow-hidden width-full"
        >
          {getVisibleReviews().map((review) => (
            <div
              key={review.id}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-md p-4 border border-white/20 hover:shadow-xl transition-all duration-300 flex flex-col h-full width-full-min"
            >
              {/* Review Text */}
              <p className="text-gray-700 leading-relaxed mb-3 flex-grow italic">"{review.review_text}"</p>

              {/* Author & Date with Stars */}
              <div className="border-t border-gray-100 pt-4 flex justify-between items-start">
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">{review.guest_name}</h4>
                  <p className="text-sm text-gray-500 mt-1">
                    Stayed {format(new Date(review.stay_date), 'MMMM yyyy')}
                  </p>
                </div>
                <div className="flex gap-1">
                  {showStars && (
                    <>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-5 h-5 ${
                            star <= review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'
                          }`}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>

              {/* Admin Controls - only show in Edit Mode */}
              {isAdmin && isEditing && (
                <div className="flex items-center gap-2 pt-4 mt-4 border-t border-gray-200">
                  <button
                    onClick={() => handleReorder(review.id, 'up')}
                    disabled={actionLoading === review.id || currentIndex === 0}
                    className="p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleReorder(review.id, 'down')}
                    disabled={actionLoading === review.id || currentIndex === reviews.length - 1}
                    className="p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(review.id)}
                    disabled={actionLoading === review.id}
                    className="p-2 rounded-full bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-auto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
