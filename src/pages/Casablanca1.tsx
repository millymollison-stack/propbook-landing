/**
 * Casablanca1 — Test page for current scraped state with booking calendar
 * Route: /props/Casablanca1
 * Mirrors what the user sees after scraping + publishing flow
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { BookingCalendar } from '../components/BookingCalendar';
import type { Property, PropertyImage, Booking, BlockedDate } from '../types';
import '../components/CustomerSite.css';

export function Casablanca1() {
  const [property, setProperty] = useState<Property | null>(null);
  const [images, setImages] = useState<PropertyImage[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const DEMO_DATA = {
    title: 'Casablanca1',
    location: 'Ensenada, Mexico',
    description: 'Beautiful beachfront property with stunning ocean views. Steps from the beach, perfect for surfers and families alike.',
    price: '150',
    hero_image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=80',
    images: [
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80',
      'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80',
      'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80',
      'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=800&q=80',
    ],
    guests: 8,
    bedrooms: 3,
    beds: 4,
    baths: 2,
  };

  // Safely parse sessionStorage scraped data — never throw during render
  const [scrapedData] = useState<any>(() => {
    try {
      const raw = sessionStorage.getItem('popup_scraped_data');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const activeData = scrapedData || DEMO_DATA;

  useEffect(() => {
    async function loadData() {
      let propData = null;
      let propError = null;

      try {
        // Use limit(1)+order to avoid 406 on multiple rows
        const result = await supabase
          .from('properties')
          .select('*')
          .eq('slug', 'casablanca1'.toLowerCase())
          .order('created_at', { ascending: false })
          .limit(1);

        propData = result.data?.[0] ?? null;
        if (!propData) {
          console.warn('No DB property found, using demo data');
        }

        if (propData) {
          setProperty(propData);

          const [imgResult, bkgResult, blkResult] = await Promise.all([
            supabase.from('property_images').select('*').eq('property_id', propData.id).order('position'),
            supabase.from('bookings').select('*').eq('property_id', propData.id).in('status', ['approved', 'pending']),
            supabase.from('blocked_dates').select('*').eq('property_id', propData.id),
          ]);

          setImages(imgResult.data || []);
          setBookings(bkgResult.data || []);
          setBlockedDates(blkResult.data || []);

          if (propData.brand_color) {
            document.documentElement.style.setProperty('--brand', propData.brand_color);
          }
          if (propData.font_accent) {
            document.documentElement.style.setProperty('--font-accent', `'${propData.font_accent}', serif`);
          }
        } else {
          // No DB property — build synthetic from activeData (sessionStorage or DEMO_DATA)
          const synthetic: Property = {
            id: 'casablanca1-test',
            slug: 'casablanca1',
            name: activeData.title,
            description: activeData.description,
            location: activeData.location,
            price_per_night: parseFloat((activeData.price || '150').replace(/[^0-9.]/g, '')) || 150,
            max_guests: activeData.guests,
            bedrooms: activeData.bedrooms,
            beds: activeData.beds,
            baths: activeData.baths,
            amenities: '',
            user_id: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          setProperty(synthetic);

          // Set images from activeData
          if (activeData.images?.length) {
            setImages(activeData.images.map((url: string, i: number) => ({
              id: `img-${i}`,
              property_id: 'casablanca1-test',
              url,
              position: i,
              is_featured: i === 0,
              is_background: false,
            })));
          } else if (activeData.hero_image) {
            setImages([{
              id: 'hero',
              property_id: 'casablanca1-test',
              url: activeData.hero_image,
              position: 0,
              is_featured: true,
              is_background: false,
            }]);
          }
        }
      } catch (err) {
        console.error('Casablanca1 load error:', err);
        setError('Failed to load property');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif' }}>
        <div className="spinner-ring" />
      </div>
    );
  }

  if (error || !property) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#333' }}>
        <h1 style={{ marginBottom: '16px' }}>Site not found</h1>
        <p style={{ color: '#666' }}>{error || 'This site does not exist.'}</p>
      </div>
    );
  }

  const heroImage = images[0]?.url || activeData.hero_image || '/template/surfhousebaja-main.jpg';
  const galleryImages = images.slice(1);

  return (
    <div className="customer-site">
      <div className="cs-hero" style={{ backgroundImage: `url(${heroImage})` }}>
        <div className="cs-hero-overlay">
          <h1 className="cs-title" style={{ fontFamily: 'var(--font-accent, Playfair Display)' }}>
            {property.name}
          </h1>
          {property.location && (
            <p className="cs-location">{property.location}</p>
          )}
        </div>
      </div>

      <div className="cs-body">
        <div className="cs-main">
          <div className="cs-section">
            <h2>About this place</h2>
            <p>{property.description || 'A beautiful property with stunning views.'}</p>
          </div>

          <div className="cs-section">
            <h2>Details</h2>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.95rem', color: '#555' }}>
              {property.max_guests && <span>👤 Up to {property.max_guests} guests</span>}
              {property.bedrooms && <span>🛏️ {property.bedrooms} bedrooms</span>}
              {property.beds && <span>🛁 {property.beds} beds</span>}
              {property.baths && <span>🚿 {property.baths} baths</span>}
            </div>
          </div>

          {galleryImages.length > 0 && (
            <div className="cs-section">
              <h2>Gallery</h2>
              <div className="cs-gallery">
                {galleryImages.map((img, i) => (
                  <img key={img.id || i} src={img.url} alt={`Property ${i + 2}`} className="cs-gallery-img" />
                ))}
              </div>
            </div>
          )}

          <div className="cs-section">
            <h2>Availability</h2>
            <BookingCalendar
              bookings={bookings}
              blockedDates={blockedDates}
              propertyId={property.id}
              property={property}
              pricePerNight={property.price_per_night || 150}
              maxGuests={property.max_guests || 8}
              onBookingSubmit={async (bookingData) => {
                console.log('[Casablanca1] Booking submitted:', bookingData);
                alert('Booking submitted! (Demo mode — not actually saved)');
              }}
            />
          </div>
        </div>

        <div className="cs-sidebar">
          <div className="cs-booking-card">
            <div className="cs-price">
              <span className="cs-price-amount">${property.price_per_night || 150}</span>
              <span className="cs-price-unit"> USD / night</span>
            </div>
            {property.max_guests && (
              <p className="cs-guests">Up to {property.max_guests} guests</p>
            )}
            <a
              href={`https://propbook.pro/pay/${property.id}`}
              className="cs-book-btn"
            >
              Book now
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}