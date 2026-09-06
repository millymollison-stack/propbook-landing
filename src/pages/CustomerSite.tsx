/**
 * CustomerSite — renders a customer's property site by slug
 * Loaded at /props/:slug — reads property data from Supabase
 * Uses the same polished components as Home.tsx (ImageGallery, PropertyDetails, etc.)
 * No onboarding popup — this is the public-facing published site
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Login } from './Login';
import { Signup } from './Signup';
import { supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';
import { useProperty } from '../store/property';
import type { Property, PropertyImage, Booking, BlockedDate } from '../types';
import { ImageGallery } from '../components/ImageGallery';
import { PropertyDetails } from '../components/PropertyDetails';
import { PropertyAmenities } from '../components/PropertyAmenities';
import { BookingCalendar } from '../components/BookingCalendar';
import ReviewsList from '../components/ReviewsList';
import ReviewForm from '../components/ReviewForm';

// ── Stripe success modal helpers ──────────────────────────────────

async function verifyStripeSession(sessionId) {
  const res = await fetch('https://jtzagpbdrqfifdisxipr.supabase.co/functions/v1/stripe-subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_session', session_id: sessionId })
  });
  if (!res.ok) throw new Error(`Verification failed: ${res.status}`);
  return res.json();
}

async function pollForSiteUrl(slug, maxAttempts = 20, intervalMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`https://jtzagpbdrqfifdisxipr.supabase.co/rest/v1/properties?slug=eq.${encodeURIComponent(slug)}&select=site_url&limit=1`, {
        headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0emFncGJkcnFmaWZkaXN4aXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ3MzUyODUsImV4cCI6MjA2MDMxMTI4NX0.uWqc82Hb-qnRq4H9kg5IPykUosm9VvU2s6e8mOalkR0' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.[0]?.site_url) return data[0].site_url;
      }
    } catch { /* keep polling */ }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

function showStripeSuccessModal(siteUrl, planName) {
  const existing = document.getElementById('stripe-success-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'stripe-success-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;';

  const planText = planName ? " You're on the <strong>" + planName + "</strong> plan." : '';
  const siteUrlBlock = siteUrl
    ? '<p style="margin:0 0 8px;color:#999;font-size:13px;">Your live site:</p><a href="' + siteUrl + '" target="_blank" style="display:block;color:#C47756;font-size:15px;word-break:break-all;margin-bottom:24px;text-decoration:underline;">' + siteUrl + '</a>'
    : '<div style="margin-bottom:24px"></div>';

  overlay.innerHTML =
    '<div style="background:#fff;border-radius:16px;padding:40px;max-width:480px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
    '<div style="width:64px;height:64px;background:#22c55e;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:32px;color:#fff;">&#10003;</div>' +
    '<h2 style="margin:0 0 12px;font-size:24px;color:#111;">Well done!</h2>' +
    '<p style="margin:0 0 24px;color:#666;font-size:15px;">Your subscription is active. You can now publish your site!' + planText + '</p>' +
    siteUrlBlock +
    '<button id="stripe-modal-close" style="background:#111;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:15px;cursor:pointer;">Close</button>' +
    '</div>';
  document.body.appendChild(overlay);
  document.getElementById('stripe-modal-close').addEventListener('click', () => {
    overlay.remove();
    window.history.replaceState({}, '', window.location.pathname);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.remove(); window.history.replaceState({}, '', window.location.pathname); }
  });
}

function handleStripeRedirect() {
  // ── Step 1: Check sessionStorage first (set by OnboardingPopup before redirect) ──
  // Set stripe_banner_pending SYNCHRONOUSLY so banner useEffect (fires same cycle) can read it.
  // For logged-in users: banner shows green subscription confirmation.
  // For logged-out users: banner won't show (no session), but they're redirected to auth anyway.
  const storedRaw = sessionStorage.getItem('stripe_paid_session');
  if (storedRaw) {
    sessionStorage.removeItem('stripe_paid_session');
    try {
      const { sessionId, planName, siteUrl } = JSON.parse(storedRaw);
      if (sessionId) {
        console.log('[Stripe redirect] Found paid session in sessionStorage:', sessionId, planName);
        // Set signal for banner SYNCHRONOUSLY — banner fires in same render cycle
        sessionStorage.setItem('stripe_banner_pending', JSON.stringify({ planName, siteUrl }));
        console.log('[Stripe redirect] Set stripe_banner_pending — banner will confirm');
        return;
      }
    } catch { /* ignore parse errors */ }
  }

  // ── Step 2: Fall back to URL params (for direct links) ──
  const params = new URLSearchParams(window.location.search);
  const paid = params.get('paid');
  const sessionId = params.get('session_id');
  if (paid !== 'true' || !sessionId) return;

  window.history.replaceState({}, '', window.location.pathname);

  verifyStripeSession(sessionId).then(result => {
    if (result.subscription?.status === 'active' || result.subscription?.status === 'complete') {
      const match = window.location.pathname.match(/\/props\/([^\/]+)/);
      const slug = match?.[1];
      if (slug) {
        pollForSiteUrl(slug, 20, 2000).then(siteUrl => {
          showStripeSuccessModal(siteUrl);
        }).catch(() => {
          showStripeSuccessModal(null);
        });
      } else {
        showStripeSuccessModal(null);
      }
    }
  }).catch(err => {
    console.error('[Stripe verify] Error:', err.message);
  });
}

export function CustomerSite({ onSiteNameChange, isEditing: externalIsEditing, registerSaveAll, onPropertyLoaded, scrapedProperty, scrapedImages }: {
  onSiteNameChange?: (name: string) => void;
  isEditing?: boolean;
  registerSaveAll?: (fn: () => Promise<void>) => boolean;
  onPropertyLoaded?: (ownerId: string | null, propertyId: string | null) => void;
  scrapedProperty?: Partial<Property> | null;
  scrapedImages?: { id: string; url: string; position: number }[];
}) {
  const { slug } = useParams<{ slug: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [images, setImages] = useState<PropertyImage[]>([]);
  const [backgroundImages, setBackgroundImages] = useState<PropertyImage[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showAuthLogin, setShowAuthLogin] = useState(false);
  const [showAuthSignup, setShowAuthSignup] = useState(false);
  // ── Subscription confirmation banner ─────────────────────────────────────────
  const [showSubscriptionBanner, setShowSubscriptionBanner] = useState(false);
  const [subscriptionPlan, setSubscriptionPlan] = useState<string | null>(null);

  // ── Handle ?auth=login / ?auth=signup params ─────────────────────────────────
  // Clear the param AFTER reading it so that a page reload doesn't re-open the modal
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get('auth');
    if (auth === 'login') {
      setShowAuthLogin(true);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (auth === 'signup') {
      setShowAuthSignup(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // ── Override with scraped data when GetSite scrape completes ───────────────────
  // When the user scrapes a new Airbnb listing in the GetSite popup, the scrape
  // data is passed here from App.tsx state. Use it to override the cached
  // property so the live site behind the popup updates immediately.
  useEffect(() => {
    if (!scrapedProperty) return;
    const sp = scrapedProperty as Property;
    setProperty(sp);
    if (sp.images && Array.isArray(sp.images)) {
      const imgList = sp.images.map((url: string, i: number) => ({ id: `scraped-${i}`, url, position: i + 1 }));
      setImages(imgList);
      // Set first image as background
      if (imgList.length > 0) {
        setBackgroundImages(imgList.slice(0, 3));
      }
    }
    if (scrapedImages && scrapedImages.length > 0) {
      setImages(scrapedImages);
    }
    document.title = sp.name || sp.property_headline || sp.property_title || '@' + slug;
    onSiteNameChange?.(document.title);
    if (sp.brand_color) document.documentElement.style.setProperty('--brand', sp.brand_color);
    if (sp.font_accent) document.documentElement.style.setProperty('--font-accent', `'${sp.font_accent}', serif`);
  }, [scrapedProperty, scrapedImages]);

  // ── No hiding CSS needed — published page uses minimal HTML shell ──

  // ── Auth subscription — re-render when user signs in ─────────────────────
  const auth = useAuth();
  // isAdmin = true ONLY if the logged-in user owns THIS specific property (by owner_id match)
  const isAdmin = !!(auth.user && property && auth.user.id === property.owner_id);
  const isEditing = externalIsEditing ?? false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_authTrigger, setAuthTrigger] = useState(0);
  useEffect(() => {
    const unsubscribe = supabase.auth.onAuthStateChange((_event, _session) => {
      setAuthTrigger(t => t + 1);
    });
    return () => { unsubscribe.data?.subscription?.unsubscribe(); };
  }, []);

  // ── Listen for open-auth events (dispatched by BookingCalendar) ──────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const mode = (e as CustomEvent<{ mode: string }>).detail?.mode;
      if (mode === 'signup') setShowAuthSignup(true);
      else setShowAuthLogin(true);
    };
    window.addEventListener('open-auth', handler);
    return () => window.removeEventListener('open-auth', handler);
  }, []);

  // ── Handle Stripe ?paid=true redirect ──────────────────────
  useEffect(() => {
    handleStripeRedirect();
  }, []);

  // Mark onboarding as closed so the editor doesn't auto-open popup on next visit
  useEffect(() => {
    localStorage.setItem('onboarding_popup_closed', '1');
  }, []);

  // ── Check for Stripe paid session and show subscription banner ────────────────
  // Reads stripe_banner_pending (set synchronously by handleStripeRedirect)
  // Shows confirmation immediately — popup already validated payment, no async verification needed
  useEffect(() => {
    const storedRaw = sessionStorage.getItem('stripe_banner_pending');
    if (!storedRaw) return;
    sessionStorage.removeItem('stripe_banner_pending');

    let planName = 'Starter';
    try {
      const parsed = JSON.parse(storedRaw);
      planName = parsed.planName || 'Starter';
    } catch { /* ignore */ }

    setSubscriptionPlan(planName);
    setShowSubscriptionBanner(true);
    setTimeout(() => setShowSubscriptionBanner(false), 15000);
  }, []);

  useEffect(() => {
    async function loadProperty() {
      console.log('[CustomerSite loadProperty] slug:', slug);
      if (!slug) {
        setError('No property slug provided');
        setLoading(false);
        return;
      }

      try {
        // ── Fast-path: use window.__PROPERTY_DATA__ if available (set by published HTML) ──
        const cached = (window as any).__PROPERTY_DATA__;
        const forceSlug = (window as any).__FORCE_SLUG__;
        const effectiveSlug = forceSlug || slug;
        console.log('[CustomerSite loadProperty] cached:', cached ? 'EXISTS slug=' + cached.slug : 'NULL', '| slug:', effectiveSlug, '| match:', cached && cached.slug === effectiveSlug);
        if (cached && cached.slug === effectiveSlug) {
          setProperty(cached as Property);
          useProperty.getState().setActiveProperty(cached as Property);
          const imgList: PropertyImage[] = (cached.images || []).map((url: string, i: number) => ({ id: `img-${i}`, url, position: i }));
          setImages(imgList);
          setBackgroundImages([]);
          document.title = cached.name || cached.property_headline || cached.property_title || '@' + slug;
          onSiteNameChange?.(document.title);
          if (cached.brand_color) document.documentElement.style.setProperty('--brand', cached.brand_color);
          if (cached.font_accent) document.documentElement.style.setProperty('--font-accent', `'${cached.font_accent}', serif`);
          setLoading(false);
          console.log('[CustomerSite loadProperty] Fast-path SUCCESS, property set');
          // Fetch bookings/blocked dates in background — don't block render
          supabase.from('bookings').select('*').eq('property_id', cached.id).in('status', ['approved', 'pending'])
            .then(bkgRes => { if (!bkgRes.error) setBookings(bkgRes.data || []); })
            .catch(() => {});
          supabase.from('blocked_dates').select('*').eq('property_id', cached.id)
            .then(blkRes => { if (!blkRes.error) setBlockedDates(blkRes.data || []); })
            .catch(() => {});
          // Fetch owner_id in background so isAdmin re-evaluates correctly
          if (!cached.owner_id) {
            supabase.from('properties').select('owner_id').eq('id', cached.id).limit(1).single()
              .then(({ data: ownerData }) => {
                if (ownerData?.owner_id) {
                  const updated = { ...cached, owner_id: ownerData.owner_id } as Property;
                  setProperty(updated);
                  useProperty.getState().setActiveProperty(updated);
                  onPropertyLoaded?.(ownerData.owner_id, cached.id);
                }
              }).catch(() => {});
          } else {
            onPropertyLoaded?.(cached.owner_id, cached.id);
          }
          return;
        }

        console.log('[CustomerSite loadProperty] Slow path: querying Supabase for slug:', slug);
        const { data: propData, error: propError } = await supabase
          .from('properties')
          .select('*')
          .eq('slug', slug)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (propError || !propData) {
          console.log('[CustomerSite loadProperty] Supabase error:', propError, 'or no data:', !propData);
          setError('Property not found');
          setLoading(false);
          return;
        }

        console.log('[CustomerSite loadProperty] Slow-path SUCCESS, property:', propData.title);
        setProperty(propData);
        // Share this property with AdminSidebar so it can verify ownership
        useProperty.getState().setActiveProperty(propData);

        // Load property images: prefer properties.images array (Airbnb URLs stored directly),
        // fall back to property_images table for manually uploaded images
        const { data: imgData } = await supabase
          .from('property_images')
          .select('*')
          .eq('property_id', propData.id)
          .order('position');
        let imgList: PropertyImage[] = [];
        if (propData.images && propData.images.length > 0) {
          imgList = propData.images.map((url: string, i: number) => ({ id: `img-${i}`, url, position: i }));
        } else {
          imgList = imgData || [];
        }
        setImages(imgList);

        // Background images (first 2 with is_background flag)
        let bgImages: PropertyImage[] = [];
        try {
          bgImages = (imgData || []).filter((img: PropertyImage) => (img as any).is_background).slice(0, 2);
        } catch (e) { bgImages = []; }
        setBackgroundImages(bgImages);

        // Load bookings
        const { data: bkgData } = await supabase
          .from('bookings')
          .select('*')
          .eq('property_id', propData.id)
          .in('status', ['approved', 'pending']);
        setBookings(bkgData || []);

        // Load blocked dates
        const { data: blkData } = await supabase
          .from('blocked_dates')
          .select('*')
          .eq('property_id', propData.id);
        setBlockedDates(blkData || []);

        // Apply brand color if saved
        if (propData.brand_color) {
          document.documentElement.style.setProperty('--brand', propData.brand_color);
        }
        // Apply font accent if saved
        if (propData.font_accent) {
          document.documentElement.style.setProperty('--font-accent', `'${propData.font_accent}', serif`);
        }

        // Update parent Layout nav with property name
        const displayName = propData.name || propData.property_headline || propData.property_title || propData.title || '@' + slug;
        onSiteNameChange?.(displayName);
        // Also set the browser tab title
        document.title = displayName;

      } catch (err) {
        console.error('CustomerSite load error:', err);
        setError('Failed to load property');
      } finally {
        setLoading(false);
      }
    }

    loadProperty();
  }, [slug]);

  // Tell App.tsx who owns this property so it can decide AdminSidebar vs GuestSidebar
  useEffect(() => {
    onPropertyLoaded?.(property?.owner_id ?? null, property?.id ?? null);
  }, [property?.id, property?.owner_id]); // eslint-disable-line

  const handleBookingSubmit = async (bookingData: {
    start_date: string;
    end_date: string;
    guest_count: number;
    total_price: number;
    special_requests?: string;
  }) => {
    if (!property) return;
    const { error } = await supabase
      .from('bookings')
      .insert({ property_id: property.id, ...bookingData });
    if (error) throw error;
    const { data: updatedBookings } = await supabase
      .from('bookings')
      .select('*')
      .eq('property_id', property.id)
      .in('status', ['approved', 'pending']);
    setBookings(updatedBookings || []);
  };

  // ── Edit-mode handlers ────────────────────────────────────────────────────────
  const handlePropertyUpdate = async (updates: Partial<Property>, _onUpdated?: (updated: Property) => void) => {
    if (!property) return;
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/update-property`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ id: property.id, ...updates }),
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
      const updated = { ...property, ...updates };
      setProperty(updated);
      useProperty.getState().setActiveProperty(updated);
      _onUpdated?.(updated);
    } catch (err) {
      console.error('Failed to update property:', err);
      throw err;
    }
  };

  const handleImageUpload = async (file: File) => {
    if (!property) return;
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${property.id}/${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('property-images')
        .upload(fileName, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage
        .from('property-images')
        .getPublicUrl(fileName);
      const { data: image, error: insertError } = await supabase
        .from('property_images')
        .insert({ property_id: property.id, url: publicUrl, position: images.length + 1, is_featured: images.length < 3 })
        .select()
        .single();
      if (insertError) throw insertError;
      setImages(prev => [...prev, image]);
    } catch (err) {
      console.error('Failed to upload image:', err);
      throw err;
    }
  };

  const handleImageDelete = async (imageId: string) => {
    if (!property) return;
    const imageToDelete = images.find(img => img.id === imageId);
    if (!imageToDelete) return;
    // Airbnb URLs (synthetic IDs) — update properties.images array
    if (imageId.startsWith('img-')) {
      const idx = parseInt(imageId.replace('img-', ''), 10);
      const currentImages = property.images || [];
      if (idx >= 0 && idx < currentImages.length) {
        const updatedImages = currentImages.filter((_: string, i: number) => i !== idx);
        await supabase.from('properties').update({ images: updatedImages }).eq('id', property.id);
        setProperty(prev => prev ? { ...prev, images: updatedImages } : prev);
      }
    } else {
      // Real uploaded image
      const urlParts = imageToDelete.url.split('/');
      const filePath = urlParts.slice(-2).join('/');
      await supabase.storage.from('property-images').remove([filePath]);
      await supabase.from('property_images').delete().eq('id', imageId);
    }
    setImages(prev => prev.filter(img => img.id !== imageId));
  };

  const handleImageUpdate = async (imageId: string, updates: Partial<PropertyImage>) => {
    if (!property) return;
    await supabase.from('property_images').update(updates).eq('id', imageId);
    setImages(prev => prev.map(img => img.id === imageId ? { ...img, ...updates } : img));
  };

  const imageGallerySaveRef = { current: null as (() => Promise<void>) | null };
  const handleRegisterSaveHandler = (fn: () => Promise<void>) => { imageGallerySaveRef.current = fn; return true; };

  // Register saveAll so Layout Save button flushes image gallery changes
  useEffect(() => {
    if (!registerSaveAll) return;
    registerSaveAll(async () => {
      if (imageGallerySaveRef.current) await imageGallerySaveRef.current();
    });
  }, [registerSaveAll]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="spinner-ring" />
      </div>
    );
  }

  if (error || !property) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black" style={{ fontFamily: 'Inter, sans-serif' }}>
        <div className="text-center">
          <h1 style={{ color: '#fff', marginBottom: '16px' }}>Site not found</h1>
          <p style={{ color: 'rgba(255,255,255,0.6)' }}>{error || 'This site does not exist.'}</p>
          <a href="https://propbook.pro" style={{ marginTop: '24px', color: '#C47756', display: 'inline-block' }}>Go to propbook.pro</a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* ── Subscription confirmation banner ─────────────────────────────────── */}
      {showSubscriptionBanner && (
        <div style="background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;font-family:Inter,sans-serif;position:relative;z-index:100;">
          <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
            <div style="width:32px;height:32px;background:rgba(255,255,255,0.25);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px;">✓</div>
            <div style="min-width:0;">
              <p style="margin:0;font-size:15px;font-weight:600;">Subscription active!</p>
              <p style="margin:2px 0 0;font-size:13px;opacity:0.9;">You're on the {subscriptionPlan || 'Starter'} plan.</p>
            </div>
          </div>
          <button onClick={() => setShowSubscriptionBanner(false)} style="background:rgba(255,255,255,0.2);border:none;border-radius:6px;color:#fff;cursor:pointer;padding:6px 10px;font-size:18px;line-height:1;flex-shrink:0;" aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── Auth modals (inline, stay on property site) ───────────────────────────── */}
      {showAuthLogin && (
        <Login
          onSuccess={() => { setShowAuthLogin(false); window.location.reload(); }}
          onClose={() => setShowAuthLogin(false)}
          onSwitchToSignup={() => { setShowAuthLogin(false); setShowAuthSignup(true); }}
        />
      )}
      {showAuthSignup && (
        <Signup
          onSuccess={() => { setShowAuthSignup(false); window.location.reload(); }}
          onClose={() => setShowAuthSignup(false)}
          onSwitchToLogin={() => { setShowAuthSignup(false); setShowAuthLogin(true); }}
        />
      )}

      {/* Hero gallery — same as Home.tsx */}
      <ImageGallery
        images={images}
        property={property}
        isEditing={isEditing}
        isAdmin={isAdmin}
        onImageUpload={isAdmin ? handleImageUpload : undefined}
        onImageDelete={isAdmin ? handleImageDelete : undefined}
        onImageUpdate={isAdmin ? handleImageUpdate : undefined}
        onPropertyUpdate={isAdmin ? handlePropertyUpdate : undefined}
        registerSaveHandler={isAdmin ? handleRegisterSaveHandler : () => false}
      />

      {/* Property details + amenities + booking — same sections as Home.tsx */}
      <div className="section-mt-neg bg-black section-padding">
        <PropertyDetails
          property={property}
          isEditing={isEditing}
          onEditingChange={() => {}}
          onSave={isAdmin ? handlePropertyUpdate : undefined}
          onBeforeSave={undefined}
          onHasChanges={undefined}
        />

        <div className="amenities-bg">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: backgroundImages[0] ? `url('${backgroundImages[0].url}')` : undefined,
              opacity: backgroundImages[0] ? 0.6 : 0
            }}
          ></div>
          <div className="relative">
            <PropertyAmenities
              property={property}
              isEditing={isEditing}
              onHasChanges={undefined}
              onUpdate={isAdmin ? handlePropertyUpdate : async () => {}}
            />
            <div id="calendar-section" className="amenities-content pb-5">
              <BookingCalendar
                bookings={bookings}
                blockedDates={blockedDates}
                propertyId={property.id}
                property={property}
                pricePerNight={property.price_per_night || 150}
                maxGuests={property.max_guests || 8}
                isEditing={isEditing}
                onBookingSubmit={handleBookingSubmit}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Reviews section */}
      <div className="reviews-section relative reviews-bg">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: backgroundImages[1] ? `url('${backgroundImages[1].url}')` : undefined,
            opacity: backgroundImages[1] ? 0.6 : 0,
            width: '100vw',
            marginLeft: 'calc(-50vw + 50%)'
          }}
        ></div>
        <div className="content-container relative">
          <div>
            <h1 className="reviews-section-heading">What our guests say</h1>
          </div>
          <ReviewsList showStars={isEditing} isEditing={isEditing} />
          <div className="review-btn-wrap">
            <button
              onClick={() => setShowReviewModal(true)}
              className="review-btn"
            >
              Leave a review
            </button>
          </div>
        </div>
      </div>

      {showReviewModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 style={{ color: '#000', fontFamily: 'var(--font-accent, "Playfair Display"), serif', fontWeight: 400, textTransform: 'uppercase', fontSize: 'clamp(1.2rem, 2vw, 1.5rem)', margin: 0 }}>Leave a Review</h2>
            </div>
            <div className="p-6">
              <ReviewForm onSuccess={() => setShowReviewModal(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}