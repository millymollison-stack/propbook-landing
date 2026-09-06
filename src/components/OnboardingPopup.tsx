import React, { useState, useEffect, useRef } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import './styles.css';
import './OnboardingPopup.css';
import { TemplatePreview } from './TemplatePreview';
import { FontDropdown } from './FontDropdown';
import { FONT_OPTIONS, applyFontAccent } from '../lib/fontAccent';
import { supabase, supabaseAdmin } from '../lib/supabase';
import { saveBrandColor } from '../lib/brandColor';

import { useAuth } from '../store/auth';
import { StripeConnectSetup } from './StripeConnectSetup';
import { createSlug } from '../services/slugService';

// Color utility: adjust hex brightness
function adjustBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + Math.round(2.55 * percent)));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + Math.round(2.55 * percent)));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + Math.round(2.55 * percent)));
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export interface OnboardingPopupProps {
 onComplete?: (data: any) => void;
 onImported?: (data: any) => void;
 onClose?: () => void;
 scrapedProperty?: any | null;
 onSiteNameChange?: (name: string) => void;
 scrapedImages?: any[];
 onOpenSidebar?: () => void;
 forceOpen?: boolean;
}

// Persisted flag: survives across remounts (key changes) so user-closed state is not lost
const POPUP_CLOSED_KEY = 'onboarding_popup_closed'; // localStorage — persists across page reloads

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert any string to a URL-safe slug */
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s-]/g, '')     // remove non-alphanumeric (keep spaces/hyphens)
    .trim()
    .replace(/\s+/g, '-')             // spaces → hyphens
    .replace(/-+/g, '-');              // collapse multiple hyphens
}

// ── Stripe CheckoutForm (must be inside <Elements> context) ─────────────────
function CheckoutForm({ clientSecret, onSuccess, onError, monthlyTotal }: {
  clientSecret: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
  monthlyTotal: number;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);

    // Must call submit() before confirmPayment() per Stripe.js v3 migration
    await elements.submit();

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: (window.location.origin.replace(/\/$/, '')) + '/?paid=true&session_id={CHECKOUT_SESSION_ID}' },
      redirect: 'if_required',
    });

    setProcessing(false);
    if (error) {
      console.error('[Stripe confirmPayment error]', error.code, error.type, error.message);

      // Handle PaymentIntent in unexpected state (e.g. already confirmed, failed, etc.)
      // On retry with the same clientSecret, Stripe returns 400 because the PI is no longer
      // in a confirmable state. Request a fresh PaymentIntent from the edge function.
      if (error.type === 'card_error' &&
          (error.code === 'payment_intent_unexpect_state' || error.code === 'payment_intent_invalid_state')) {
        // Call the parent to create a new checkout session and get a fresh clientSecret
        onError('RETRY_NEEDED');
        return;
      }

      onError(error.message || 'Payment failed.');
    } else {
      onSuccess();
      window.dispatchEvent(new CustomEvent('subscription-updated'));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="stripe-checkout-form">
      <div className="stripe-card-label">
        <div className="stripe-card-title">Card details</div>
        <p className="stripe-consent-note">By clicking Pay, you allow propbook.pro to charge your card for the amount shown, according to the terms of your subscription.</p>
        <div className="stripe-card-field">
          <PaymentElement options={{ layout: 'tabs' }} />
        </div>
      </div>
      <button
        type="submit"
        disabled={!stripe || processing}
        className="btn"
        style={{ width: '100%', fontSize: '1rem' }}
      >
        {processing ? 'Processing subscription...' : `Pay ${monthlyTotal === 0 ? 'Free today' : `$${monthlyTotal}`}`}
      </button>
    </form>
  );
}

export function OnboardingPopup({ onComplete, onImported, onClose, scrapedProperty, scrapedImages, onSiteNameChange, onOpenSidebar, onSiteCreated, forceOpen }: OnboardingPopupProps) {
 const { user, refreshUser } = useAuth();
 const [isOpen, setIsOpen] = useState(false);
 // Tracks whether this popup instance is still mounted (used to cancel auto-open timer on unmount)
 const isMountedRef = { current: true };
 const descSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

 // Inline auth state
 const [authEmail, setAuthEmail] = useState('');
 const [authPassword, setAuthPassword] = useState('');
 const [authFullName, setAuthFullName] = useState('');
 const [authPhone, setAuthPhone] = useState('');
 const [authError, setAuthError] = useState('');
 const [authLoading, setAuthLoading] = useState(false);

 const handleSignUp = async () => {
   if (!authEmail || !authPassword || !authFullName) {
     setAuthError('Please fill in all fields.');
     return;
   }
   setAuthLoading(true);
   setAuthError('');
   try {
     const { data: { user: newUser }, error } = await supabase.auth.signUp({
       email: authEmail,
       password: authPassword,
       options: { data: { full_name: authFullName, phone_number: authPhone } },
     });
     if (error) throw error;
     if (newUser) {
       const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
         id: newUser.id,
         email: authEmail,
         full_name: authFullName,
         phone_number: authPhone,
         role: 'admin',
       }, { onConflict: 'id' });
       if (profileError) console.error('[handleSignUp] profile error:', profileError);
       setAccountCreated(true);
       await refreshUser();
     }
   } catch (e: any) {
     console.error('[handleSignUp] error:', e?.message || e?.code || JSON.stringify(e));
     setAuthError(e.message || 'Could not create account.');
   } finally {
     setAuthLoading(false);
   }
 };

 const handleSignIn = async () => {
   if (!authEmail || !authPassword) {
     setAuthError('Please enter your email and password.');
     return;
   }
   setAuthLoading(true);
   setAuthError('');
   try {
     const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
     if (error) throw error;
     await refreshUser();
     setAccountCreated(false);
   } catch (e: any) {
     setAuthError(e.message || 'Could not sign in. Check your credentials.');
   } finally {
     setAuthLoading(false);
   }
 };

 const [bookingsEmail, setBookingsEmail] = useState('');
 const [bankChoice, setBankChoice] = useState('');
 const [designChoice, setDesignChoice] = useState('');
 const [websiteName, setWebsiteName] = useState('');
 const [websiteDesc, setWebsiteDesc] = useState('');
 const [descInitialized, setDescInitialized] = useState(false);
 const [hostingChoice, setHostingChoice] = useState('');
 const [planChoice, setPlanChoice] = useState('');
 const [extras, setExtras] = useState({ seo: false, ads: false, analytics: false, social: false });
 const [agreed, setAgreed] = useState(false);
 const [stripeError, setStripeError] = useState('');
 const openStripeGateway = async (e?: React.MouseEvent) => {
  if (e) e.stopPropagation();
  console.log('[openStripeGateway] running...');
  // Clear any stale Stripe redirect state from previous page loads
  sessionStorage.removeItem('stripe_payment_returning');
  sessionStorage.removeItem('stripe_redirect_initiated');
  sessionStorage.removeItem('stripe_migration_done');  // allow fresh migration on new payment
  // Re-save popup_website_name from current React state so it's fresh when we return from Stripe
  sessionStorage.setItem('popup_website_name', websiteName);
  console.log('[openStripeGateway] clicked, user:', !!user, 'planChoice:', planChoice);
   if (!user) {
     setStripeError('Please sign in or create an account above first.');
     return;
   }
   if (!planChoice) {
     setStripeError('Please select a subscription plan first.');
     return;
   }
   setStripeError('');

   // Validate required fields before calling edge function
   const slugValue = generateSlug(websiteName) || 'mysite';
   const userIdValue = user?.id;
   if (!userIdValue) {
     setStripeError('User not authenticated. Please sign in again.');
     return;
   }
   console.log('[openStripeGateway] validated - userId:', userIdValue, 'slug:', slugValue);

   // Save form data before redirecting to Stripe so we can restore it on return
   try {
     await saveToSupabase();
     console.log('[openStripeGateway] saveToSupabase done');
   } catch(e) {
     console.error('[openStripeGateway] saveToSupabase failed:', e);
     // Continue anyway - payment is more important than saving form data
     console.log('[openStripeGateway] continuing without save...');
   }

   // Timeout wrapper - if fetch takes >15s, treat as network error
   const fetchWithTimeout = (url: string, opts: RequestInit, timeoutMs = 15000) =>
     Promise.race([
       fetch(url, opts),
       new Promise((_, reject) => setTimeout(() => reject(new Error('fetch timeout')), timeoutMs)),
     ]);

   try {
     const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
     const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

     const activeExtras: string[] = [];
     if (extras.seo) activeExtras.push('seo');
     if (extras.ads) activeExtras.push('ads');
     if (extras.analytics) activeExtras.push('analytics');
     if (extras.social) activeExtras.push('social');

     const sessionResult = await supabase.auth.getSession();
     console.log('[openStripeGateway] session token:', sessionResult.data.session?.access_token ? 'present' : 'MISSING');

     console.log('[openStripeGateway] calling edge function...');
     const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/stripe-subscription`, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${sessionResult.data.session?.access_token}`,
         'Apikey': supabaseAnonKey,
       },
       body: JSON.stringify({
         action: 'create_checkout_session',
         plan: planChoice,
         hosting_choice: hostingChoice,
         extras: activeExtras,
         include_scrape: designChoice === 'airbnb',
         email: user.email,
         user_id: userIdValue,
         slug: slugValue, // needed for post-payment deploy trigger
         return_url: (window.location.origin.replace(/\/$/, '')) + '/?paid=true&session_id={CHECKOUT_SESSION_ID}',
       }),
     });
     console.log('[openStripeGateway] response:', res.status, res.ok);
     const data = await res.json();
     console.log('[openStripeGateway] data:', JSON.stringify(data));

     // Guard: ensure session was actually created before redirecting to Stripe
     if (!data.sessionId || !data.url) {
       const errMsg = data.error || (res.ok ? 'No checkout session created. Please try again.' : `Server error: ${res.status}`);
       console.error('[openStripeGateway] ❌ Checkout session missing:', errMsg);
       setStripeError(errMsg);
       setStripeProcessing(false);
       return;
     }

     // Persist session_id so the ?paid=true handler survives Vite HMR reloads
     // that can fire after the Stripe redirect and wipe URL params
     // Guard against the literal string "undefined" which can happen if Stripe
     // returns a malformed response
     const safeSessionId = String(data.sessionId ?? '');
     if (!safeSessionId || safeSessionId === 'undefined') {
       setStripeError('Payment session could not be created. Please try again.');
       setStripeProcessing(false);
       return;
     }
     sessionStorage.setItem('stripe_session_id', safeSessionId);
     sessionStorage.setItem('stripe_redirect_initiated', myTabId);
     sessionStorage.setItem('stripe_original_pathname', window.location.pathname);
     console.log('[DEBUG] stripe_session_id saved=', safeSessionId, ', redirect href=', data.url);
     window.location.href = data.url;
   } catch(e: any) {
     console.error('[openStripeGateway] error:', e.message || e);
     setStripeError(e.message === 'fetch timeout'
       ? 'Connection timed out. Check your network and try again.'
       : 'Could not connect to payment server.');
   } finally {
   }
 };

 const [showStripeModal, setShowStripeModal] = useState(false);
 const [stripeClientSecret, setStripeClientSecret] = useState('');
 const [stripePayMethod, setStripePayMethod] = useState<'card' | 'paypal' | 'venmo'>('card');
 const [stripeSubscriptionId, setStripeSubscriptionId] = useState('');
 const [showCongrats, setShowCongrats] = useState(false);
 const [congratsUrl, setCongratsUrl] = useState('');
 const [showBuilding, setShowBuilding] = useState(false);
 const [buildingCountdown, setBuildingCountdown] = useState(120);
 const [deployUrl, setDeployUrl] = useState('');
 const [stripeProcessing, setStripeProcessing] = useState(false);
 const [accountCreated, setAccountCreated] = useState(false);
 const [popupConnectAccountId, setPopupConnectAccountId] = useState<string | null>(null);
 const [savingSite, setSavingSite] = useState(false);
 const [showSaveOverlay, setShowSaveOverlay] = useState(false);

 // Auto-reload after 5 seconds when saving overlay is shown
 useEffect(() => {
   if (!showSaveOverlay) return;
   const timer = setTimeout(() => {
     window.location.reload();
   }, 5000);
   return () => clearTimeout(timer);
 }, [showSaveOverlay]);

 // ── Listen for Stripe Connect account ID broadcast from sidebar ─────────────
 useEffect(() => {
   const handler = (e: Event) => {
     const d = (e as CustomEvent).detail;
     if (d?.account_id) setPopupConnectAccountId(d.account_id);
   };
   window.addEventListener('stripe-connect-updated', handler);
   return () => window.removeEventListener('stripe-connect-updated', handler);
 }, []);
 const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

 // Payment calculator
 const pricing = {
 scrape: 10, // one-time Airbnb scrape fee
 plans: { starter: 10, pro: 30, agency: 150 },
 hosting: { own: 0, our: 5 },
 extras: { seo: 10, ads: 30, analytics: 20, social: 50 },
 };
 const scrapeFee = designChoice === 'airbnb' ? pricing.scrape : 0;

 const fontOptions = FONT_OPTIONS;
 // First month free credit for Starter plan - stored in cents so it matches pricing.plans values
 const TRIAL_CREDIT = planChoice === 'starter' ? (pricing.plans.starter * 100) : 0;

 // Load saved font accent on mount
 useEffect(() => {
 const saved = localStorage.getItem('site-font-accent');
 if (saved) {
 setFontAccent(saved);
 applyFontAccent(saved);
 }
 }, []);

 const monthlyTotal = (pricing.plans[planChoice as keyof typeof pricing.plans] || 0)
 + (pricing.hosting[hostingChoice as keyof typeof pricing.hosting] || 0)
 + (extras.seo ? pricing.extras.seo : 0)
 + (extras.ads ? pricing.extras.ads : 0)
 + (extras.analytics ? pricing.extras.analytics : 0)
 + (extras.social ? pricing.extras.social : 0);

 // Amount shown in banner (after trial credit for Starter)
 const displayedTotal = scrapeFee + Math.max(0, monthlyTotal - (TRIAL_CREDIT / 100));
 const hasPlan = !!planChoice;
 const hasScrape = designChoice === 'airbnb';

 // Airbnb scrape state
 const [airbnbUrl, setAirbnbUrl] = useState('');
 const [isImporting, setIsImporting] = useState(false);
 const [countdown, setCountdown] = useState(0);
 const [importError, setImportError] = useState('');
 const [scrapedData, setScrapedData] = useState<any>(null);
 const [showColorPicker, setShowColorPicker] = useState(false);
 const [brandColor, setBrandColor] = useState('#C47756');
 const [fontAccent, setFontAccent] = useState(
 typeof window !== 'undefined' ? localStorage.getItem('site-font-accent') || 'Playfair Display' : 'Playfair Display'
 );
 const [manualImages, setManualImages] = useState<string[]>([]);
 const [manualHeroImage, setManualHeroImage] = useState('');
 const [manualBase64Images, setManualBase64Images] = useState<string[]>([]);

 // Apply saved font accent on mount
 useEffect(() => {
 document.querySelectorAll('h1').forEach(el => {
 (el as HTMLElement).style.fontFamily = `'${fontAccent}', serif`;
 });
 }, []);

 const fileToBase64 = (file: File): Promise<string> =>
 new Promise((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = () => resolve(reader.result as string);
 reader.onerror = reject;
 reader.readAsDataURL(file);
 });


 // Initialize form fields from scraped property data passed from Home
 // NOTE: We do NOT pre-fill websiteName from scraped data - the user's typed
 // Website Name field is the one source of truth for the slug and must not be
 // overwritten by a scrape result. The slug is saved to popup_user_website_name
 // at Subscribe-click time, before any async scrape can change React state.

 const handleClose = () => {
 localStorage.setItem(POPUP_CLOSED_KEY, '1');
 setIsOpen(false);
 if (onClose) onClose();
 };

 // ── loadSavedData ───────────────────────────────────────────────────────────────────
 // Extracted to component scope so it can be called from the ?paid=true handler
 // after Stripe returns, ensuring migration property data is loaded even when
 // scrapedProperty/scrapedImages deps haven't changed.
 async function loadSavedData() {
 // If parent has fresh scraped data, use it instead of stale saved data
 if (scrapedProperty) {
 const imgs = scrapedImages?.map((img: any) => img.url) || [];
 // Restore user's ORIGINAL website name (saved before scrape could overwrite it).
 // Use popup_user_website_name first, then fall back to scraped title.
 const userTypedName = sessionStorage.getItem('popup_user_website_name');
 setWebsiteName(userTypedName || scrapedProperty.property_title || scrapedProperty.title || '');
 setScrapedData({
 title: scrapedProperty.property_title || scrapedProperty.title || '',
 location: scrapedProperty.location || '',
 description: scrapedProperty.property_intro || scrapedProperty.description || '',
 hero_image: imgs[0] || '',
 images: imgs,
 guests: scrapedProperty.max_guests || null,
 rating: null,
 reviews: null,
 host_name: null,
 });
 // NO AUTO-OPEN — popup only opens via forceOpen prop or manual trigger
 return;
 }

        // Skip restoring old pre-Stripe scraped data if we just completed a payment —
        // the migration block below (or in the IIFE) will set fresh migrated scrapedData.
        const savedScraped = sessionStorage.getItem('popup_scraped_data');
        if (savedScraped && !sessionStorage.getItem('stripe_payment_returning')) {
          try {
            const parsed = JSON.parse(savedScraped);
            setScrapedData(parsed);
            // Restore user's typed website name first, fall back to scraped title
            const userTyped = sessionStorage.getItem('popup_user_website_name');
            if (parsed.title) setWebsiteName(userTyped || parsed.title);
            if (parsed.description) setWebsiteDesc(parsed.description.slice(0, 200));
          } catch { /* ignore corrupt JSON */ }
        }

        // ── After restoring all form fields, handle post-Stripe success ──────────
        // NOTE: Popup open is handled by the ?paid=true useEffect below (stripe_paid_returning).
        // This block only loads data — does NOT call setIsOpen to avoid auto-open on page load.
        if (sessionStorage.getItem('stripe_payment_done')) {
          sessionStorage.removeItem('stripe_payment_done');
          setShowCongrats(true);
          const restoredName = sessionStorage.getItem('popup_website_name') || 'surfhousebaja';
          if (onImported) {
            onImported({ title: restoredName, description: sessionStorage.getItem('popup_website_desc') || '' });
          }

          // ── Load the user's own onboarding_data (scraped staging record) ────
          // Previously this loaded a hardcoded demo property (03fccab6) that no longer
          // exists. Now load the user's own record so scraped images/data populate the
          // migration popup. Falls through to the onboarding_data restore below.
          if (user?.id) {
            const { data: od } = await supabase
              .from('onboarding_data')
              .select('scraped_title, scraped_location, scraped_description, scraped_hero_image, scraped_images, scraped_guests, scraped_rating, scraped_reviews, hero_image, images, location, property_desc, bedrooms, beds, baths')
              .eq('user_id', user.id)
              .maybeSingle();
            if (od && (od.scraped_hero_image || od.hero_image || (od.scraped_images && od.scraped_images.length > 0) || (od.images && od.images.length > 0))) {
              const heroImg = od.scraped_hero_image || od.hero_image || '';
              const imgList = od.scraped_images || od.images || [];
              setScrapedData({
                title: od.scraped_title || restoredName || '',
                location: od.scraped_location || od.location || '',
                description: od.scraped_description || od.property_desc || '',
                hero_image: heroImg,
                images: imgList,
                guests: od.scraped_guests || null,
                bedrooms: od.bedrooms || null,
                beds: od.beds || null,
                baths: od.baths || null,
                rating: od.scraped_rating || null,
                reviews: od.scraped_reviews || null,
              });
            }
          }
        }


 // Restore form field selections from sessionStorage (from before Stripe redirect)
 const savedPlan = sessionStorage.getItem('popup_plan');
 if (savedPlan) setPlanChoice(savedPlan);
 const savedHosting = sessionStorage.getItem('popup_hosting');
 if (savedHosting) setHostingChoice(savedHosting);
 const savedDesign = sessionStorage.getItem('popup_design');
 if (savedDesign) setDesignChoice(savedDesign);
 const savedName = sessionStorage.getItem('popup_website_name');
 if (savedName) setWebsiteName(savedName);
 const savedDesc = sessionStorage.getItem('popup_website_desc');
 if (savedDesc) setWebsiteDesc(savedDesc);
 const savedExtras = sessionStorage.getItem('popup_extras_seo');
 if (savedExtras) setExtras({ seo: savedExtras === 'true', ads: sessionStorage.getItem('popup_extras_ads') === 'true', analytics: sessionStorage.getItem('popup_extras_analytics') === 'true', social: sessionStorage.getItem('popup_extras_social') === 'true' });

 try {
 const { data, error } = await supabase
 .from('onboarding_data')
 .select('*')
 .eq('user_id', user?.id || '')
 .maybeSingle();

 if (error && error.code !== 'PGRST116') {
 console.warn('Could not load saved onboarding data:', error.message);
 return;
 }

 if (data) {
 // Populate form fields from saved data
 if (data.property_name) setWebsiteName(data.property_name);
 if (data.property_desc) setWebsiteDesc(data.property_desc);
 if (data.airbnb_url) setAirbnbUrl(data.airbnb_url);
 if (data.design_choice) setDesignChoice(data.design_choice);
 if (data.bank_choice) setBankChoice(data.bank_choice);
 if (data.hosting_choice) setHostingChoice(data.hosting_choice);
 if (data.plan_choice) setPlanChoice(data.plan_choice);
 if (data.bookings_email) setBookingsEmail(data.bookings_email);

 // Reconstruct scrapedData from saved fields (supports both old non-prefixed fields
 // and new scraped_* fields saved by handleAirbnbScrape)
 const heroImg = data.scraped_hero_image || data.hero_image || '';
 const imgList = data.scraped_images || data.images || [];
 if (heroImg || imgList.length > 0) {
 setScrapedData({
 title: data.scraped_title || data.property_name || '',
 location: data.scraped_location || data.location || '',
 description: data.scraped_description || data.property_desc || '',
 price: data.price || '',
 hero_image: heroImg,
 images: imgList,
 guests: data.scraped_guests || data.guests || null,
 bedrooms: data.bedrooms || null,
 beds: data.beds || null,
 baths: data.baths || null,
 rating: data.scraped_rating || data.rating || null,
 reviews: data.scraped_reviews || data.reviews || null,
 host_name: data.host_name || null,
 });
 }
 }
 } catch (err) {
 console.warn('Supabase load error (table may not exist yet):', err);
 }
 }

 // Keep calling loadSavedData when scrapedProperty/scrapedImages change
 useEffect(() => {
 loadSavedData();
 }, [scrapedProperty, scrapedImages]);

 // Sync websiteName to header AND to New Site Template
 useEffect(() => {
 if (!onSiteNameChange) return;
 // Strip ALL leading @ to ensure no double-ups (handles both fresh input and sidebar echo-back)
 const display = websiteName.replace(/^@+/, '').trim().length > 0
 ? '@' + websiteName.replace(/^@+/, '').trim().slice(0, 20)
 : '@surfhousebaja';
 onSiteNameChange(display);
 }, [websiteName, onSiteNameChange]);

 // Sync name to header (immediate) and template (on change - real-time)
 const handleNameChange = (val: string) => {
 // Strip any leading @ so we never double it up when the sidebar prepends one
 const cleaned = val.startsWith('@') ? val.slice(1) : val;
 setWebsiteName(cleaned);
 // Persist immediately so Stripe redirect can't lose the user's typed input
 sessionStorage.setItem('popup_website_name', cleaned);
 sessionStorage.setItem('popup_user_website_name', cleaned);
 };
 const handleDescChange = (val: string) => {
 setWebsiteDesc(val);
 // Debounce the preview sync so typing keeps up - fire every 1s of inactivity
 clearTimeout(descSyncTimer.current);
 descSyncTimer.current = setTimeout(() => {
 if (onImported) onImported({ title: websiteName.trim() || 'surfhousebaja', description: val });
 }, 1000);
 };
 const handleNameBlur = () => {
 if (onSiteNameChange) {
 // Strip ALL leading @ to ensure we never double up, no matter where the value came from
 const stripped = websiteName.replace(/^@+/, '');
 const display = stripped.trim().length > 0 ? '@' + stripped.trim().slice(0, 20) : '@surfhousebaja';
 onSiteNameChange(display);
 }
 if (onImported) {
 onImported({ title: websiteName.trim() || 'surfhousebaja', description: websiteDesc });
 }
 };
 const handleDescBlur = () => {
 if (onImported) {
 onImported({ title: websiteName.trim() || 'surfhousebaja', description: websiteDesc });
 }
 };

 // Sync description to template (fires independently, no stale name capture)
 // Popup only opens via forceOpen prop (from sidebar button) or manual trigger.
 // No auto-open on page load.
 useEffect(() => {
 isMountedRef.current = true;
 if (forceOpen && !localStorage.getItem(POPUP_CLOSED_KEY)) {
 setIsOpen(true);
 }
 return () => { isMountedRef.current = false; };
 }, [forceOpen]);

 // Handle return from Stripe Connect onboarding - ?return_url or ?stripe_connect_return in URL
 useEffect(() => {
 const params = new URLSearchParams(window.location.search);
 const hasConnectReturn = params.has('return_url') || params.has('stripe_connect_return');
 if (!hasConnectReturn) return;

 // Clear params from URL without reload
 const url = new URL(window.location.href);
 url.searchParams.delete('return_url');
 url.searchParams.delete('stripe_connect_return');
 window.history.replaceState({}, '', url.toString());

 // Show the popup if not already open and display success message
 // Respect the user's choice to keep the popup closed
 if (!isOpen && !localStorage.getItem(POPUP_CLOSED_KEY)) setIsOpen(true);
 // Set a flag so the Banking section step shows success state
 setShowStripeConnectSuccess(true);
 }, []);

 const [myTabId] = useState(() => Math.random().toString(36).slice(2, 10));
 const [showStripeConnectSuccess, setShowStripeConnectSuccess] = useState(false);

// ── Countdown timer for building/redirect screen ──────────────────────────
 useEffect(() => {
   if (!showBuilding) return;
   const interval = setInterval(() => {
     setBuildingCountdown(prev => {
       if (prev <= 1) {
         clearInterval(interval);
         return 0;
       }
       return prev - 1;
     });
   }, 1000);
   return () => clearInterval(interval);
 }, [showBuilding]);

 useEffect(() => {
   // Redirect when countdown hits 0 (site should be ready by then)
   // Guard: don't redirect if auth isn't ready - stay on page so the handler
   // can re-fire once user resolves and complete the site creation
   if (showBuilding && buildingCountdown === 0) {
     if (!user) {
       console.warn('[DEBUG building] Countdown expired but user not loaded - NOT redirecting, waiting for auth');
       return;
     }
     console.warn('[DEBUG building] Countdown expired - redirecting to fallback');
     window.location.href = 'https://www.propbook.pro/';
   }
 }, [showBuilding, buildingCountdown, user]);

 // ── Handle Stripe return redirect ( ?paid=true&session_id= ) ────────────────
 // ALSO fires automatically when webhook has already set stripe_subscription_status=active.
 useEffect(() => {
  // CAPTURE URL PARAMS FIRST (before any async work or early returns).
  // When Supabase Auth completes, it may strip URL params from the address bar.
  // main.tsx saves the original URL before React mounts — read from there as fallback.
  const earliestUrl = sessionStorage.getItem('__earliest_url') || '';
  const earliestParams = new URLSearchParams(earliestUrl.split('?')[1] || '');

  const params = new URLSearchParams(window.location.search);
  const sessionIdFromUrl = params.get('session_id') || earliestParams.get('session_id');
  const paidFromUrl = params.get('paid') || earliestParams.get('paid');
  const sessionIdFromStorage = sessionStorage.getItem('stripe_session_id');
  const sessionId = sessionIdFromUrl || sessionIdFromStorage;

  // Persist sessionId to sessionStorage immediately so it's available after auth clears the URL
  if (sessionIdFromUrl) sessionStorage.setItem('stripe_session_id', sessionIdFromUrl);
  // Persist paid flag so this effect re-triggers reliably after auth loads the user
  if (paidFromUrl) sessionStorage.setItem('stripe_paid_returning', '1');

  // Read back flags from storage (covers the case where user logs in AFTER we saved these)
  const paidFlag = paidFromUrl || sessionStorage.getItem('stripe_paid_returning');
  const sessionIdFinal = sessionIdFromUrl || sessionIdFromStorage;

  // If no paid=true and no sessionId anywhere, nothing to do
  if (!paidFlag && !sessionIdFinal) return;

  // Already handled?
  if (sessionStorage.getItem('stripe_payment_returning')) { console.log('[DEBUG ?paid handler] Already handled — skipping'); return; }

  // No user yet? Save what we have and wait for auth to load.
  // The effect will re-fire once useAuth initializes and sets the user.
  if (!user) { console.log('[DEBUG ?paid handler] No user yet — saving flags and waiting. sessionId:', sessionIdFinal); return; }

  console.log('[DEBUG ?paid handler] EFFECT FIRED — URL:', window.location.href, '| sessionId:', sessionId, '| user:', !!user, '| paid:', paidFromUrl);

  (async () => {
    // Fresh profile read — gets latest stripe_subscription_status from webhook
    const { data: profileData } = await supabase
      .from('profiles').select('stripe_subscription_status, stripe_subscription_plan, stripe_subscription_id').eq('id', user.id).maybeSingle();
    const subStatus = profileData?.stripe_subscription_status || user?.stripe_subscription_status;
    const plan = profileData?.stripe_subscription_plan || planChoice || 'starter';

    console.log('[DEBUG ?paid handler] subStatus:', subStatus, '| sessionId:', sessionId, '| plan:', plan);

    // ── STEP 1: Verify Stripe session FIRST before doing anything else ─────────
    // This is the critical subscription verification — don't skip or skip ahead
    if (sessionId) {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const { data: { session } } = await supabase.auth.getSession();
        const slug = sessionStorage.getItem('popup_website_name') || websiteName || 'surfhousebaja';
        console.log('[DEBUG ?paid handler] 🔍 Verifying Stripe session:', sessionId);
        const sessionRes = await fetch(`${supabaseUrl}/functions/v1/stripe-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}`, 'Apikey': supabaseAnonKey },
          body: JSON.stringify({ action: 'get_session', session_id: sessionId, userId: user.id, slug }),
        });
        const sessionData = await sessionRes.json();
        console.log('[DEBUG ?paid handler] Stripe session result:', JSON.stringify(sessionData));

        if (sessionData.status !== 'complete') {
          console.error('[DEBUG ?paid handler] ❌ Payment NOT complete, status:', sessionData.status);
          setStripeError('Payment not confirmed. Status: ' + sessionData.status + '. Please contact support.');
          setStripeProcessing(false);
          // Clear URL params even on error
          window.history.replaceState({}, '', window.location.pathname);
          return;
        }

        console.log('[DEBUG ?paid handler] ✅ Payment verified! Updating profile...');
        // Update profile with verified subscription data AND upgrade to admin
        await supabase.from('profiles').update({
          stripe_subscription_status: sessionData.sub_status || 'active',
          stripe_subscription_plan: plan,
          stripe_subscription_id: sessionData.subscription_id || profileData?.stripe_subscription_id,
          stripe_customer_id: sessionData.customer_id,
          role: 'admin',
        }).eq('id', user.id);
        await supabase.auth.refreshSession();
        await refreshUser();
        console.log('[DEBUG ?paid handler] ✅ Profile updated with subscription + role=admin');
      } catch (err) {
        console.error('[DEBUG ?paid handler] ❌ Stripe verify error:', err);
        setStripeError('Could not verify payment. Please contact support.');
        setStripeProcessing(false);
        window.history.replaceState({}, '', window.location.pathname);
        return;
      }
    } else {
      // No sessionId — check if they already have an active sub
      const hasActiveSub = subStatus === 'active' || subStatus === 'trialing';
      if (!hasActiveSub) {
        console.log('[DEBUG ?paid handler] Nothing to do — no sessionId and no active sub');
        return;
      }
      console.log('[DEBUG ?paid handler] No new sessionId but active sub found, continuing...');
    }

    // ── STEP 2: Clear URL params only AFTER verification passed ───────────────
    sessionStorage.setItem('stripe_payment_returning', '1');
    // Strip any double-slashes that may have been introduced by the return_url construction
    const cleanPath = window.location.pathname.replace(/\/\/+/g, '/');
    window.history.replaceState({}, '', cleanPath);
    sessionStorage.removeItem('stripe_session_id');

    setStripeProcessing(true);
    setIsOpen(false);

    // ── STEP 3: Show overlay immediately, then save in background ───────────────
    setShowSaveOverlay(true);
    setSavingSite(true);

    // Run the heavy work (create records + migrate + deploy) without blocking the UI
    let siteResult: { propertyId: string; siteUrl: string; slug: string } | null = null;
    (async () => {
      try {
        siteResult = await handleSaveSiteInPopup(true);
        console.log('[DEBUG ?paid handler] ✅ Site saved, URL:', siteResult?.siteUrl);
        if (siteResult?.propertyId) {
          sessionStorage.setItem('home_loaded_property_id', siteResult.propertyId);
          if (onSiteCreated) onSiteCreated(siteResult.propertyId, siteResult.siteUrl);
          // Mark property as active so PUBLISH SITE button shows green
          // Also set property_id so this user is linked to their property for isolation checks
          await supabase.from('profiles').update({ website_live: true, property_id: siteResult.propertyId }).eq('id', user.id);
          await supabase.from('properties').update({ status: 'active' }).eq('id', siteResult.propertyId);
          console.log('[DEBUG ?paid handler] ✅ Property status set to active');
        }
      } catch (err) {
        console.error('[DEBUG ?paid handler] ⚠️ handleSaveSiteInPopup error:', err);
        setStripeError('Site saved but deploy may have failed. Check your sidebar.');
      } finally {
        setSavingSite(false);
        setShowSaveOverlay(false);
        // Redirect back to the original site the user came from, not the newly created site.
        // The new site is already saved and will appear in the user's sidebar.
        const originalPathname = sessionStorage.getItem('stripe_original_pathname') || '/';
        const redirectUrl = window.location.origin + originalPathname;
        console.log('[DEBUG ?paid handler] Redirecting to:', redirectUrl);
        window.location.href = redirectUrl;
      }
    })();

    console.log('[DEBUG ?paid handler] ✅ Overlay shown, save running in background');
  })();
 }, [user]);

 // Save or update onboarding data in Supabase
 const saveToSupabase = async (overrides: any = {}) => {
 if (!user) return;
 try {
 // Read FRESH scraped data from sessionStorage so we capture ALL fields the scraper
 // returned - even if the data param passed to saveToSupabase had null text fields
 // (handleAirbnbScrape passes data immediately, before React state re-render).
 const sessionScraped = (() => {
 try {
 const raw = sessionStorage.getItem('popup_scraped_data');
 return raw ? JSON.parse(raw) : null;
 } catch { return null; }
 })();
 const row = {
 user_id: user.id,
 // INPUT FIELDS WIN: the user's typed values are authoritative; the scrape is fallback only.
 property_name: sessionStorage.getItem('popup_user_website_name') || sessionStorage.getItem('popup_website_name') || websiteName || sessionScraped?.title || null,
 property_headline: sessionStorage.getItem('popup_property_headline') || null,
 property_desc: sessionStorage.getItem('popup_website_desc') || websiteDesc || sessionScraped?.description || null,
 airbnb_url: airbnbUrl,
 design_choice: designChoice,
 bank_choice: bankChoice,
 hosting_choice: hostingChoice,
 plan_choice: planChoice,
 email: user.email,
 bookings_email: bookingsEmail,
 extras: extras,
 updated_at: new Date().toISOString(),
 // Merge scraped data from sessionStorage (primary) with any overrides (allows
 // callers to pass specific fields). Only override non-empty values.
 scraped_title: (sessionScraped?.title || overrides.scraped_title) || null,
 scraped_location: (sessionScraped?.location || overrides.scraped_location) || null,
 scraped_description: (sessionScraped?.description || overrides.scraped_description) || null,
 scraped_hero_image: (sessionScraped?.hero_image || overrides.scraped_hero_image) || null,
 scraped_images: (sessionScraped?.images?.length ? sessionScraped.images : (overrides.scraped_images?.length ? overrides.scraped_images : null)),
 scraped_rating: (sessionScraped?.rating || overrides.scraped_rating) || null,
 scraped_reviews: (sessionScraped?.reviews || overrides.scraped_reviews) || null,
 scraped_guests: (sessionScraped?.guests || overrides.scraped_guests) || null,
 };

 const { error } = await supabase
 .from('onboarding_data')
 .upsert(row, { onConflict: 'user_id' });

 if (error) {
 console.warn('Supabase save error:', error.message);
 } else {
 console.log('Saved to Supabase onboarding_data');
 }
 } catch (err) {
 console.warn('Could not save to Supabase (table may not exist yet):', err);
 }
 };

 const SCRAPER_URL = 'https://airbnb-scraper-foj1.onrender.com';

 const handleAirbnbScrape = async (_e?: React.MouseEvent) => {
 if (!airbnbUrl) { setImportError('Please enter an Airbnb URL'); return; }
 setIsImporting(true);
 setImportError('');
 setCountdown(120);

 const countInterval = setInterval(() => {
 setCountdown(c => {
 if (c <= 1) { clearInterval(countInterval); return 0; }
 return Number(c) - 1;
 });
 }, 1000);

 try {
 const resp = await fetch(`${SCRAPER_URL}/scrape?url=${encodeURIComponent(airbnbUrl)}`);
 const result = await resp.json();
 clearInterval(countInterval);
 if (result.success) {
 const data = result.data;
 setScrapedData(data);
 // Persist scraped data to sessionStorage immediately so it survives Stripe redirect
 sessionStorage.setItem('popup_scraped_data', JSON.stringify(data));
 // Only pre-fill websiteName from scrape if user hasn't already typed one — they can always edit it before subscribing
 if (data.title && !websiteName.trim()) setWebsiteName(data.title);
 if (data.description) setWebsiteDesc(data.description.slice(0, 200));
 if (onImported) onImported({ ...data, hero_image: data.images?.[1] || data.hero_image });
 await saveToSupabase({
 scraped_title: data.title || null,
 scraped_location: data.location || null,
 scraped_description: data.description || null,
 scraped_hero_image: data.hero_image || null,
 scraped_images: data.images || null,
 scraped_rating: data.rating || null,
 scraped_reviews: data.reviews || null,
 scraped_guests: data.guests || null,
 });
 } else {
 setImportError('Failed to import listing. Please check the URL and try again.');
 }
 } catch (err) {
 clearInterval(countInterval);
 setImportError('Could not reach the scraper service. It may be waking up - please wait 60 seconds and try again.');
 } finally {
 setIsImporting(false);
 setCountdown(0);
 }
 };
 const handlePublish = async (_e?: React.MouseEvent) => {
   // If user already has an active subscription, save the site directly (no Stripe redirect)
   if (user?.stripe_subscription_status === 'active' || user?.stripe_subscription_status === 'trialing') {
     await handleSaveSiteInPopup();
     return;
   }
   if (!user) {
     setStripeError('Please sign in or create an account first.');
     return;
   }
   if (!planChoice) {
     setStripeError('Please select a subscription plan first.');
     return;
   }
   if (!websiteName.trim()) {
     setStripeError('Please enter a website name first.');
     return;
   }
   setStripeError('');
   setStripeProcessing(true); // disable button BEFORE async work
   await saveToSupabase();

   try {
     const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
     const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

     const activeExtras: string[] = [];
     if (extras.seo) activeExtras.push('seo');
     if (extras.ads) activeExtras.push('ads');
     if (extras.analytics) activeExtras.push('analytics');
     if (extras.social) activeExtras.push('social');

     const res = await fetch(`${supabaseUrl}/functions/v1/stripe-subscription`, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
         'Apikey': supabaseAnonKey,
       },
       body: JSON.stringify({
         action: 'create_checkout_session',
         plan: planChoice,
         hosting_choice: hostingChoice,
         extras: activeExtras,
         include_scrape: designChoice === 'airbnb',
         email: user.email,
         user_id: user.id,
         slug: websiteName, // needed for post-payment deploy trigger
         return_url: (window.location.origin.replace(/\/$/, '')) + '/?paid=true&session_id={CHECKOUT_SESSION_ID}',
       }),
     });

     const data = await res.json();

     if (!data.url) {
       setStripeError(data.error || 'Could not initialise payment. Please try again.');
       return;
     }

     // Redirect to Stripe Checkout hosted page
     // IMPORTANT: Use the user's ORIGINAL typed website name (saved BEFORE any scrape
     // could overwrite it). This is the ONE TRUE SOURCE for the slug and page title.
     sessionStorage.setItem('popup_user_website_name', websiteName);
     sessionStorage.setItem('popup_plan', planChoice);
     sessionStorage.setItem('popup_hosting', hostingChoice);
     sessionStorage.setItem('popup_design', designChoice);
     sessionStorage.setItem('popup_extras_seo', extras.seo ? 'true' : 'false');
     sessionStorage.setItem('popup_extras_ads', extras.ads ? 'true' : 'false');
     sessionStorage.setItem('popup_extras_analytics', extras.analytics ? 'true' : 'false');
     sessionStorage.setItem('popup_extras_social', extras.social ? 'true' : 'false');
     sessionStorage.setItem('popup_website_name', websiteName);
     sessionStorage.setItem('popup_website_desc', websiteDesc);
     // Pass property name to sidebar via sessionStorage
     sessionStorage.setItem('popup_property_name', scrapedData?.title || websiteName || '');
     // Persist scraped data so it survives the Stripe redirect remount
     if (scrapedData) {
       sessionStorage.setItem('popup_scraped_data', JSON.stringify(scrapedData));
     }
     console.log('[DEBUG] About to redirect to: ' + data.url);
     // Persist session_id so the ?paid=true handler survives Vite HMR reloads
     if (data.sessionId) sessionStorage.setItem('stripe_session_id', data.sessionId);
     sessionStorage.setItem('stripe_original_pathname', window.location.pathname);
     window.location.href = data.url;
   } catch {
     setStripeError('Could not connect to payment server. Please try again.');
   }
 };

 const handleSaveSiteInPopup = async (migrationMode = false) => {
   console.log('[handleSaveSiteInPopup] 🚀 START user:', user?.id, 'email:', user?.email);
   if (!user) { console.error('[handleSaveSiteInPopup] ❌ No user, returning'); return; }
   setSavingSite(true);
   const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
   const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
   console.log('[handleSaveSiteInPopup] ✅ env vars loaded:', { supabaseUrl: !!supabaseUrl, supabaseAnonKey: !!supabaseAnonKey });
   try {
     const { createNewSiteRecords, duplicateSiteAfterPayment } = await import('../services/siteDuplicationService');
     console.log('[handleSaveSiteInPopup] ✅ imported services, starting site creation...');

     // ── Resolve scrapedData with three-tier fallback ──
     // 1. React state (live, from parent props)
     // 2. sessionStorage (survives Stripe redirect remount)
     // 3. onboarding_data table (persisted for users who scraped before this fix)
     let resolvedScrapedData = scrapedData || JSON.parse(sessionStorage.getItem('popup_scraped_data') || 'null');
     if (!resolvedScrapedData) {
       const { data: od } = await supabase
         .from('onboarding_data')
         .select('scraped_title, scraped_location, scraped_description, scraped_hero_image, scraped_images, scraped_guests, scraped_rating, scraped_reviews, hero_image, images, location, property_desc, bedrooms, beds, baths')
         .eq('user_id', user.id)
         .maybeSingle();
       if (od && (od.scraped_hero_image || od.hero_image || (od.scraped_images && od.scraped_images.length > 0) || (od.images && od.images.length > 0))) {
         const heroImg = od.scraped_hero_image || od.hero_image || '';
         const imgList = od.scraped_images || od.images || [];
         resolvedScrapedData = {
           title: od.scraped_title || '',
           location: od.scraped_location || od.location || '',
           description: od.scraped_description || od.property_desc || '',
           hero_image: heroImg,
           images: imgList,
           guests: od.scraped_guests || null,
           bedrooms: od.bedrooms || null,
           beds: od.beds || null,
           baths: od.baths || null,
           rating: od.scraped_rating || null,
           reviews: od.scraped_reviews || null,
           host_name: null,
           price: '',
         };
       }
     }

     // Read scraped data from sessionStorage before building the data object
     const scrapedFromSession = (() => {
       try {
         const raw = sessionStorage.getItem('popup_scraped_data');
         return raw ? JSON.parse(raw) : null;
       } catch { return null; }
     })();

     const data = {
       email: user.email,
       userId: user.id,
       userStripeAccountId: popupConnectAccountId || null,
       bookingsEmail: user.email,
       // websiteName field - use the user's typed input from sessionStorage first (saved on every keystroke)
       websiteName: sessionStorage.getItem('popup_user_website_name')
         || sessionStorage.getItem('popup_website_name')
         || websiteName
         || user.full_name
         || 'My Property',
       websiteDesc: websiteDesc || '',
       planChoice: planChoice as 'starter' | 'pro' | 'agency',
       hostingChoice: hostingChoice as 'our' | 'own',
       designChoice: designChoice,
       extras: { seo: extras.seo, ads: extras.ads, analytics: extras.analytics, social: extras.social },
       scrapedData: resolvedScrapedData,
       bankChoice: bankChoice,
       // Slug - ONLY from the user's Website Name field (saved before any scrape could overwrite it):
       // Priority: popup_user_website_name (user's typed input, saved at Subscribe click)
       //           → od.property_name (user's saved property name from DB)
       //           → user.full_name (last resort)
       // Slug — from the user's chosen website name (not the scrape title)
       slug: createSlug(
         sessionStorage.getItem('popup_user_website_name')
         || sessionStorage.getItem('popup_website_name')
         || websiteName
         || od?.property_name
         || user.full_name
         || 'My Property'
       ),
     };
     const finalSlug = data.slug;
     console.log('[handleSaveSiteInPopup] 📝 websiteName:', websiteName, 'plan:', planChoice, 'scrapedData images count:', resolvedScrapedData?.images?.length, 'userWebsiteName:', sessionStorage.getItem('popup_user_website_name'), '-> slug:', finalSlug);
     console.log('[handleSaveSiteInPopup] 📝 first 3 image URLs:', resolvedScrapedData?.images?.slice(0, 3));
     const result = await createNewSiteRecords(data);
     console.log('[handleSaveSiteInPopup] ✅ Site records created:', result.slug, result.propertyId, result.siteUrl);
     sessionStorage.setItem('popup_site_url', result.siteUrl);
     sessionStorage.setItem('popup_site_phase', 'saved');

     // ── Migrate scraped data from onboarding_data into the new property ──
     // Source is now the user's own onboarding_data (fixed to save scraped_* fields).
     // Fall back to efa8d280 only if onboarding_data has no real scraped content.
     try {
       const { data: { session } } = await supabase.auth.getSession();
       if (session) {
         // Fetch fresh onboarding_data to pass to migration
         const { data: od } = await supabase
           .from('onboarding_data')
           .select('scraped_title, scraped_location, scraped_description, scraped_hero_image, scraped_images, scraped_guests, scraped_rating, scraped_reviews, hero_image, images, location, property_desc, bedrooms, beds, baths, property_name, property_headline')
           .eq('user_id', user.id)
           .maybeSingle();
         // Merge: od (DB) provides all available property fields (beds/baths/etc),
         // resolvedScrapedData (sessionStorage) overrides ONLY the text fields that were
         // freshly scraped and are more up-to-date than what's in od.
         // Order matters: resolvedScrapedData text fields override od's values.
         const migrationData = {
           ...(od || {}),
           // Scraped text fields from sessionStorage override od values (fresher)
           // INPUT FIELDS WIN. GetSite (rendered from App.tsx) writes the user's edits to these
           // sessionStorage keys, but THIS popup is the one that actually runs the migration —
           // so it has to read them. Trailing null (not '') lets migrate-property's cleanup drop
           // the key and preserve the stored value instead of wiping a good field with ''.
           title: sessionStorage.getItem('popup_user_website_name') || sessionStorage.getItem('popup_website_name') || websiteName || od?.property_name || resolvedScrapedData?.title || od?.scraped_title || null,
           property_title: sessionStorage.getItem('popup_property_headline') || od?.property_headline || resolvedScrapedData?.title || od?.scraped_title || null,
           // name = @handle shown top-left — read from sessionStorage (user's typed website name)
           name: (() => {
             const wn = sessionStorage.getItem('popup_user_website_name')
               || sessionStorage.getItem('popup_website_name')
               || websiteName
               || '';
             return wn.startsWith('@') ? wn : `@${wn}`;
           })(),
           description: sessionStorage.getItem('popup_website_desc') || websiteDesc || od?.property_desc || resolvedScrapedData?.description || od?.scraped_description || null,
           property_intro: sessionStorage.getItem('popup_website_desc') || websiteDesc || od?.property_desc || resolvedScrapedData?.description || od?.scraped_description || null,
           address: resolvedScrapedData?.location || od?.scraped_location || od?.location || '',
           hero_image: resolvedScrapedData?.hero_image || od?.scraped_hero_image || od?.hero_image || '',
           images: resolvedScrapedData?.images?.length ? resolvedScrapedData.images : (od?.scraped_images?.length ? od.scraped_images : od?.images || []),
           // Beds/bedrooms/baths come from od (saved by scrape form) — not in sessionStorage
           max_guests: resolvedScrapedData?.guests || od?.scraped_guests || null,
           bedrooms: od?.bedrooms ?? null,
           beds: od?.beds ?? null,
           baths: od?.baths ?? null,
         };
         const migRes = await fetch(`${supabaseUrl}/functions/v1/migrate-property`, {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
             'Authorization': `Bearer ${session.access_token}`,
             'Apikey': supabaseAnonKey,
           },
           body: JSON.stringify({
             targetPropertyId: result.propertyId,
             onboardingData: migrationData,
           }),
         });
         const migData = await migRes.json();
         if (migRes.ok && migData.success) {
           console.log('[handleSaveSiteInPopup] ✅ Migrated scraped data:', migData.fields_copied);
         } else {
           console.warn('[handleSaveSiteInPopup] ⚠️ Migration failed:', migData.error);
         }
       }
     } catch (migErr) {
       console.warn('[handleSaveSiteInPopup] ⚠️ Migration error:', migErr);
       // Non-fatal - site still deploys even if migration fails
     }

     // ── Deploy React app to Hostinger via duplicateSiteAfterPayment ──
     // This calls the deploy-site edge function which triggers deploy-react-upload.php
     // on Hostinger. That PHP script SSHs to Mac Mini to run deploy-react-property.mjs,
     // which builds the React app and rsyncs it to Hostinger.
     // Falls back to browser-based upload (upload.php + CDN React bundle) if Mac Mini SSH fails.
     console.log('[handleSaveSiteInPopup] 🚀 Deploying React app to /props/', result.slug, '...');
     const deployResult = await duplicateSiteAfterPayment(result.slug, result.propertyId);
     console.log('[handleSaveSiteInPopup] ✅ Deploy result:', deployResult.deployUrl);
     const deployUrl = deployResult.deployUrl;

     // Show success state — suppressed in migration mode; the ?paid handler
     // redirects to the deployed site URL instead of showing any banner.
     setCongratsUrl(result.siteUrl);
     setDeployUrl(deployUrl);
     setSavingSite(false);
     setShowSaveOverlay(false);
     if (!migrationMode) setIsOpen(false);
     if (!migrationMode) setShowCongrats(true);

     // Return the result so callers (e.g. ?paid handler in App.tsx) can get the propertyId
     return { propertyId: result.propertyId, siteUrl: result.siteUrl, slug: result.slug };
   } catch (err) {
     console.error('[handleSaveSiteInPopup] ❌ FATAL ERROR:', err);
     setStripeError('Failed to save site. Check DevTools console: ' + (err instanceof Error ? err.message : String(err)));
     setSavingSite(false);
     // In migration mode the popup is already closed and sidebar is open - don't re-open it
     if (!migrationMode) setIsOpen(true);
     return null;
   }
 };




 return (
 <>
   {/* ── Post-Stripe saving overlay ── */}
   {showSaveOverlay && (
     <div className="popup-backdrop" style={{ background: 'rgba(0,0,0,0.75)', zIndex: 9998, pointerEvents: 'auto' }}>
       <div className="popup-modal" style={{ maxWidth: 360, alignItems: 'center', textAlign: 'center', padding: '36px 40px' }}>
         <div style={{ fontSize: '2.2rem', marginBottom: 12 }}>⚙️</div>
         <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 8, color: '#fff', textTransform: 'none', letterSpacing: 0 }}>Saving your data…</h2>
         <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', marginBottom: 20, textAlign: 'center', lineHeight: 1.5 }}>Almost there! We&apos;re saving your site and photos.</p>
         <div style={{
           width: 40, height: 40, borderRadius: '50%',
           border: '3px solid rgba(255,255,255,0.2)',
           borderTopColor: '#fff',
           animation: 'spin 0.8s linear infinite',
         }} />
         <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
       </div>
     </div>
   )}
 {isOpen && (
 <div className="popup-backdrop" onClick={handleClose}>
 <div className="popup-modal" onClick={(e) => e.stopPropagation()}>
 <button onClick={handleClose} className="popup-close">×</button>

 {/* Intro */}
 <h1 style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>Create your site</h1>
 <p>After you complete this sign up process you can then open your site on your phone or desktop browser. You can finish customizing it by adding photos, editing text, and manage incoming bookings at your convenience.</p>
 <br /><hr />

 {/* Sign Up */}
 <h1 style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>Sign Up</h1>
  {(user || accountCreated) ? (
   <div style={{ background: 'rgba(80,180,100,0.12)', border: '1px solid rgba(80,180,100,0.35)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: '0.9rem', color: '#a8d8b0' }}>
     {accountCreated && !user ? (
       <strong style={{color: '#2a9d4e'}}>✓ Account created - welcome, {authFullName || authEmail.split('@')[0]}!</strong>
     ) : user ? (
       <><strong>{user.full_name || user.email}</strong></>
     ) : null}
   </div>
 ) : (
   <>
     {planChoice === 'starter' && (
       <div style={{ background: 'rgba(196,119,86,0.15)', border: '1px solid rgba(196,119,86,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.85rem', color: '#e8c4a0' }}>
         Your plan includes a free month - you won&apos;t be charged today.
       </div>
     )}
     <p>Create your account to get started.</p>
     <h4>Full name</h4>
     <input type="text" placeholder="Full name" className="editmode" value={authFullName} onChange={e => setAuthFullName(e.target.value)} autoComplete="name" />
     <h4>Phone (optional)</h4>
     <input type="tel" placeholder="Phone number" className="editmode" value={authPhone} onChange={e => setAuthPhone(e.target.value)} autoComplete="tel" />
     <h4>Email</h4>
     <input type="email" placeholder="Email" className="editmode" value={authEmail} onChange={e => setAuthEmail(e.target.value)} autoComplete="email" />
     <h4>Password</h4>
     <input type="password" placeholder="Password" className="editmode" value={authPassword} onChange={e => setAuthPassword(e.target.value)} autoComplete="new-password" />
     {authError && <p style={{ color: '#e07070', fontSize: '0.85rem', margin: '6px 0' }}>{authError}</p>}
     <button className="btn" onClick={handleSignUp} disabled={authLoading}>
       {authLoading ? 'Creating account...' : 'Create Account'}
     </button>
     <br /><hr />

     {/* Sign In */}
     <h1 style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>Already have an account? Sign In</h1>
     <h4>Email</h4>
     <input type="email" placeholder="Email" className="editmode" value={authEmail} onChange={e => setAuthEmail(e.target.value)} autoComplete="email" />
     <h4>Password</h4>
     <input type="password" placeholder="Password" className="editmode" value={authPassword} onChange={e => setAuthPassword(e.target.value)} autoComplete="current-password" />
     {authError && <p style={{ color: '#e07070', fontSize: '0.85rem', margin: '6px 0' }}>{authError}</p>}
     <button className="btn" onClick={handleSignIn} disabled={authLoading}>
       {authLoading ? 'Signing in...' : 'Sign In'}
     </button>
   </>
 )}
 <p>Enter the email address you would like your booking notifications sent to.</p>
 <h4>Bookings email</h4>
 <input type="email" placeholder="Bookings email" className="editmode" value={bookingsEmail} onChange={e => setBookingsEmail(e.target.value)} autoComplete="email" />
 <br /><hr />

  {/* Banking section - completed in sidebar after signup */}

 {/* Design */}
 <h1 style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>2. Design your website</h1>
 <ul>
 <li>
 <input type="radio" name="design" id="3-1" checked={designChoice === 'manual'} onChange={() => { setDesignChoice('manual'); setScrapedData(null); }} />
 <label htmlFor="3-1">Manual photo upload - Free</label>
 </li>
 </ul>
 {designChoice === 'manual' && (
 <div className="popup-airbnb-section">
 <p>Upload property photos</p>
 <h3>Add photos from your phone or computer. The first photo becomes the hero image.</h3>
 <label htmlFor="manual-image-upload" className="btn" style={{ display: 'inline-block', cursor: 'pointer' }}>
 Choose photos
 </label>
 <input
 id="manual-image-upload"
 type="file"
 accept="image/*"
 multiple
 capture="environment"
 style={{ display: 'none' }}
 onChange={async (e) => {
 const files = Array.from(e.target.files || []);
 if (files.length === 0) return;
 const newBlobUrls: string[] = [];
 const newBase64s: string[] = [];
 for (const file of files) {
 const blobUrl = URL.createObjectURL(file);
 const base64 = await fileToBase64(file);
 newBlobUrls.push(blobUrl);
 newBase64s.push(base64);
 }
 const allBase64s = [...manualBase64Images, ...newBase64s];
 setManualBase64Images(allBase64s);
 setManualImages(prev => [...prev, ...newBlobUrls]);
 if (!manualHeroImage && newBlobUrls.length > 0) {
 setManualHeroImage(newBlobUrls[0]);
 }
 if (onImported) {
 const prevBase64s = manualBase64Images; // capture before state update
 const heroBase64 = newBlobUrls[0] ? allBase64s[manualImages.length] : allBase64s[0] || '';
 onImported({
 title: (websiteName.trim() || 'surfhousebaja'),
 location: '',
 description: websiteDesc || '',
 hero_image: heroBase64,
 images: allBase64s,
 guests: null,
 bedrooms: null,
 beds: null,
 baths: null,
 rating: null,
 reviews: null,
 host_name: null,
 });
 }
 }}
 />
 {manualImages.length > 0 && (
 <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
 {manualImages.map((url, i) => (
 <div key={url} style={{ position: 'relative', width: '72px', height: '72px', borderRadius: '8px', overflow: 'hidden', border: manualHeroImage === url ? '2px solid var(--brand)' : '2px solid transparent', cursor: 'pointer' }}
 onClick={(e) => { e.stopPropagation();
 setManualHeroImage(url);
 if (onImported) {
 const heroIdx = manualImages.indexOf(url);
 const heroBase64 = heroIdx >= 0 ? manualBase64Images[heroIdx] : '';
 onImported({
 title: (websiteName.trim() || 'surfhousebaja'),
 location: '',
 description: websiteDesc || '',
 hero_image: heroBase64,
 images: manualBase64Images,
 guests: null,
 bedrooms: null,
 beds: null,
 baths: null,
 rating: null,
 reviews: null,
 host_name: null,
 });
 }
 }}>
 <img src={url} alt={`Photo ${i+1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
 <button
 onClick={(evt) => { evt.stopPropagation(); setManualImages(prev => prev.filter((_, idx) => idx !== manualImages.indexOf(url))); if (manualHeroImage === url) setManualHeroImage(''); }}
 style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: '18px', height: '18px', fontSize: '10px', cursor: 'pointer', lineHeight: '16px', textAlign: 'center' }}
 >×</button>
 </div>
 ))}
 </div>
 )}
 {manualImages.length > 0 && (
 <p className="hero-subtitle popup-note" style={{ marginTop: '6px' }}>{manualImages.length > 0 ? `${manualImages.length} photo${manualImages.length > 1 ? 's' : ''} added` : 'No photos added yet'}</p>
 )}
 {manualImages.length > 0 && (
 <div className="popup-preview" style={{ marginTop: '16px' }}>
 <h3>Preview:</h3>
 <TemplatePreview
 title={websiteName || ''}
 location=""
 price=""
 description={websiteDesc || ''}
 hero_image={manualHeroImage || manualImages[0] || ''}
 images={manualImages}
 guests={undefined}
 bedrooms={undefined}
 beds={undefined}
 baths={undefined}
 rating={undefined}
 reviews={undefined}
 host_name={undefined}
 />
 </div>
 )}
 </div>
 )}
 <ul>
 <li>
 <input type="radio" name="design" id="3-2" checked={designChoice === 'airbnb'} onChange={() => setDesignChoice('airbnb')} />
 <label htmlFor="3-2">Auto Airbnb profile import - $10</label>
 </li>
 </ul>

 {/* Airbnb import - shown only when Airbnb radio is selected */}
 {designChoice === 'airbnb' && (
 <div className="popup-airbnb-section">
 <h4>Paste your Airbnb listing URL</h4>
 <input
 type="text"
 placeholder="https://www.airbnb.com/rooms/1569039869816457609"
 className="editmode"
 value={airbnbUrl}
 onChange={e => setAirbnbUrl(e.target.value)}
 />
 <button
 className="btn"
 onClick={(e) => { e.stopPropagation(); handleAirbnbScrape(e); }}
 disabled={isImporting || !airbnbUrl}
 >
 {isImporting ? `Importing... (${countdown}s)` : 'Get data'}
 </button>
 {importError && <p>{importError}</p>}
 {isImporting && (
 <div style={{ marginTop: 10 }}>
 <h3 style={{ marginBottom: 4 }}>Importing your listing - takes about 2 minutes.</h3>
 <p style={{ fontSize: '0.8rem', color: '#aaa', margin: 0 }}>Pick your brand color and font below while you wait.</p>
 </div>
 )}

 {/* Preview - appears below Get data after import */}
 {scrapedData && (
 <div className="popup-preview">
 <h3>Preview:</h3>
 <TemplatePreview
 title={scrapedData.title || websiteName || ''}
 location={scrapedData.location || ''}
 price={scrapedData.price || ''}
 description={scrapedData.description || ''}
 hero_image={scrapedData.hero_image || ''}
 images={scrapedData.images || []}
 guests={scrapedData.guests}
 bedrooms={scrapedData.bedrooms}
 beds={scrapedData.beds}
 baths={scrapedData.baths}
 rating={scrapedData.rating}
 reviews={scrapedData.reviews}
 host_name={scrapedData.host_name}
 />
 </div>
 )}
 </div>
 )}

<br />
 <p>Add your Brand color to your buttons.</p>
 <button className="btn" onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }} style={{ backgroundColor: showColorPicker ? "var(--brand-hover)" : "var(--brand)" }}>
 {showColorPicker ? "Close color picker" : "Launch color picker"}
 </button>
 {showColorPicker && (
 <div className="popup-color-picker">
 <div className="popup-color-grid">
 {['#E63946','#F77F00','#FFC300','#0096C7','#7B2D8E','#00B4D8','#FF6B35','#FF4757','#E84393','#1DD1A1','#00CEC9','#CCFF00'].map(hex => (
 <button
 key={hex}
 onClick={(e) => { e.stopPropagation();
 setBrandColor(hex);
 document.documentElement.style.setProperty('--brand', hex);
 const hover = adjustBrightness(hex, -20);
 const disabled = adjustBrightness(hex, 35);
 document.documentElement.style.setProperty('--brand-hover', hover);
 document.documentElement.style.setProperty('--brand-disabled', disabled);
 }}
 className="popup-color-swatch"
 style={{
 backgroundColor: hex,
 borderColor: brandColor === hex ? 'white' : 'transparent',
 boxShadow: brandColor === hex ? '0 0 0 2px var(--brand)' : 'none',
 }}
 />
 ))}
 </div>
 <div className="popup-color-custom">
 <input
 type="text"
 value={brandColor}
 onChange={e => {
 const val = e.target.value;
 setBrandColor(val);
 if (/^#[0-9a-fA-F]{6}$/.test(val)) {
 saveBrandColor(val);
 }
 }}
 placeholder="#C47756"
 maxLength={7}
 className="popup-color-input"
 />
 <span className="popup-color-label">Brand color: <span style={{ fontFamily: 'monospace', color: brandColor }}>{brandColor}</span></span>
 </div>
 </div>
 )}

 {/* Font accent selector */}
 <div className="popup-font-section">
 <p>Choose your font for headings.</p>
 <FontDropdown
 value={fontAccent}
 options={fontOptions}
 onChange={font => {
 setFontAccent(font);
 localStorage.setItem('site-font-accent', font);
 document.documentElement.style.setProperty('--font-accent', `'${font}', serif`);
 document.querySelectorAll('h1').forEach(el => {
 (el as HTMLElement).style.fontFamily = `'${font}', serif`;
 });
 }}
 previewText="The quick brown fox"
 triggerClassName="popup-font-dropdown-trigger"
 />
 </div>

 <hr />

 {/* Name property */}
 <h1 style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>3. Name your property</h1>
 <h4>Website name <span style={{ color: '#e53e3e', fontWeight: 700 }}>(IMPORTANT)</span></h4>
 <input type="text" placeholder="Website name (max 20 chars)" className="editmode" value={websiteName} onChange={e => handleNameChange(e.target.value)} onBlur={handleNameBlur} autoComplete="off" />
 <h4>Website description</h4>
 <textarea
 placeholder="Website description"
 className="popup-textarea editmode"
 value={websiteDesc}
 onChange={e => handleDescChange(e.target.value)}
 onBlur={handleDescBlur}
 />
 <p>Check domain availability so you can point it to your hosting server.</p>
 <button
 style={{ display: 'inline-block', background: 'var(--brand, #C47756)', color: '#fff', padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', marginTop: 4 }}
 onClick={() => {
 const rawName = websiteName.trim() || '';
 const name = rawName.replace(/[^a-zA-Z0-9\s]/g, '').trim();
 const url = name
 ? `https://www.hostinger.com/domain-name-results?from=homepage&domain=${encodeURIComponent(name.toLowerCase().replace(/\s+/g, ''))}`
 : 'https://www.hostinger.com';
 window.open(url, '_blank');
 }}
 >
 Check on Hostinger
 </button>
<br />

 <hr />

 {/* Hosting */}
 <h1 style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>4. Hosting options</h1>
 <ul>
 <li>
 <input type="radio" name="hosting" id="4-1" checked={hostingChoice === 'own'} onChange={() => setHostingChoice('own')} />
 <label htmlFor="4-1">Export to your own server - Free</label>
 </li>
 <li>
 <input type="radio" name="hosting" id="4-2" checked={hostingChoice === 'our'} onChange={() => setHostingChoice('our')} />
 <label htmlFor="4-2">Published to our server - $5 p/m</label>
 </li>
 </ul>
 <br /><hr />

 {/* Subscription */}
 <h1 style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>5. Subscription</h1>
 {(user?.stripe_subscription_status === 'active' || user?.stripe_subscription_status === 'trialing') ? (
 <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'rgba(80,180,100,0.12)', border: '1px solid rgba(80,180,100,0.35)', borderRadius: 8, fontSize: '0.95rem', color: '#a8d8b0', marginBottom: 8 }}>
 <span>✓ You have the {user?.stripe_subscription_plan || planChoice || 'starter'} plan</span>
 </div>
 ) : (
 <>
 <ul>
 <li>
 <input type="radio" name="plan" id="5-1" checked={planChoice === 'starter'} onChange={() => setPlanChoice('starter')} />
 <label htmlFor="5-1">Starter - Free 1st month then $10/mo</label>
 </li>
 <li>
 <input type="radio" name="plan" id="5-2" checked={planChoice === 'pro'} onChange={() => setPlanChoice('pro')} />
 <label htmlFor="5-2">Pro - $30/mo</label>
 </li>
 <li>
 <input type="radio" name="plan" id="5-3" checked={planChoice === 'agency'} onChange={() => setPlanChoice('agency')} />
 <label htmlFor="5-3">Agency - $150/mo</label>
 </li>
 </ul>
 </>
 )}
 <br /><hr />

 {/* Extras */}
 <h1 style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>6. Optional extras</h1>
 <p>Select which services you are interested in getting.</p>
 <ul>
 <li>
 <input type="checkbox" id="6-1" checked={extras.seo} onChange={e => setExtras({...extras, seo: e.target.checked})} />
 <label htmlFor="6-1">AI SEO - $10 p/m</label>
 </li>
 <li>
 <input type="checkbox" id="6-2" checked={extras.ads} onChange={e => setExtras({...extras, ads: e.target.checked})} />
 <label htmlFor="6-2">Ads &amp; Marketing - $30 p/m</label>
 </li>
 <li>
 <input type="checkbox" id="6-3" checked={extras.analytics} onChange={e => setExtras({...extras, analytics: e.target.checked})} />
 <label htmlFor="6-3">Analytics - $20 p/m</label>
 </li>
 <li>
 <input type="checkbox" id="6-4" checked={extras.social} onChange={e => setExtras({...extras, social: e.target.checked})} />
 <label htmlFor="6-4">Social Media Marketing - $50 p/m</label>
 </li>
 </ul>
 <br /><hr />

 {/* Payment */}
 <h1 style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>Payment Calculated</h1>
 <p>Secure payment via Stripe (accepts Visa, Mastercard, Amex).</p>
 <button
 className="btn"
 onClick={(e) => { e.stopPropagation(); openStripeGateway(e); }}>
 {user?.stripe_subscription_status === 'active' || user?.stripe_subscription_status === 'trialing'
 ? `✓ Subscribed to ${planChoice === 'starter' ? 'Starter' : planChoice === 'pro' ? 'Pro' : 'Agency'}`
 : user?.stripe_subscription_status === 'past_due'
 ? 'Update Payment'
 : `Subscribe to ${planChoice === 'starter' ? 'Starter $10' : planChoice === 'pro' ? 'Pro $30' : 'Agency $150'}`}
 </button>

 <h1 style={{ fontSize: "clamp(1.5rem, 2.8vw, 1.875rem)" }}>7. Publish your site</h1>
 <p>After onboarding you can open your site on your phone or desktop browser. You can finish customizing it by adding photos, editing text, and manage incoming bookings at your convenience.</p>
 <ul>
 <li>
 <input type="checkbox" id="7-1" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
 <h4>Click to agree to our Terms &amp; Conditions</h4>
 </li>
 </ul>
 <br />
 <button
 className="h2 publish-btn"
 onClick={(e) => { e.stopPropagation(); handlePublish(e); }}
 disabled={!agreed || !websiteName.trim() || stripeProcessing}
 >
   {(user?.stripe_subscription_status === 'active' || user?.stripe_subscription_status === 'trialing')
     ? (stripeProcessing ? 'SAVING...' : 'PUBLISH MY SITE')
     : (stripeProcessing ? 'REDIRECTING...' : 'SUBSCRIBE NOW')}
 </button>

 {/* Fixed bottom total banner */}

 {/* Stripe Payment Modal */}
 {showStripeModal && (
 <div className="stripe-modal-backdrop" onClick={() => { setShowStripeModal(false); setStripeError(''); }}>
 <div className="stripe-modal-box" onClick={e => e.stopPropagation()}>
 <div className="stripe-modal-header">
 <h1 style={{ margin: 0, fontSize: '1.1rem' }}>Secure Payment</h1>
 <button onClick={() => { setShowStripeModal(false); setStripeError(''); }} className="stripe-modal-close">×</button>
 </div>

 {/* Payment method icons */}
 <div className="stripe-pay-icons">
 {(['card', 'paypal', 'venmo'] as const).map(method => (
 <button
 key={method}
 className={"stripe-pay-btn" + (stripePayMethod === method ? ' active' : '')}
 onClick={() => setStripePayMethod(method)}
 >
 {method === 'card' && (
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
 <rect x="2" y="5" width="20" height="14" rx="2"/>
 <path d="M2 10h20"/>
 </svg>
 )}
 {method === 'paypal' && (
 <svg viewBox="0 0 24 24" fill="currentColor">
 <path d="M7.4 4.5C9 4.5 10.3 5.2 10.7 7h1.5c-.5-2.4-2.7-4-5.2-4-3.4 0-5.6 2.2-5.6 5.4 0 3.2 2.5 4.3 5.9 5.2 2.8.7 4.3 1.4 4.3 3.3 0 2.1-1.9 3.1-4.6 3.1-3.1 0-5.2-1.5-5.3-4.5H1.8c.1 3.7 2.6 6.2 5.9 6.2 3.6 0 5.9-2.3 5.9-5.7 0-3-1.9-4.3-5.9-5.2-2.6-.6-4.1-1.3-4.1-3.1 0-1.2 1.2-2.2 3.4-2.2z"/>
 </svg>
 )}
 {method === 'venmo' && (
 <svg viewBox="0 0 24 24" fill="currentColor">
 <path d="M17.18 6.54c-.7-1.27-2.02-1.91-3.6-1.91-2.2 0-3.8 1.37-4.08 3.2-.32 1.96.82 3.68 2.5 4.78l1.26.82c1.24.81 1.96 1.84 1.96 3.16 0 2.1-1.7 3.67-4.18 3.67-1.74 0-3.14-.67-3.88-1.82l-1.18 1.36c1.04 1.42 2.48 2.18 4.5 2.18 2.84 0 4.98-1.86 5.14-4.48.1-1.3-.46-2.5-1.54-3.4l-1.28-.84c-.98-.64-1.7-1.44-1.7-2.58 0-.92.66-1.58 1.58-1.58.72 0 1.24.32 1.24.92 0 .48-.34.86-.92.86-.24 0-.44-.12-.44-.42 0-.34.26-.66.74-1.16.7-.7 1.34-1.7 1.7-2.84.38.76.58 1.6.58 2.5 0 .8-.2 1.58-.6 2.3.06.26.1.54.1.84 0 .82-.26 1.62-.74 2.34.26.14.56.22.88.22.92 0 1.64-.7 1.64-1.58 0-.44-.18-.84-.46-1.12z"/>
 </svg>
 )}
 <span>{method === 'card' ? 'Card' : method.charAt(0).toUpperCase() + method.slice(1)} {method !== 'card' ? '(coming soon)' : ''}</span>
 </button>
 ))}
 </div>

 {/* Show pricing below Stripe elements */}
 <div className="stripe-total-compact" style={{ marginTop: 16 }}>
 <span>Total due today</span>
 <span>{displayedTotal === 0 ? 'Free today' : `$${displayedTotal}`}</span>
 </div>

 {stripeClientSecret ? (
 <Elements stripe={stripePromise} options={{ clientSecret: stripeClientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#c47756' } } }}>
 <CheckoutForm
 clientSecret={stripeClientSecret}
 onSuccess={async () => {
 setShowStripeModal(false);
 setStripeClientSecret('');
 await saveToSupabase();
 await refreshUser();
 if (onComplete) {
 onComplete({ bookingsEmail, bankChoice, designChoice, websiteName, websiteDesc, hostingChoice, planChoice, extras, scrapedData });
 }
 handleClose();
 }}
 onError={async (msg) => {
 if (msg === 'RETRY_NEEDED') {
 setStripeError('Updating payment details...');
 try {
 const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
 const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
 const activeExtras: string[] = [];
 if (extras.seo) activeExtras.push('seo');
 if (extras.ads) activeExtras.push('ads');
 if (extras.analytics) activeExtras.push('analytics');
 if (extras.social) activeExtras.push('social');
 const res = await fetch(`${supabaseUrl}/functions/v1/stripe-subscription`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
 'Apikey': supabaseAnonKey,
 },
 body: JSON.stringify({
 action: 'create_checkout',
 plan: planChoice,
 hosting_choice: hostingChoice,
 extras: activeExtras,
 include_scrape: designChoice === 'airbnb',
 email: user.email,
 user_id: user.id,
 return_url: (window.location.origin.replace(/\/$/, '')) + '/?paid=true&session_id={CHECKOUT_SESSION_ID}',
 }),
 });
 const data = await res.json();
 if (data.client_secret) {
 setStripeError('');
 setStripeClientSecret(data.client_secret);
 if (data.subscription_id) setStripeSubscriptionId(data.subscription_id);
 } else {
 setStripeError(data.error || data.message || 'Could not refresh payment. Please try again.');
 }
 } catch {
 setStripeError('Could not connect to payment server.');
 }
 return;
 }
 setStripeError(msg);
 }}
 monthlyTotal={monthlyTotal}
 />
 </Elements>
 ) : (
 <div className="stripe-loading"><div className="spinner-ring" /></div>
 )}
 {stripeError && <div className="stripe-error">{stripeError}</div>}
 </div>
 </div>
 )}

 {/* Building countdown modal - shown while site is being created + deployed */}
 {showBuilding && (
 <div className="stripe-modal-backdrop" style={{ zIndex: 99999 }}>
 <div className="stripe-modal-box" style={{ textAlign: 'center', padding: '40px 32px' }}>
 <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🔨</div>
 <h1 style={{ margin: '0 0 12px 0', fontSize: '1.5rem', color: '#fff' }}>Your site is being built!</h1>
 <p style={{ color: '#aaa', fontSize: '0.95rem', margin: '0 0 24px 0', lineHeight: 1.6 }}>
 This takes about 2 minutes. Please be patient.<br/>
 You'll be redirected automatically when it's ready.
 </p>
 <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--brand, #FF6B35)', marginBottom: '8px' }}>
 {buildingCountdown}s
 </div>
 <p style={{ color: '#555', fontSize: '0.8rem', margin: 0 }}>Time remaining</p>
 </div>
 </div>
 )}

 {/* Success modal - shown after Stripe payment completes */}
 {showCongrats && (
 <div className="stripe-modal-backdrop" style={{ zIndex: 99999 }} onClick={() => setShowCongrats(false)}>
 <div className="stripe-modal-box" style={{ textAlign: 'center', padding: '40px 32px' }} onClick={e => e.stopPropagation()}>
 <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🎉</div>
 <h1 style={{ margin: '0 0 12px 0', fontSize: '1.5rem', color: '#fff' }}>Well done!</h1>
 <p style={{ color: '#aaa', fontSize: '0.95rem', margin: '0 0 24px 0', lineHeight: 1.6 }}>
 Your subscription is active. You can now publish your site!
 </p>
 <button
 className="btn"
 style={{ width: '100%', fontSize: '1rem', padding: '14px' }}
 onClick={() => {
 setShowCongrats(false);
 setIsOpen(false);
 handlePublish();
 }}
 >
 Publish Now
 </button>
 <button
 onClick={() => setShowCongrats(false)}
 style={{ background: 'transparent', border: 'none', color: '#888', fontSize: '0.85rem', cursor: 'pointer', marginTop: '12px' }}
 >
 Maybe later
 </button>
 </div>
 </div>
 )}

 {/* Quick success banner with copy command - stays until dismissed */}
 {showCongrats && congratsUrl && (
 <div
 style={{
 position: 'fixed',
 top: '24px',
 left: '50%',
 transform: 'translateX(-50%)',
 zIndex: 99999,
 background: '#1a1a1a',
 border: '1px solid #333',
 borderRadius: '12px',
 padding: '20px 28px',
 textAlign: 'center',
 boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
 minWidth: '420px',
 maxWidth: '640px',
 width: '90vw',
 }}
 >
 <div style={{ fontSize: '2rem', marginBottom: '10px' }}>✅</div>
 <p style={{ color: '#fff', fontWeight: 600, fontSize: '1rem', margin: '0 0 4px 0' }}>
 Site "{websiteName || 'Your property'}" saved to Supabase!
 </p>
 <p style={{ color: '#888', fontSize: '0.8rem', margin: '0 0 12px 0' }}>
 Railway deploy triggered - your site will be live on propbook.pro shortly.
 </p>
 {deployUrl && (
 <div style={{ background: '#111', border: '1px solid #444', borderRadius: '8px', padding: '10px 14px', textAlign: 'left', marginBottom: '12px' }}>
 <code style={{ color: '#86efac', fontSize: '0.72rem', wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' }}>{deployUrl}</code>
 </div>
 )}
 <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
 <button
 onClick={() => { setShowCongrats(false); }}
 style={{ background: 'transparent', color: '#888', border: '1px solid #444', borderRadius: '6px', padding: '6px 16px', fontSize: '0.8rem', cursor: 'pointer' }}
 >
 Done
 </button>
 </div>
 </div>
 )}

 <div className="popup-total-banner">
 <div className="popup-total-left">
 <div className="popup-total-label">Total due today</div>
 <div className="popup-total-subline">
 {hasScrape && <span className="popup-total-tag">+${scrapeFee} Airbnb scrape</span>}
 {hasScrape && hasPlan && <span className="popup-total-sep"> · </span>}
 {!hasPlan && <span className="popup-total-sep"> · Select a plan</span>}
 {hasPlan && `+$${monthlyTotal}/mo subscription`}
 </div>
 </div>
 <div className="popup-total-right">
 <div className="popup-total-amount">{displayedTotal === 0 ? 'Free today' : `$${displayedTotal}`}</div>
 <div className="popup-total-period">
 {monthlyTotal > 0 && TRIAL_CREDIT > 0 ? `+$${monthlyTotal}/mo after free month` : (monthlyTotal > 0 ? `+$${monthlyTotal}/mo` : (hasScrape ? 'due today' : ''))}
 </div>
 </div>
 {stripeError && <div className="popup-stripe-error">{stripeError}</div>}
 </div>
 </div>
 </div>
 )}

 </>
 );
}
