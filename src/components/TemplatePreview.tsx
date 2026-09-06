import React from 'react';
import './TemplatePreview.css';

interface TemplatePreviewProps {
  title: string;
  location: string;
  price: string;
  description: string;
  hero_image: string;
  guests?: number;
  bedrooms?: number;
  beds?: number;
  baths?: number;
  rating?: number;
  reviews?: number;
  host_name?: string;
  images?: string[];
}

// Render star SVG
function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: filled ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  );
}

export function TemplatePreview({
  title,
  location,
  price,
  description,
  hero_image,
  guests,
  bedrooms,
  beds,
  baths,
  rating,
  reviews,
  images = [],
}: TemplatePreviewProps) {
  // Use images[1] as hero since images[0] is often Airbnb's bot-detect placeholder
  const mainImage = images[1] || hero_image || images[0] || '';

  const ratingNum = typeof rating === 'number' ? rating : parseFloat(String(rating)) || 0;
  const displayRating = ratingNum ? Math.round(ratingNum * 2) / 2 : 0;
  const fullStars = Math.floor(displayRating);
  const hasHalfStar = displayRating % 1 !== 0;

  return (
    <div className="preview-container">
      {/* Hero background */}
      <div
        className="preview-bg"
        style={{ backgroundImage: mainImage ? `url('${mainImage}')` : undefined }}
      />

      {/* Nav */}
      <div className="preview-nav">
        <div className="preview-nav-logo">
          <span className="preview-nav-icon">◈</span>
          <span className="preview-nav-brand">YourLogoHere.Pro</span>
        </div>
        <div className="preview-nav-links">
          <span className="preview-nav-cta">Sign up</span>
        </div>
      </div>

      {/* Bottom info card */}
      <div className="preview-bottom">
        <div className="preview-title">{title || '@property'}</div>
        <div className="preview-location">{location || 'Location'}</div>
        <div className="preview-price">
          ${price || '0'} <span>/ night</span>
        </div>

        {/* Details row */}
        <div className="preview-details">
          {guests && (
            <div className="preview-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 10, height: 10 }}>
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              </svg>
              {guests} Guests
            </div>
          )}
          {bedrooms && (
            <div className="preview-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 10, height: 10 }}>
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M2 10h20M12 10v8"/>
              </svg>
              {bedrooms} Bedrooms
            </div>
          )}
          {beds && (
            <div className="preview-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 10, height: 10 }}>
                <path d="M2 12h20M2 12l4-4M2 12l4 4"/>
              </svg>
              {beds} Beds
            </div>
          )}
          {baths && (
            <div className="preview-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 10, height: 10 }}>
                <path d="M9 6l9 6-9 6V6z"/>
              </svg>
              {baths} Bath
            </div>
          )}
        </div>
      </div>

      {/* Bottom banner */}
      <div className="preview-banner">
        <div className="preview-banner-left">
          <div className="preview-stars">
            {[...Array(5)].map((_, i) => (
              <Star key={i} filled={i < fullStars} />
            ))}
          </div>
          {rating && (
            <span className="preview-rating">{ratingNum.toFixed(1)}</span>
          )}
          <span className="preview-reviews">
            ({reviews || 0} review{(reviews || 0) !== 1 ? 's' : ''})
          </span>
        </div>
        <button className="preview-book-btn">Book Now</button>
      </div>
    </div>
  );
}
