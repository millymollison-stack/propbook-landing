import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseAdmin } from '../lib/supabase';
import { ImageGallery } from '../components/ImageGallery';
import { PropertyDetails } from '../components/PropertyDetails';
import { PropertyAmenities } from '../components/PropertyAmenities';
import { BookingCalendar } from '../components/BookingCalendar';
import ReviewsList from '../components/ReviewsList';
import ReviewForm from '../components/ReviewForm';
import { GuestAuthModal } from '../components/GuestAuthModal';
import { GuestBookingRequest } from '../components/GuestBookingRequest';
import { duplicateSiteAfterPayment } from '../services/siteDuplicationService';
import { useAuth } from '../store/auth';
import { useProperty } from '../store/property';
import { saveBrandColor } from '../lib/brandColor';
import { applyFontAccent } from '../lib/fontAccent';
import type { Property, PropertyImage, Booking, BlockedDate } from '../types';

const SURF_HOUSE_BAJA_ID = 'efa8d280-afee-4971-9145-d591740f484d';

export function Home({ isEditing: externalIsEditing, onHasChanges, registerSaveAll, onSiteNameChange, onOpenSidebar, forceOpenOnboarding, onOnboardingClose, onOpenLogin, scrapedProperty: externalScrapedProperty, scrapedImages: externalScrapedImages }: { isEditing?: boolean; onHasChanges?: (hasChanges: boolean) => void; registerSaveAll?: (fn: () => Promise<void>) => void; onSiteNameChange?: (name: string) => void; onOpenSidebar?: () => void; forceOpenOnboarding?: boolean; onOnboardingClose?: () => void; onOpenLogin?: () => void; scrapedProperty?: Partial<Property> | null; scrapedImages?: PropertyImage[] }) {
  const [property, setProperty] = useState<Property | null>(null);
  const [reviewsRefreshKey, setReviewsRefreshKey] = useState(0);
  const [images, setImages] = useState<PropertyImage[]>([]);
  const [backgroundImages, setBackgroundImages] = useState<PropertyImage[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [scrapedImages, setScrapedImages] = useState<PropertyImage[]>([]);
  const [scrapedProperty, setScrapedProperty] = useState<Partial<Property> | null>(null);

  // Keep the global activeProperty store in sync with whichever property is currently
  // shown/edited here — Layout's <ColorPicker propertyId={activeProperty?.id}> (and anything
  // else reading useProperty) needs this to actually know which row to write to.
  useEffect(() => {
    const current = scrapedProperty || property;
    if (current) useProperty.getState().setActiveProperty(current as Property);
    // Apply THIS property's own brand color/font. Without this, --brand (and the
    // 'site-brand-color' localStorage key ColorPicker reads on mount) just keeps
    // whatever was last set anywhere else in the app — a different property's color,
    // or nothing — and bleeds into this property's edit view and the app chrome
    // around it until someone happens to repick a color here.
    const propBrandColor = (current as Property | null)?.brand_color;
    saveBrandColor(propBrandColor || '#C47756');
    const propFontAccent = (current as Property | null)?.font_accent;
    if (propFontAccent) applyFontAccent(propFontAccent);
  }, [property, scrapedProperty]);
  const [resetKey, setResetKey] = useState(0);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showGuestAuth, setShowGuestAuth] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [defaultProperty, setDefaultProperty] = useState<Property | null>(null);
  const [defaultImages, setDefaultImages] = useState<PropertyImage[]>([]);
  const imageGallerySaveRef = useRef<(() => Promise<void>) | null>(null);
  // Accumulate all dirty field changes here; cleared after each Save All
  const dirtyFieldsRef = useRef<Partial<Property>>({});
  const { user } = useAuth();

  // Note: static template hiding is handled by the inline <style> injected by p.ts (generateTemplateHtml)
  // which uses .site-loaded prefix for conditional hiding. No additional CSS injection needed here.

  // Listen for open-auth events dispatched by BookingCalendar "Sign in to Book" button
  useEffect(() => {
    const handler = () => { onOpenLogin?.(); }; // Opens the Login modal from App.tsx
    window.addEventListener('open-auth', handler);
    return () => window.removeEventListener('open-auth', handler);
  }, []);

  // Called by PropertyDetails / PropertyAmenities to report field changes
  const trackDirty = useCallback((updates: Partial<Property>) => {
    Object.assign(dirtyFieldsRef.current, updates);
    setHasChanges(true);
  }, []);
  const navigate = useNavigate();
  const calendarRef = useRef<HTMLDivElement>(null);

  // console.log('=== HOME COMPONENT RENDERED ==='); // removed — was causing render-loop noise

  // Sync with external edit mode from App
  useEffect(() => {
    if (externalIsEditing !== undefined) {
      setIsEditing(externalIsEditing);
    }
  }, [externalIsEditing]);

  // Sync scrapedProperty from App (GetSite popup import) to local state for NewSiteTemplate preview
  useEffect(() => {
    if (externalScrapedProperty) {
      setScrapedProperty(externalScrapedProperty);
    }
  }, [externalScrapedProperty]);

  // Sync scrapedImages from App (GetSite popup import) to local state
  useEffect(() => {
    if (externalScrapedImages && externalScrapedImages.length > 0) {
      setScrapedImages(externalScrapedImages);
    }
  }, [externalScrapedImages]);

  useEffect(() => {
    const userIdAtStart = user?.id;
    let cancelled = false;
    async function loadProperty() {
      if (cancelled || userIdAtStart !== user?.id) return;
      try {
        // Determine which property to load:
        // 1. Direct propertyId saved after Stripe payment (highest priority)
        // 2. User's own property by owner_id lookup (logged-in user)
        // 3. Template property (fallback for public/anonymous)
        let targetPropertyId: string;

        const savedPropertyId = sessionStorage.getItem('home_loaded_property_id');
        if (savedPropertyId) {
          sessionStorage.removeItem('home_loaded_property_id');
          targetPropertyId = savedPropertyId;
          console.log('[Home loadProperty] Using saved propertyId from sessionStorage:', targetPropertyId);
        } else if (user) {
          const { data: userProp } = await supabase
            .from('properties')
            .select('id')
            .eq('owner_id', user.id)
            .limit(1)
            .maybeSingle();
          if (userProp) {
            targetPropertyId = userProp.id;
            console.log('[Home loadProperty] Logged-in user has property:', targetPropertyId);
          } else {
            targetPropertyId = SURF_HOUSE_BAJA_ID;
            console.log('[Home loadProperty] No property for user, using template');
          }
        } else {
          targetPropertyId = SURF_HOUSE_BAJA_ID;
          console.log('[Home loadProperty] No user, using template');
        }

        // ── FAST PATH: Use baked property data from static HTML (SEO-friendly, instant) ──
        // window.__PROPERTY_DATA__ is set by generateTemplateHtml() at publish time
        const baked = (window as any).__PROPERTY_DATA__;
        if (baked && baked.id) {
          console.log('[Home loadProperty] Using baked property data from HTML:', baked.title);
          const bakedProp: Property = {
            id: baked.id || targetPropertyId,
            title: baked.title || '',
            name: baked.name || '',
            slug: baked.slug || '',
            description: baked.description || '',
            hero_image: baked.hero_image || '',
            images: Array.isArray(baked.images) ? baked.images : [],
            price_per_night: parseFloat(baked.price_per_night) || 0,
            max_guests: parseInt(baked.max_guests) || 8,
            bedrooms: parseInt(baked.bedrooms) || 0,
            beds: parseInt(baked.beds) || 0,
            baths: parseInt(baked.bathrooms) || 0,
            amenities: [],
            brand_color: null,
            font_accent: null,
            property_details: null,
            activities: null,
            local_area: null,
            getting_there: null,
            address: baked.address || null,
            latitude: null,
            longitude: null,
            location_type: 'address',
            property_title: baked.title || null,
            property_intro: baked.description || null,
            custom_domain: null,
            status: 'active',
            site_url: baked.site_url || null,
            server_ip: null,
            folder_path: null,
            owner_id: null,
            created_at: '',
            updated_at: '',
          };
          setProperty(bakedProp);
          setDefaultProperty(bakedProp);
          const bakedImgs: PropertyImage[] = (bakedProp.images as string[]).map((url: string, i: number) => ({
            id: `baked-${i}`, url, position: i,
          }));
          setImages(bakedImgs);
          setDefaultImages(bakedImgs);
          setBackgroundImages(bakedImgs.slice(0, 2));
          // Still fetch live data (bookings, blocked dates) from Supabase in background
          fetchLiveData(targetPropertyId, bakedProp);
          return;
        }

        // ── SLOW PATH: Fetch everything from Supabase (main app / dev server) ──
        await fetchFromSupabase(targetPropertyId);
      } catch (err) {
        setError('Failed to load property details');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    async function fetchLiveData(propertyId: string, bakedProp: Property) {
      // Fetch latest data from Supabase to overlay dynamic content (bookings, blocked dates)
      try {
        const [{ data: bkgData, error: bkgError }, { data: blkData, error: blkError }] = await Promise.all([
          supabase.from('bookings').select('*').eq('property_id', propertyId).in('status', ['approved', 'pending']),
          supabase.from('blocked_dates').select('*').eq('property_id', propertyId),
        ]);
        if (bkgError) throw bkgError;
        if (blkError) throw blkError;
        setBookings(bkgData || []);
        setBlockedDates(blkData || []);
        // If user is logged in, also refresh the full property record for latest edits
        if (user) {
          const { data: propData } = await supabase
            .from('properties').select('*').eq('id', propertyId).maybeSingle();
          if (propData) {
            setProperty(propData);
            setDefaultProperty(propData);
          }
        }
      } catch (err) {
        console.warn('[Home fetchLiveData] Could not fetch live data:', err);
        // Non-fatal — baked data is still shown
      }
    }

    async function fetchFromSupabase(propertyId: string) {
      const { data: propData, error: propError } = await supabase
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .single();

      if (propError) throw propError;
      setProperty(propData);
      setDefaultProperty(propData);

      // Load images: property_images table is the source of truth (it's the
      // only place with real row ids + is_featured/is_background/is_main
      // flags, so Hero/Featured/Background toggles persist and the
      // background-layer feature works) — fall back to the plain
      // properties.images URL array only when a property has no
      // property_images rows yet (e.g. never synced since being scraped).
      // Previously this was inverted: properties.images was tried FIRST,
      // which is populated on every publish, so real property_images data
      // (and any Hero/Featured/Background flags on it) was silently ignored
      // for every scraped site — Round 5, David: "works for surfhousebaja
      // but not all created property sites."
      let imgList: PropertyImage[] = [];
      const { data: imgData, error: imgError } = await supabase
        .from('property_images')
        .select('*')
        .eq('property_id', propertyId)
        .order('position');
      if (imgError) throw imgError;
      if (imgData && imgData.length > 0) {
        imgList = imgData;
      } else if (propData.images && propData.images.length > 0) {
        imgList = propData.images.map((url: string, i: number) => ({ id: `img-${i}`, url, position: i }));
        console.log('[Home loadProperty] No property_images rows — using properties.images:', imgList.length);
      }

      setImages(imgList);
      setDefaultImages(imgList);

      // Background images (first 2 with is_background flag)
      let bgImages: PropertyImage[] = [];
      try {
        bgImages = imgList.filter((img: PropertyImage) => (img as any).is_background).slice(0, 2);
      } catch (e) { bgImages = []; }
      setBackgroundImages(bgImages);

      const { data: bkgData, error: bkgError } = await supabase
        .from('bookings')
        .select('*')
        .eq('property_id', propertyId)
        .in('status', ['approved', 'pending']);
      if (bkgError) throw bkgError;

      const { data: blkData, error: blkError } = await supabase
        .from('blocked_dates')
        .select('*')
        .eq('property_id', propertyId);
      if (blkError) throw blkError;

      setBookings(bkgData || []);
      setBlockedDates(blkData || []);
    }

    loadProperty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, resetKey]);

  // ── Detect if current user is a guest for this property ─────────────────────
  // Hides owner-only booking UI from property owners; shows guest booking for logged-in guests
  useEffect(() => {
    if (!property?.id || !user) { setIsGuest(false); return; }
    const isOwner = property.owner_id === user.id;
    if (isOwner) { setIsGuest(false); return; }
    // Check if user has a guest_profiles record for this property
    // Use anon key explicitly in URL param to avoid 406 "No API key found" errors
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const guestUrl = `${supabaseUrl}/rest/v1/guest_profiles?select=id&user_id=eq.${user.id}&property_id=eq.${property.id}&apikey=${anonKey}`;
    fetch(guestUrl, { headers: { Authorization: `Bearer ${anonKey}` } })
      .then(r => { if (!r.ok) { setIsGuest(false); return; } return r.json(); })
      .then(d => setIsGuest(!!d?.[0]))
      .catch(() => setIsGuest(false));
  }, [property?.id, user]);

  // ── Reload property when ?paid handler saves a new property ─────────────────
  // After Stripe verifies and saves, OnboardingPopup stores the new propertyId
  // in sessionStorage. Check for it here and reload if needed.
  useEffect(() => {
    const savedPropertyId = sessionStorage.getItem('home_loaded_property_id');
    if (savedPropertyId && property?.id !== savedPropertyId) {
      console.log('[Home] New property saved after payment, reloading:', savedPropertyId);
      sessionStorage.removeItem('home_loaded_property_id');
      // Force reload by briefly toggling a key
      setResetKey(k => k + 1);
    }
  }, [property?.id]);

  // ── Restore scraped data from sessionStorage after Stripe redirect ─────────
  // This survives the Home component remount that happens when Stripe redirects
  // back to the app with ?paid=true&session_id=...
  // Only restore if we DON'T have a fresh property loaded from DB (indicated by
  // home_loaded_property_id sessionStorage flag set by the ?paid handler).
  useEffect(() => {
    if (!user) return;
    // If loadProperty just loaded a fresh property after payment, skip sessionStorage restore
    const justLoadedProperty = sessionStorage.getItem('home_loaded_property_id');
    if (justLoadedProperty) {
      sessionStorage.removeItem('home_loaded_property_id');
      console.log('[Home] Fresh property loaded from DB, skipping sessionStorage restore');
      return;
    }
    try {
      const savedProp = sessionStorage.getItem('home_scraped_property');
      const savedImgs = sessionStorage.getItem('home_scraped_images');
      if (savedProp) {
        const prop = JSON.parse(savedProp);
        // Only restore if it looks like a real scraped property (has title or property_title)
        if (prop.title || prop.property_title) {
          console.log('[Home] Restoring scrapedProperty from sessionStorage:', prop.title || prop.property_title);
          setScrapedProperty(prop);
        }
      }
      if (savedImgs) {
        const imgs = JSON.parse(savedImgs);
        if (Array.isArray(imgs) && imgs.length > 0) {
          console.log('[Home] Restoring scrapedImages from sessionStorage:', imgs.length, 'images');
          setScrapedImages(imgs);
        }
      }
    } catch (e) {
      console.warn('[Home] Could not restore scraped data from sessionStorage:', e);
    }
  }, [user]);


  // ── Persist scraped data to sessionStorage whenever it changes ──────────────
  // This ensures scraped data survives Stripe redirect page remounts
  useEffect(() => {
    if (scrapedProperty) {
      sessionStorage.setItem('home_scraped_property', JSON.stringify(scrapedProperty));
    } else {
      sessionStorage.removeItem('home_scraped_property');
    }
  }, [scrapedProperty]);


  useEffect(() => {
    if (scrapedImages && scrapedImages.length > 0) {
      sessionStorage.setItem('home_scraped_images', JSON.stringify(scrapedImages));
    } else {
      sessionStorage.removeItem('home_scraped_images');
    }
  }, [scrapedImages]);

  const handlePropertyUpdate = async (updates: Partial<Property>, onUpdated?: (updated: Property) => void) => {
    const callId = Math.random().toString(36).slice(2,8);
    console.log('[DEBUG] handlePropertyUpdate called [#', callId, '] with:', JSON.stringify(updates));
    if (!property) { console.log('[DEBUG] property is null, returning'); return; }
    try {
      // Use scrapedProperty.id if available (user's own property), otherwise fall back to property.id (demo)
      const targetPropertyId = scrapedProperty?.id || property.id;
      console.log('[DEBUG] Updating property ID:', targetPropertyId);
      // Call edge function — service role key on server bypasses RLS
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/update-property`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ id: targetPropertyId, ...updates }),
      });
      const result = await response.json();
      console.log('[DEBUG] update result [#', callId, ']:', JSON.stringify(result));
      if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
      const updated = { ...property, ...updates };
      setProperty(updated);
      // Also update scrapedProperty so the UI re-renders with fresh data
      // (displayProperty = scrapedProperty || property, so stale scrapedProperty blocks updates)
      setScrapedProperty((prev: any) => prev ? { ...prev, ...updates } : prev);
      onUpdated?.(updated);
      console.log('[DEBUG] handlePropertyUpdate completed [#', callId, ']');
    } catch (err) {
      console.error('Failed to update property:', err);
      throw err;
    }
  };

  useEffect(() => {
    if (registerSaveAll) {
      registerSaveAll(async () => {
        console.log('[DEBUG] registerSaveAll firing');
        // 1. Save images
        if (typeof imageGallerySaveRef.current === 'function') {
          await imageGallerySaveRef.current();
          console.log('[DEBUG] imageGallerySave completed');
        }
        // 2. Save all accumulated dirty fields
        const dirty = dirtyFieldsRef.current;
        if (Object.keys(dirty).length > 0) {
          console.log('[DEBUG] Saving dirty fields:', Object.keys(dirty));
          await handlePropertyUpdate(dirty);
          dirtyFieldsRef.current = {};
          console.log('[DEBUG] Dirty fields saved');
        } else {
          console.log('[DEBUG] No dirty fields to save');
        }
      });
    }
  }, [registerSaveAll]);

  const handleImageUpload = async (file: File) => {
    const targetPropertyId = scrapedProperty?.id || property?.id;
    if (!targetPropertyId) return;
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${targetPropertyId}/${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('property-images')
        .upload(fileName, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage
        .from('property-images')
        .getPublicUrl(fileName);
      const { data: image, error: insertError } = await supabase
        .from('property_images')
        .insert({ property_id: targetPropertyId, url: publicUrl, position: images.length + 1, is_featured: images.length < 3 })
        .select()
        .single();
      if (insertError) throw insertError;
      setImages([...images, image]);
    } catch (err) {
      console.error('Failed to upload image:', err);
      throw err;
    }
  };

  const handleImageDelete = async (imageId: string) => {
    const targetPropertyId = scrapedProperty?.id || property?.id;
    if (!targetPropertyId) return;
    try {
      const imageToDelete = images.find(img => img.id === imageId);
      if (!imageToDelete) return;

      // Synthetic IDs (img-N) are Airbnb URLs stored in properties.images array —
      // update the array directly in the properties table.
      // Real UUIDs are uploaded files in property_images table.
      if (imageId.startsWith('img-')) {
        const idx = parseInt(imageId.replace('img-', ''), 10);
        const currentImages = property?.images || [];
        if (idx >= 0 && idx < currentImages.length) {
          const updatedImages = currentImages.filter((_: string, i: number) => i !== idx);
          const { error: propError } = await supabase
            .from('properties')
            .update({ images: updatedImages })
            .eq('id', targetPropertyId);
          if (propError) throw propError;
          // Also update the local property state so UI stays consistent
          setProperty((prev: any) => prev ? { ...prev, images: updatedImages } : prev);
        }
      } else {
        // Real uploaded image — remove from storage and property_images table
        const urlParts = imageToDelete.url.split('/');
        const filePath = urlParts[urlParts.length - 2] + '/' + urlParts[urlParts.length - 1];
        const { error: storageError } = await supabase.storage
          .from('property-images')
          .remove([filePath]);
        if (storageError) console.warn('Storage remove warning:', storageError.message);
        const { error: dbError } = await supabase
          .from('property_images')
          .delete()
          .eq('id', imageId);
        if (dbError) throw dbError;
      }

      setImages(images.filter(img => img.id !== imageId));
    } catch (err) {
      console.error('Failed to delete image:', err);
      throw err;
    }
  };

  const handleImageUpdate = async (imageId: string, updates: Partial<PropertyImage>) => {
    const targetPropertyId = scrapedProperty?.id || property?.id;
    if (!targetPropertyId) return;
    try {
      // Synthetic IDs (img-N) are Airbnb URLs stored as a text[] in properties.images.
      // hero_image is the URL string for the main image; there are no is_main/is_featured columns.
      // When user sets main, update hero_image in properties.
      // When user sets featured, update the in-memory images state only (no DB column for featured).
      if (imageId.startsWith('img-')) {
        const idx = parseInt(imageId.replace('img-', ''), 10);
        const currentImages: string[] = property?.images || [];
        if (idx >= 0 && idx < currentImages.length) {
          const imageUrl = currentImages[idx];
          if (updates.is_main) {
            const { error: propError } = await supabase
              .from('properties')
              .update({ hero_image: imageUrl })
              .eq('id', targetPropertyId);
            if (propError) throw propError;
            // Update local property state so hero changes immediately
            setProperty((prev: any) => prev ? { ...prev, hero_image: imageUrl } : prev);
          }
          // Update local images state (featured has no DB column for Airbnb URLs)
          setImages(images.map(img => img.id === imageId ? { ...img, ...updates } : img));
        }
      } else {
        // Real uploaded image — update in property_images table
        const { error: updateError } = await supabaseAdmin
          .from('property_images')
          .update(updates)
          .eq('id', imageId);
        if (updateError) throw updateError;
        setImages(images.map(img => img.id === imageId ? { ...img, ...updates } : img));
      }
    } catch (err) {
      console.error('Failed to update image:', err);
      throw err;
    }
  };

  // Called when Airbnb import completes — saves to onboarding_data table + 'onboarding' bucket

  const handleImportedImages = async (imported: {
    hero_image: string;
    images: string[];
    title: string;
    location: string;
    price: string;
    description: string;
    guests?: number;
    bedrooms?: number;
    beds?: number;
    baths?: number;
    rating?: number;
    reviews?: number;
    host_name?: string;
  }) => {
    console.log('[Home] Received imported data:', imported.title);

    try {
      // Upload images to 'onboarding' bucket in Supabase Storage — in parallel for speed
      const imageList = imported.images || [];
      const imageUrls: string[] = await Promise.all(
        imageList.map(async (imgUrl, i) => {
          try {
            const response = await fetch(imgUrl);
            const buffer = await response.arrayBuffer();
            const filename = `onboarding/${Date.now()}-${i}.jpg`;
            const { error: uploadError } = await supabase.storage
              .from('onboarding')
              .upload(filename, buffer, { contentType: 'image/jpeg' });
            if (uploadError) return imgUrl; // bucket may not exist — fall back to Airbnb URL
            const { data: { publicUrl } } = supabase.storage
              .from('onboarding')
              .getPublicUrl(filename);
            return publicUrl;
          } catch {
            return imgUrl; // network error — fall back to original URL
          }
        })
      );

      // Fallback: if no images uploaded, use imported.images as-is (for manual/base64)
      if (imageUrls.length === 0 && imageList.length > 0) {
        imageUrls.push(...imageList);
      }

      // Use hero_image from images array if no separate hero_image
      const primaryImage = imageUrls[0] || imported.hero_image || '';

      // Save to onboarding_data table — use upsert to handle re-onboarding (user already has a row)
      const { data: onboardingRecord, error: insertError } = await supabase
        .from('onboarding_data')
        .upsert({
          user_id: user.id,
          property_name: imported.title,
          description: imported.description,
          location: imported.location,
          price: imported.price,
          hero_image: primaryImage,
          images: imageUrls,
          host_name: imported.host_name || null,
          guests: imported.guests ? String(imported.guests) : null,
          bedrooms: imported.bedrooms ? String(imported.bedrooms) : null,
          beds: imported.beds ? String(imported.beds) : null,
          baths: imported.baths ? String(imported.baths) : null,
          rating: imported.rating ? String(imported.rating) : null,
          reviews: imported.reviews ? String(imported.reviews) : null,
        }, { onConflict: 'user_id' })
        .select()
        .single();

      if (insertError) {
        console.log('[Home] onboarding_data upsert error:', insertError.message);
      } else {
        console.log('[Home] Saved to onboarding_data, id:', onboardingRecord?.id);
      }

      // Build final image list: upload blob/base64 images to Supabase, keep existing URLs as-is
      const isDataUrl = (s: string) => s.startsWith('data:');
      const finalUrls: string[] = imageUrls.length > 0
        ? imageUrls
        : (imageList || []).map((img: string) => img);

      // Airbnb placeholder skip: only drop first if it's a muscache.com URL (real Airbnb scrape)
      const isAirbnbPlaceholder = (url: string) => url.includes('muscache.com');
      const realUrls = finalUrls.length > 0 && isAirbnbPlaceholder(finalUrls[0])
        ? finalUrls.slice(1)
        : finalUrls;

      // Only wipe images if we actually have new realUrls; otherwise keep existing scrapedImages
      if (realUrls.length > 0 || (scrapedImages && scrapedImages.length === 0)) {
        const newImages: PropertyImage[] = realUrls.map((url: string, idx: number) => ({
          id: `scraped-${Date.now()}-${idx}`,
          property_id: 'scrape', // placeholder — will be replaced with real property_id on publish
          url,
          position: idx + 1,
          is_featured: idx === 0,
          is_main: idx === 0,
          is_background: false,
          created_at: new Date().toISOString(),
        }));
        setScrapedImages(newImages);
      }
      // Map each field to the correct target:
      // - property_headline  → ImageGallery hero text (first sentence, set in ImageGallery via property?.property_headline)
      // - property_intro     → ImageGallery description below gallery (first 3 sentences / 24 words, trimmed)
      // - description        → spare/unused in ImageGallery, set to trimmed full text
      const descText = imported.description || '';
      // extractFirstSentence + extractFirst24Words helpers live in GetSite — re-implement here minimally
      const firstPeriod = descText.indexOf('.');
      const heroHeadline = firstPeriod > 0 && firstPeriod < 120
        ? descText.slice(0, firstPeriod + 1).trim()
        : descText.slice(0, 120).trim();
      // First 3 sentences, max 24 words
      const sentences = descText.split(/(?<=[.!?])\s+/).filter(s => s.trim());
      const words: string[] = [];
      let wordCount = 0;
      outer: for (const sentence of sentences) {
        for (const word of sentence.trim().split(/\s+/)) {
          if (wordCount >= 24) break outer;
          words.push(word); wordCount++;
        }
      }
      let intro24 = words.join(' ');
      if (wordCount >= 24 && !/[.!?]$/.test(intro24)) {
        const lp = Math.max(intro24.lastIndexOf('.'), intro24.lastIndexOf('!'), intro24.lastIndexOf('?'));
        if (lp > 0) intro24 = intro24.slice(0, lp + 1);
      }
      intro24 = intro24.trim();
      // property_headline from imported.property_title (if set by GetSite) or infer from title length
      const isHeadline = (imported.title || '').length > 12;
      const property_headline = (imported as any).property_title || (isHeadline ? imported.title : property?.property_headline || '');
      console.log('[Home] setScrapedProperty:', { property_headline, property_intro: intro24, title: imported.title });
      setScrapedProperty({
        // NOTE: do NOT set id to property?.id — that points to the old demo property.
        // A real id will be assigned when the site is published.
        title: imported.title || property?.title || '',
        // description = 24-word teaser → ImageGallery hero-image overlay
        // property_intro = full original text → PropertyDetails below-photos section
        // (must match the mapping migrate-property/save-site-records use on publish,
        // and what ImageGallery.tsx / PropertyDetails.tsx read post-publish)
        description: intro24,
        property_title: property_headline,
        property_intro: descText.replace(/\s+/g, ' ').trim(),
        property_headline: property_headline,  // ImageGallery reads property?.property_headline for hero text
        location: imported.location || property?.location || '',
        price_per_night: imported.price || property?.price_per_night || null,
        max_guests: imported.guests || property?.max_guests || null,
      });


    } catch (err) {
      console.error('[Home] handleImportedImages error:', err);
    }
  };

  const handlePopupClose = () => {
    // Reset scraped data so popup mounts fresh next time
    setScrapedProperty(null);
    setScrapedImages([]);
    setResetKey(k => k + 1);
  };

  const handleBookingSubmit = async (bookingData: {
    start_date: string;
    end_date: string;
    guest_count: number;
    total_price: number;
    special_requests?: string;
  }) => {
    if (!user) return;
    const targetPropertyId = scrapedProperty?.id || property?.id;
    if (!targetPropertyId) return;
    const { error } = await supabase
      .from('bookings')
      .insert({ property_id: targetPropertyId, user_id: user.id, ...bookingData });
    if (error) throw error;
    const { data: updatedBookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('*')
      .eq('property_id', targetPropertyId)
      .in('status', ['approved', 'pending']);
    if (bookingsError) throw bookingsError;
    setBookings(updatedBookings || []);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner-ring" />
      </div>
    );
  }

  const displayProperty = scrapedProperty || property;
  if (error || !displayProperty) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="h2-on-light">
            {error || 'Property not found'}
          </h2>
          <p className="mt-2 body-on-light">Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <ImageGallery
        images={scrapedImages.length > 0 ? scrapedImages : images}
        property={scrapedProperty || property}
        isEditing={isEditing}
        isAdmin={user?.role === 'admin'}
        onImageUpload={user?.role === 'admin' ? handleImageUpload : undefined}
        onImageDelete={user?.role === 'admin' ? handleImageDelete : undefined}
        onImageUpdate={user?.role === 'admin' ? handleImageUpdate : undefined}
        onPropertyUpdate={user?.role === 'admin' ? handlePropertyUpdate : undefined}
        registerSaveHandler={(fn) => { imageGallerySaveRef.current = fn; return true; }}
      />

      <div className="section-mt-neg bg-black section-padding">
        <PropertyDetails
          property={scrapedProperty || property}
          isEditing={isEditing}
          onEditingChange={setIsEditing}
          onSave={user?.role === 'admin' ? handlePropertyUpdate : undefined}
          onBeforeSave={imageGallerySaveRef.current ?? undefined}
          onHasChanges={onHasChanges}
          trackDirty={trackDirty}
        />

        <div className="amenities-bg">
          <div
            className={`absolute inset-0 bg-cover bg-center amenities-bg-layer ${backgroundImages[0] ? 'bg-layer-visible' : 'bg-layer-hidden'}`}
            style={backgroundImages[0] ? ({ '--bg-image': `url('${backgroundImages[0].url}')` } as React.CSSProperties) : undefined}
          ></div>
          <div className="relative">
            <PropertyAmenities
              property={scrapedProperty || property}
              isEditing={isEditing}
              onHasChanges={onHasChanges}
              onUpdate={handlePropertyUpdate}
              trackDirty={trackDirty}
            />
            <div id="calendar-section" className="amenities-content pb-5">
              <BookingCalendar
                bookings={bookings}
                blockedDates={blockedDates}
                propertyId={property.id}
                property={property}
                pricePerNight={property.price_per_night}
                maxGuests={property.max_guests}
                isEditing={isEditing}
                onBookingSubmit={handleBookingSubmit}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Guest Booking Section ── Only on published property pages, for guests ── */}
      {!isEditing && (window as any).__PROPERTY_DATA__?.id && !isGuest && user && (
        <div className="py-16 px-4 brand-cta-section">
          <div className="max-w-md mx-auto">
            <p className="eyebrow-on-dark mb-2 text-center">Welcome</p>
            <h2 className="h2-on-dark mb-1 text-center">Book your stay</h2>
            <p className="body-on-dark mb-6 text-center">Sign in to request a booking at this property</p>
            <button
              onClick={() => setShowGuestAuth(true)}
              className="w-full bg-white hover:bg-gray-100 text-indigo-600 font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              Sign in to book
            </button>
          </div>
        </div>
      )}

      {!isEditing && (window as any).__PROPERTY_DATA__?.id && isGuest && (
        <div className="py-16 px-4 bg-gray-50">
          <div className="max-w-md mx-auto">
            <h2 className="h2-on-light mb-1">Request a Booking</h2>
            <p className="body-on-light mb-6">You're signed in as a guest at this property</p>
            <GuestBookingRequest
              propertyId={(window as any).__PROPERTY_DATA__.id}
              propertyName={(window as any).__PROPERTY_DATA__.name || (window as any).__PROPERTY_DATA__.title}
              pricePerNight={parseFloat((window as any).__PROPERTY_DATA__.price_per_night) || 0}
              maxGuests={parseInt((window as any).__PROPERTY_DATA__.max_guests) || 8}
            />
          </div>
        </div>
      )}

      <div className="reviews-section relative reviews-bg">
        <div
          className={`absolute inset-0 bg-cover bg-center reviews-bg-layer ${backgroundImages[1] ? 'bg-layer-visible' : 'bg-layer-hidden'}`}
          style={backgroundImages[1] ? ({ '--bg-image': `url('${backgroundImages[1].url}')` } as React.CSSProperties) : undefined}
        ></div>
        <div className="content-container relative">
          <div>
            <h1 className="reviews-section-heading">What our guests say</h1>
          </div>
          <ReviewsList key={reviewsRefreshKey} showStars={isEditing} isEditing={isEditing} propertyId={property?.id || ''} />
          {!isEditing && (
            <div className="review-btn-wrap">
              <button
                onClick={() => setShowReviewModal(true)}
                className="review-btn"
              >
                Leave a review
              </button>
            </div>
          )}
        </div>
      </div>

      {showReviewModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="sb-panel-bg rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 sb-panel-bg border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="review-modal-title">Leave a Review</h2>
            </div>
            <div className="p-6">
              <ReviewForm propertyId={property?.id || ''} onSuccess={() => { setShowReviewModal(false); setReviewsRefreshKey(k => k + 1); }} />
            </div>
          </div>
        </div>
      )}

      {/* OnboardingPopup disabled — GetSite (App.tsx) handles the same flow via sidebar button */}
      {/* <OnboardingPopup
        key={resetKey}
        onImported={handleImportedImages}
        onClose={() => { handlePopupClose(); onOnboardingClose?.(); }}
        defaultProperty={defaultProperty}
        defaultImages={defaultImages}
        scrapedProperty={scrapedProperty}
        scrapedImages={scrapedImages}
        onSiteNameChange={onSiteNameChange}
        onComplete={undefined}
        onOpenSidebar={onOpenSidebar}
        forceOpen={forceOpenOnboarding}
        onSiteCreated={(propertyId, siteUrl) => {
          if (onOpenSidebar) onOpenSidebar();
        }}
      /> */}

      <GuestAuthModal
        isOpen={showGuestAuth}
        onClose={() => setShowGuestAuth(false)}
        propertyId={(window as any).__PROPERTY_DATA__?.id || ''}
        onSuccess={() => {
          setShowGuestAuth(false);
          // Re-check guest status now that they're signed up
          if (user && property?.id) {
            setIsGuest(true);
          }
        }}
      />
    </div>
  );
}
