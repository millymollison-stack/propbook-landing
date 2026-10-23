import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { TemplatePreview } from './TemplatePreview';
import { FontDropdown } from './FontDropdown';
import { FONT_OPTIONS, applyFontAccent, saveFontAccent } from '../lib/fontAccent';
import { supabase } from '../lib/supabase';
import { saveBrandColor } from '../lib/brandColor';
import { markAppearanceEdited, hasAppearanceBeenEdited } from '../lib/appearanceGuard';

import { useAuth } from '../store/auth';
import { createSlug } from '../services/slugService';
import { generateTemplateHtml } from '../services/templateHelpers';
// ── Scraped text helpers ─────────────────────────────────────────────────────────────

// First sentence: up to first period+space, or 100 chars, whichever is first
function extractFirst5Words(text: string): string {
  if (!text) return '';
  return (text || '').replace(/\s+/g, ' ').trim().split(/\s+/).slice(0, 5).join(' ');
}

// David 2026-10-21: "The intro copy should be limited to only be 12 words so it
// works on Mobile." Was 24 (first 3 sentences, max 12 words total) -- cut to 12
// and renamed throughout so nothing still calls this "24 words" in a comment or
// variable name once it isn't.
// David 2026-10-22: "If reducing the word count ... cuts the scraped copy in the
// property description mid sentence add ... after the last word." Dropped the old
// "roll back to the previous sentence boundary" behavior (it silently dropped
// content David wanted kept, e.g. ravenswortha14's "...Kensal Green! Our
// thoughtfully designed") in favor of: keep the first 12 words as-is, and only
// add the ellipsis when the cut didn't already land on a sentence end.
function extractFirst12Words(text: string): string {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= 12) return text.trim();
  const truncated = words.slice(0, 12).join(' ');
  return /[.!?]$/.test(truncated) ? truncated : `${truncated}…`;
}

// Remove all line breaks and extra whitespace (for full copy block display)
function stripWhitespace(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

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
 onSiteCreated?: (propertyId: string, siteUrl: string) => void;
 // David 2026-10-21: "I clicked admin account on the onboarding popup... went off to
 // find an airbnb link... the signed in as <name> section was gone... needed to signup
 // again and would have lost my site." Whatever the cause (mobile tab getting reloaded
 // in the background is the likely trigger), GetSite had no way to get the user back to
 // a login screen itself -- the "Signed in as" block just silently disappeared and
 // handlePublish's only response to a missing user was an inert error string. There was
 // no dead end that funneled someone toward Sign Up instead of Log In, but there was also
 // no path back to being logged in at all without leaving the popup. Wired so GetSite can
 // open the real Login modal (App.tsx) in place -- their draft is already preserved in
 // sessionStorage (popup_scraped_data etc., see handleSaveSiteInPopup), so logging back in
 // resumes the same draft instead of risking a second account.
 onOpenLogin?: () => void;
}

// Persisted flag: survives across remounts (key changes) so user-closed state is not lost
const POPUP_CLOSED_KEY = 'onboarding_popup_closed';

// ── Helpers ──────────────────────────────────────────────────────────────────

// David 2026-09-22: REMOVED (was here) — the embedded Stripe Elements <CheckoutForm>
// component. Confirmed dead: nothing anywhere calls setShowStripeModal(true) (the only
// gate that rendered it), so this could never mount. All current checkout uses Stripe's
// redirect-based Checkout Session from the sidebar, not embedded Elements. See
// claude/stability-plan-2026-09-22.md, item 1.

export function GetSite({ onComplete, onImported, onClose, scrapedProperty, scrapedImages, onSiteNameChange, onSiteCreated, onOpenLogin }: OnboardingPopupProps) {
 const { user, refreshUser } = useAuth();
 const [isOpen, setIsOpen] = useState(true); // Always open when rendered (parent controls visibility)

 // David 2026-10-21: "Once you have one site you can't get another with the same
 // login. The get site button should be disabled and open subscription should let
 // you choose 2nd tier that allows 2 sites." The data model already supports a user
 // owning more than one property (AdminSidebarBundle.tsx's property switcher is
 // built for it), so the limit is purely a plan entitlement, enforced here rather
 // than in the data layer. Starter = 1 site, Growth = 2. Checked here (not earlier,
 // e.g. the sidebar button) since this popup is the one place both trigger paths --
 // the live /app sidebar, and the exported-site GuestSidebar's window.__openGetSite
 // redirect -- both actually render.
 const [ownedSiteCount, setOwnedSiteCount] = useState<number | null>(null);
 useEffect(() => {
   if (!user) { setOwnedSiteCount(null); return; }
   // David 2026-10-22: "I went to the sidebar to get a new site but I had
   // reached my limit although I didn't actually publish a site. I just
   // previewed one." The limit is a plan entitlement on PUBLISHED sites --
   // a still-unpublished draft (status: 'draft', set by save-site-records,
   // only flips to 'active' once deploy-site actually publishes it) must
   // not count against it, or creating/re-editing your one draft before
   // you ever publish locks you out of your own onboarding flow.
   supabase.from('properties').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).eq('status', 'active')
     .then(({ count }) => setOwnedSiteCount(count ?? 0));
 }, [user?.id]);
 const SITE_LIMIT_BY_PLAN: Record<string, number> = { starter: 1, growth: 2 };
 const siteLimit = SITE_LIMIT_BY_PLAN[user?.stripe_subscription_plan || 'starter'] ?? 1;
 const atSiteLimit = ownedSiteCount !== null && ownedSiteCount >= siteLimit;
 const [brandColor, setBrandColor] = useState('#C47756');
 // Full unedited scraped description — independent from the 12-word description textarea
 const [propertyIntroFull, setPropertyIntroFull] = useState('');

 // Sync brandColor to CSS accent-color so checkboxes/radios inherit it
 useEffect(() => { document.documentElement.style.setProperty('--brand-accent', brandColor); }, [brandColor]);
 // Sync brandColor to sessionStorage whenever it changes (color picker, restore, etc.)
 useEffect(() => {
   sessionStorage.setItem('popup_brand_color', brandColor);
 }, [brandColor]);

 // Pre-warm the scraper so it's already spun up when user triggers a scrape
 useEffect(() => {
   // Fire-and-forget — don't await, don't block, don't show errors
   fetch(`https://propbook.pro/scraper/health/index.php`, { method: 'GET' }).catch(() => {});
 }, []);
 // Tracks whether this popup instance is still mounted (used to cancel auto-open timer on unmount)
 const descSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

 // ── Stripe post-payment handler ─────────────────────────────────────────────
 // REMOVED (was here): a duplicate, unverified handler that raced against the
 // real one below (~line 960s). It fired on the same [user] render, ran FIRST
 // (declaration order), and immediately set stripe_payment_returning='1' and
 // called handleSaveSiteInPopup WITHOUT ever verifying the Stripe session — so
 // the real handler below (which verifies via the stripe-subscription edge
 // function, updates the subscription status, THEN saves) always saw
 // stripe_payment_returning already set and bailed out as "already handled"
 // before it could run. This is the confirmed root cause of the Stripe
 // redirect landing back with no site created and no subscription registered.
 // The single remaining handler below now owns this entire flow.



 const [bookingsEmail, setBookingsEmail] = useState('');
 const [bankChoice, setBankChoice] = useState('');
 const [adminUpgrade, setAdminUpgrade] = useState(false);
 const [designChoice, setDesignChoice] = useState('airbnb');
 const [websiteName, setWebsiteName] = useState('');
 const [propertyHeadline, setPropertyHeadline] = useState('');
 const [websiteDesc, setWebsiteDesc] = useState('');
 const [_descInitialized, _setDescInitialized] = useState(false);
 const [hostingChoice, setHostingChoice] = useState('');
 const [planChoice, setPlanChoice] = useState('');
 const [extras, setExtras] = useState({ seo: false, ads: false, analytics: false, social: false });
 // agreed / Terms state removed — T&C checkbox deleted from UI
 const [stripeError, setStripeError] = useState('');

 const [showFinishPopup, setShowFinishPopup] = useState(false);
 const [showCongrats, setShowCongrats] = useState(false);
 const [showWelcomeModal, setShowWelcomeModal] = useState(false);
 const [congratsUrl, setCongratsUrl] = useState('');
 const [showBuilding, _setShowBuilding] = useState(false);
 const [buildingCountdown, setBuildingCountdown] = useState(120);
 const [deployUrl, setDeployUrl] = useState('');
 const [stripeProcessing, setStripeProcessing] = useState(false);
 const [popupConnectAccountId, setPopupConnectAccountId] = useState<string | null>(null);
 const [_savingSite, setSavingSite] = useState(false);
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
 const [_showColorPicker, _setShowColorPicker] = useState(false);
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
 sessionStorage.setItem(POPUP_CLOSED_KEY, '1');
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
 const rawTitle = scrapedProperty.property_title || scrapedProperty.title || '';
 const resolvedTitle = userTypedName || rawTitle;
 // Website name: first 16 chars
 setWebsiteName(resolvedTitle.slice(0, 16));
 // Property headline: first sentence of description — set state directly, NOT via handlePropertyHeadlineChange
 // (handlePropertyHeadlineChange calls setWebsiteDesc which would overwrite the description field)
 const descText = scrapedProperty.property_intro || scrapedProperty.description || '';
 setPropertyHeadline(extractFirst5Words(descText));
 sessionStorage.setItem('popup_property_headline', extractFirst5Words(descText));
 // Property description: first 3 sentences, max 12 words
 setWebsiteDesc(extractFirst12Words(descText));
 // Store FULL untruncated description for the "Full description (unedited)" text box
 const fullDesc = scrapedProperty.property_intro || scrapedProperty.description || '';
 sessionStorage.setItem('popup_property_intro', fullDesc);
 // Populate the independent full-description state
 setPropertyIntroFull(fullDesc);
 // Store the 12-word version explicitly too (popup_website_desc is set by handleDescChange but we need it here too)
 sessionStorage.setItem('popup_website_desc', extractFirst12Words(descText));
 setScrapedData({
 title: resolvedTitle.slice(0, 16),
 location: scrapedProperty.location || '',
 // Store the 12-word truncated description — what the user edits in the textarea.
 // Storing the full text here causes save to overwrite user edits with raw scrape copy.
 description: extractFirst12Words(descText),
 hero_image: imgs[0] || '',
 images: imgs,
 guests: scrapedProperty.max_guests || null,
 rating: null,
 reviews: null,
 host_name: null,
 });
 // Also restore planChoice from database in case user is migrating with a prior subscription
 if (user?.id) {
   supabase.from('onboarding_data').select('plan_choice').eq('user_id', user.id).single()
     .then(({ data: od }) => { if (od?.plan_choice) setPlanChoice(od.plan_choice); });
 }
 // GetSite only opens via explicit button click — no auto-open on mount
 return;
 }

        // David 2026-09-22: the `stripe_payment_returning` guard this used to have is gone —
        // it was set only by the legacy ?paid handler removed above, so the check could never
        // be true and was dead weight. See claude/stability-plan-2026-09-22.md, item 1.
        const savedScraped = sessionStorage.getItem('popup_scraped_data');
        if (savedScraped) {
          try {
            const parsed = JSON.parse(savedScraped);
            setScrapedData(parsed);
            // Restore user's typed website name first, fall back to scraped title
            const userTyped = sessionStorage.getItem('popup_user_website_name');
            if (parsed.title) {
              const resolvedTitle = (userTyped || parsed.title || '').slice(0, 16);
              setWebsiteName(resolvedTitle);
              const h = extractFirst5Words(parsed.description || '');
              setPropertyHeadline(h);
              sessionStorage.setItem('popup_property_headline', h);
            }
            if (parsed.description) setWebsiteDesc(extractFirst12Words(parsed.description));
          } catch { /* ignore corrupt JSON */ }
        }

        // David 2026-09-22: REMOVED (was here) — a "handle post-Stripe success" block gated on
        // sessionStorage's stripe_payment_done. Confirmed dead: nothing anywhere in the app
        // (grepped src/**/*.ts, src/**/*.tsx) ever sets that key -- its setter was already
        // gone before tonight, presumably removed in an earlier cleanup pass that missed this
        // consumer. Unreachable code, zero behavior change removing it. See
        // claude/stability-plan-2026-09-22.md, item 1.


 // Restore form field selections from sessionStorage (from before Stripe redirect)
 const savedPlan = sessionStorage.getItem('popup_plan');
 if (savedPlan) setPlanChoice(savedPlan);
 const savedHosting = sessionStorage.getItem('popup_hosting');
 if (savedHosting) setHostingChoice(savedHosting);
 const savedDesign = sessionStorage.getItem('popup_design');
 if (savedDesign) setDesignChoice(savedDesign);
 const savedName = sessionStorage.getItem('popup_website_name');
 if (savedName) setWebsiteName(savedName.slice(0, 16));
 const savedHeadline = sessionStorage.getItem('popup_property_headline');
 if (savedHeadline) {
   // Set directly — handlePropertyHeadlineChange() would fire debounce that corrupts description
   setPropertyHeadline(savedHeadline);
 }
 const savedDesc = sessionStorage.getItem('popup_website_desc');
 if (savedDesc) setWebsiteDesc(savedDesc);
 const savedBrandColor = sessionStorage.getItem('popup_brand_color');
 if (savedBrandColor) {
   setBrandColor(savedBrandColor);
 }
 // Restore full description text for the independent textarea
 const savedFullDesc = sessionStorage.getItem('popup_property_intro');
 if (savedFullDesc) setPropertyIntroFull(savedFullDesc);
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
 if (data.property_name) setWebsiteName(data.property_name.slice(0, 16));
 if (data.property_headline) setPropertyHeadline(data.property_headline);
 if (data.property_desc) {
   const truncated = extractFirst12Words(data.property_desc);
   setWebsiteDesc(truncated);
   sessionStorage.setItem('popup_website_desc', truncated);
 }
 if (data.airbnb_url) setAirbnbUrl(data.airbnb_url);
 if (data.design_choice) setDesignChoice(data.design_choice);
 if (data.bank_choice) setBankChoice(data.bank_choice);
 if (data.hosting_choice) setHostingChoice(data.hosting_choice);
 if (data.plan_choice) setPlanChoice(data.plan_choice);
 if (data.bookings_email) setBookingsEmail(data.bookings_email);
 if (data.extras) {
   try {
     const parsed = typeof data.extras === 'string' ? JSON.parse(data.extras) : data.extras;
     setExtras(parsed);
   } catch { /* ignore corrupt extras */ }
 }
 if (data.brand_color && !hasAppearanceBeenEdited()) {
   setBrandColor(data.brand_color);
   sessionStorage.setItem('popup_brand_color', data.brand_color);
 } else if (!data.brand_color) {
   // Fallback: try profiles table (where stripe-subscription writes brand_color)
   supabase.from('profiles').select('brand_color').eq('id', user?.id || '').single()
     .then(({ data: prof }) => {
       if (prof?.brand_color && !hasAppearanceBeenEdited()) {
         setBrandColor(prof.brand_color);
         sessionStorage.setItem('popup_brand_color', prof.brand_color);
       }
     });
 }

 // Restore full unedited description for the independent textarea
 const fullDesc = data.scraped_description || data.property_desc || '';
 if (fullDesc && !propertyIntroFull) {
   setPropertyIntroFull(fullDesc);
   sessionStorage.setItem('popup_property_intro', fullDesc);
 }

 // Reconstruct scrapedData from saved fields (supports both old non-prefixed fields
 // and new scraped_* fields saved by handleAirbnbScrape)
 const heroImg = data.scraped_hero_image || data.hero_image || '';
 const imgList = data.scraped_images || data.images || [];
 if (heroImg || imgList.length > 0) {
 const descText = data.scraped_description || data.property_desc || '';
 setScrapedData({
 title: (data.scraped_title || data.property_name || '').slice(0, 16),
 location: data.scraped_location || data.location || '',
 description: stripWhitespace(descText),
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

 // Re-run loadSavedData when user logs in (user?.id becomes available)
 // This loads the user's saved onboarding_data after the Stripe redirect returns.
 useEffect(() => {
 if (user?.id) loadSavedData();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [user?.id]);

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
 // Enforce 16 character max for website name / @handle
 const limited = cleaned.slice(0, 16);
 setWebsiteName(limited);
 // Persist immediately so Stripe redirect can't lose the user's typed input
 sessionStorage.setItem('popup_website_name', limited);
 sessionStorage.setItem('popup_user_website_name', limited);
 // Live-update the preview behind the popup as the user types — previously this only
 // happened on blur (handleNameBlur), so the site name/nav title behind the popup sat
 // stale the whole time someone was actively typing it. Same debounce pattern as
 // handlePropertyHeadlineChange/handleDescChange below.
 if (onSiteNameChange) {
 const display = limited.trim().length > 0 ? '@' + limited.trim() : '@surfhousebaja';
 onSiteNameChange(display);
 }
 clearTimeout(descSyncTimer.current ?? undefined);
 descSyncTimer.current = setTimeout(() => {
 if (onImported) {
 const latestHeadline = sessionStorage.getItem('popup_property_headline') || propertyHeadline || 'surfhousebaja';
 const latestDesc = sessionStorage.getItem('popup_website_desc') || websiteDesc;
 onImported({ title: limited, property_headline: latestHeadline, description: latestDesc });
 }
 }, 500);
 };
 const handlePropertyHeadlineChange = (val: string) => {
 // No character limit - store the full property headline
 const cleaned = val.startsWith('@') ? val.slice(1) : val;
 setPropertyHeadline(cleaned);
 sessionStorage.setItem('popup_property_headline', cleaned);
 // Debounce real-time preview sync so typing in Property headline keeps the preview updated
 clearTimeout(descSyncTimer.current ?? undefined);
 descSyncTimer.current = setTimeout(() => {
 if (onImported) {
 const latestHeadline = sessionStorage.getItem('popup_property_headline') || cleaned || 'surfhousebaja';
 const latestDesc = sessionStorage.getItem('popup_website_desc') || '';
 const latestName = sessionStorage.getItem('popup_website_name') || websiteName;
 onImported({ title: latestName, property_headline: latestHeadline, description: latestDesc });
 }
 }, 500);
 };
 const handleDescChange = (val: string) => {
 // Enforce 12-word limit at input time — textarea can never exceed 24 words
 const truncated = extractFirst12Words(val);
 setWebsiteDesc(truncated);
 // Write to sessionStorage IMMEDIATELY so Create Draft Site always reads fresh data
 sessionStorage.setItem('popup_website_desc', truncated);
 // NOTE: do NOT overwrite popup_property_intro here — that key holds the full
 // unedited scraped description for the independent text box below the photos.
 // Debounce the preview sync — read from sessionStorage (fresh) not React state (stale)
 clearTimeout(descSyncTimer.current ?? undefined);
 descSyncTimer.current = setTimeout(() => {
 if (onImported) {
 const latestHeadline = sessionStorage.getItem('popup_property_headline') || propertyHeadline || 'surfhousebaja';
 const latestName = sessionStorage.getItem('popup_website_name') || websiteName;
 // Read from popup_property_intro (full text) not popup_website_desc (12-word truncated)
 const latestDesc = sessionStorage.getItem('popup_property_intro') || sessionStorage.getItem('popup_website_desc') || val;
 onImported({ title: latestName, property_headline: latestHeadline, description: latestDesc });
 }
 }, 1000);
 };
 const handleDescBlur = () => {
 if (onImported) {
 const latestHeadline = sessionStorage.getItem('popup_property_headline') || propertyHeadline || 'surfhousebaja';
 const latestName = sessionStorage.getItem('popup_website_name') || websiteName;
 const latestDesc = sessionStorage.getItem('popup_website_desc') || websiteDesc;
 onImported({ title: latestName, property_headline: latestHeadline, description: latestDesc });
 }
 };

 // Sync description to template (fires independently, no stale name capture)
 // GetSite only opens via explicit button click — no auto-open on mount

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
 if (!isOpen) setIsOpen(true);
 // Set a flag so the Banking section step shows success state
 setShowStripeConnectSuccess(true);
 }, []);

 const [_myTabId] = useState(() => Math.random().toString(36).slice(2, 10));
 const [_showStripeConnectSuccess, setShowStripeConnectSuccess] = useState(false);

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

 // David 2026-09-22: REMOVED (was here) — the legacy ?paid=true&session_id= handler for the
 // original "Create Draft Site" flow. Confirmed dead: the only two places that ever
 // constructed that same return_url (the embedded <CheckoutForm> and its RETRY_NEEDED
 // create_checkout call, both further down this file) were themselves unreachable --
 // nothing anywhere calls setShowStripeModal(true), so that whole embedded-checkout
 // subtree could never render or fire. All current checkout is initiated from the
 // sidebar (AdminSidebarBundle.tsx's handlePublishFromSidebar / auto-publish-after-subscribe
 // effect), which already owns verifying the session, promoting role:'admin', and
 // publishing. This handler used to guard itself against double-firing alongside that
 // effect (pending_publish_property_id check) rather than actually being needed --
 // see claude/stability-plan-2026-09-22.md, item 1.

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
 // INPUT FIELD WINS: the user's typed Website name is authoritative. Scrape is fallback only.
 property_name: sessionStorage.getItem('popup_user_website_name') || sessionStorage.getItem('popup_website_name') || websiteName || sessionScraped?.title || null,
 // Read from sessionStorage (updated immediately by handlePropertyHeadlineChange, no debounce lag)
 property_headline: sessionStorage.getItem('popup_property_headline') || propertyHeadline || null,
 // INPUT FIELD WINS: the user's edited Property description is authoritative. Scrape is fallback only.
 property_desc: sessionStorage.getItem('popup_website_desc') || websiteDesc || sessionScraped?.description || null,
 airbnb_url: airbnbUrl,
 design_choice: designChoice,
 bank_choice: bankChoice,
 hosting_choice: hostingChoice,
 plan_choice: planChoice,
 email: user.email,
 bookings_email: bookingsEmail,
 brand_color: sessionStorage.getItem('popup_brand_color') || brandColor || null,
 extras: extras,
 updated_at: new Date().toISOString(),
 // Fresh overrides (from current scrape) take priority over sessionStorage.
 // sessionStorage may contain stale data from a previous scrape.
 scraped_title: (overrides.scraped_title || sessionScraped?.title) || null,
 scraped_location: (overrides.scraped_location || sessionScraped?.location) || null,
 scraped_description: (overrides.scraped_description || sessionScraped?.description) || null,
 scraped_hero_image: (overrides.scraped_hero_image || sessionScraped?.hero_image) || null,
 scraped_images: (overrides.scraped_images?.length ? overrides.scraped_images : (sessionScraped?.images?.length ? sessionScraped.images : null)),
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

 const SCRAPER_URL = 'https://propbook.pro/scraper/scrape-now.php';

 const handleAirbnbScrape = async (_e?: React.MouseEvent) => {
 if (!airbnbUrl) { setImportError('Please enter an Airbnb URL'); return; }
 setIsImporting(true);
 setImportError('');
 setCountdown(90);



 const countInterval = setInterval(() => {
 setCountdown(c => {
 if (c <= 1) { clearInterval(countInterval); return 0; }
 return Number(c) - 1;
 });
 }, 1000);

 try {
 const resp = await fetch(`${SCRAPER_URL}?url=${encodeURIComponent(airbnbUrl)}`);
 const result = await resp.json();
 clearInterval(countInterval);
 if (result.success) {
 const data = result.data;
 // Filter out known bad/mystery images that appear across all Airbnb scrapes
  const BLOCKED_IMAGES = ['fe7217ff-0b24-438d-880d-b94722c75bf5'];
  if (data.images) {
    data.images = data.images.filter((img: string) => !BLOCKED_IMAGES.some(id => img.includes(id)));
  }
  setScrapedData(data);
 // Geocode location if lat/lng are missing but we have a text location
 if (data.location && !data.lat && !data.lng) {
   fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(data.location)}&limit=1`, {
     headers: { 'User-Agent': 'propbook-dev/1.0' }
   }).then(r => r.json()).then(geo => {
     if (geo && geo[0]) {
       setScrapedData((prev: any) => prev ? { ...prev, lat: parseFloat(geo[0].lat), lng: parseFloat(geo[0].lon) } : prev);
     }
   }).catch(() => {});
 }
 // Persist scraped data to sessionStorage immediately so it survives Stripe redirect
 // [C1] Scraper raw result
 console.log('[C1] SCRAPER title="' + (data.title||'').slice(0,20) + '" desc="' + (data.description||'').slice(0,50) + '"');
  sessionStorage.setItem('popup_scraped_data', JSON.stringify(data));
 // Only pre-fill websiteName from scrape if user hasn't already typed one — they can always edit it before subscribing
 if (data.title) {
 const scrapedTitle = data.title;
 // Website name: first 16 chars of title
 const websiteName16 = scrapedTitle.slice(0, 16);
 if (!websiteName.trim()) handleNameChange(websiteName16);
 // Property headline: first sentence of description — set state directly, NOT via handlePropertyHeadlineChange
 const h = extractFirst5Words(data.description || scrapedTitle);
 setPropertyHeadline(h);
 sessionStorage.setItem('popup_property_headline', h);
 // Property description: first 3 sentences, max 12 words (for textarea display only)
 const desc12 = extractFirst12Words(data.description || '');
 setWebsiteDesc(desc12);
 // Persist sessionStorage with correctly split values
 sessionStorage.setItem('popup_website_name', websiteName16);
 sessionStorage.setItem('popup_property_headline', extractFirst5Words(data.description || scrapedTitle));
 // Store EXACTLY what the textarea shows (24 words). The input field is the source of
 // truth, so storage must match it — otherwise an untouched field deploys the raw scrape.
 // The full original stays available under popup_scraped_data.description.
 sessionStorage.setItem('popup_website_desc', desc12);
 // Store the FULL original description for the independent "Full description" textarea
 sessionStorage.setItem('popup_property_intro', data.description || '');
 setPropertyIntroFull(data.description || '');
 // [C2] sessionStorage written
 console.log('[C2] SS desc="' + desc12.slice(0,50) + '"');
 // Notify parent with the 12-word truncated version so the preview stays consistent
 if (onSiteNameChange) onSiteNameChange('@' + websiteName16);
 if (onImported) {
 const previewData = {
 ...data,
 title: websiteName16,
 property_headline: extractFirst5Words(data.description || scrapedTitle),
 // Pass the 12-word version so preview matches what the user edits in the textarea
 description: desc12,
 hero_image: data.images?.[1] || data.hero_image,
 images: data.images,
 };
 onImported(previewData);
 }
 }
 // Upsert scraped data to onboarding_data via the save-onboarding-scrape edge function --
 // this is the PRIMARY source for handleSaveSiteInPopup after Stripe redirect (React state
 // and sessionStorage are cleared on app remount). Do this FIRST so it survives the redirect.
 // Routed server-side (the function does the privileged upsert itself) instead of posting
 // straight to /rest/v1/onboarding_data with the service_role key from the browser -- this
 // still works even if the user isn't fully set yet, same as before.
 const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
 const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
 if (SUPABASE_URL && user?.id) {
  fetch(`${SUPABASE_URL}/functions/v1/save-onboarding-scrape`, {
   method: 'POST',
   headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
   },
   body: JSON.stringify({
    user_id: user.id,
    scraped_title: data.title || null,
    scraped_location: data.location || null,
    scraped_description: data.description || null,
    scraped_hero_image: data.hero_image || null,
    scraped_images: data.images || null,
    scraped_rating: data.rating || null,
    scraped_reviews: data.reviews || null,
    scraped_guests: data.guests || null,
   }),
  }).catch(e => console.warn('[handleAirbnbScrape] save-onboarding-scrape failed:', e));
 }
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
   console.log('[handlePublish] ENTRY user=' + !!user);
   // Stripe payment used to be triggered from this button before the site (or even a
   // DB record) existed. Moved: this button now only ever saves the draft -- the user
   // gets to see and edit their site first. Paying and going live happens later, from
   // the Publish button in the sidebar (AdminSidebarBundle.tsx -> handlePublishFromSidebar),
   // which gates on an active subscription and redirects to Stripe checkout itself.
   // (David, 2026-09-21: "rewire stripe to be triggered from the publish button in the
   // sidebar not GetSite.tsx so users get to see their site first before paying.")
   if (!user) { setStripeError('Please sign in or create an account first.'); onOpenLogin?.(); return; }
   if (!websiteName.trim()) { setStripeError('Please enter a website name first.'); return; }
   setStripeError('');
   setStripeProcessing(true);
   const siteResult = await handleSaveSiteInPopup();
   setStripeProcessing(false);
   console.log('[DIAG handlePublish] siteResult=', siteResult, 'onSiteCreated exists?', !!onSiteCreated);
   if (siteResult?.propertyId) {
     sessionStorage.setItem('home_loaded_property_id', siteResult.propertyId);
     if (onSiteCreated) onSiteCreated(siteResult.propertyId, siteResult.siteUrl);
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
     const { createNewSiteRecords, getOrCreatePublishAttemptId } = await import('../services/siteDuplicationService');
     console.log('[handleSaveSiteInPopup] ✅ imported services, starting site creation...');
     // Same correlation id createNewSiteRecords/duplicateSiteAfterPayment use — created here
     // if this is the first step of the attempt, reused if createNewSiteRecords already ran.
     // See siteDuplicationService.ts's getOrCreatePublishAttemptId() comment.
     const publishAttemptId = getOrCreatePublishAttemptId();

     // ── Resolve scrapedData with three-tier fallback ──
     // 1. React state (live, from parent props)
     // 2. sessionStorage (survives Stripe redirect remount)
     // 3. onboarding_data table (persisted for users who scraped before this fix)
     let resolvedScrapedData = scrapedData || JSON.parse(sessionStorage.getItem('popup_scraped_data') || 'null');
     if (!resolvedScrapedData) {
       const { data: od } = await supabase
         .from('onboarding_data')
         .select('scraped_title, scraped_location, scraped_description, scraped_hero_image, scraped_images, scraped_guests, scraped_rating, scraped_reviews, hero_image, images, location, property_desc, bedrooms, beds, baths, property_name, property_headline')
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
       websiteDesc: sessionStorage.getItem('popup_website_desc') || websiteDesc || '',
       // Full, unedited description ("Full description (unedited)" text box) — previously
       // dropped entirely on first-time publish (only the migrate-mode path saved it).
       propertyIntroFull: sessionStorage.getItem('popup_property_intro') || propertyIntroFull || '',
       propertyHeadline: sessionStorage.getItem('popup_property_headline') || propertyHeadline || '',
       propertyTitle: sessionStorage.getItem('popup_property_headline') || propertyHeadline || '',
       planChoice: planChoice as 'starter' | 'pro' | 'agency',
       hostingChoice: hostingChoice as 'our' | 'own',
       designChoice: designChoice,
       extras: { seo: extras.seo, ads: extras.ads, analytics: extras.analytics, social: extras.social },
       // Use scrapedData (React state from current browser session) first — it has the live
       // scrape result. Only fall back to resolvedScrapedData (sessionStorage/DB) if no
       // scrape happened in this browser (e.g. user is updating an existing site).
       scrapedData: scrapedData || resolvedScrapedData,
       bankChoice: bankChoice,
       brand_color: sessionStorage.getItem('popup_brand_color') || brandColor,
       font_accent: sessionStorage.getItem('popup_font_accent') || fontAccent,
       // Slug - ONLY from the user's Website Name field (saved before any scrape could overwrite it):
       // Priority: popup_user_website_name (user's typed input, saved at Subscribe click)
       //           → od.property_name (user's saved property name from DB)
       //           → user.full_name (last resort)
       // Slug — from the user's chosen website name (not the scrape title)
       slug: createSlug(
         sessionStorage.getItem('popup_user_website_name')
         || sessionStorage.getItem('popup_website_name')
         || websiteName
         || user.full_name
         || 'My Property'
       ),
     };
     const finalSlug = data.slug;
     console.log('[handleSaveSiteInPopup] 📝 websiteName:', websiteName, 'plan:', planChoice, 'scrapedData images count:', resolvedScrapedData?.images?.length, 'userWebsiteName:', sessionStorage.getItem('popup_user_website_name'), '-> slug:', finalSlug);
     console.log('[handleSaveSiteInPopup] 📋 sessionStorage values:', {
       popup_website_name: sessionStorage.getItem('popup_website_name'),
       popup_user_website_name: sessionStorage.getItem('popup_user_website_name'),
       popup_property_headline: sessionStorage.getItem('popup_property_headline'),
       popup_website_desc: (sessionStorage.getItem('popup_website_desc') || '').slice(0, 80),
     });
     console.log('[handleSaveSiteInPopup] 📝 first 3 image URLs:', resolvedScrapedData?.images?.slice(0, 3));
     // DEBUG: log exactly what we're passing to createNewSiteRecords
     console.log('[handleSaveSiteInPopup] ★★★ DATA TO SAVE ★★★ name=' + data.websiteName + ' desc=' + (data.websiteDesc || '(empty)').slice(0, 60) + ' headline=' + (data.propertyHeadline || '(empty)').slice(0, 40) + ' scraped.title=' + (data.scrapedData?.title || 'none') + ' scraped.desc=' + (data.scrapedData?.description || '(none)').slice(0, 60));
     const result = await createNewSiteRecords(data);
     // Construct siteUrl from slug since createNewSiteRecords doesn't return it
     const constructedSiteUrl = `https://www.propbook.pro/props/${result.slug}`;
     console.log('[handleSaveSiteInPopup] ✅ Site records created:', result.slug, result.propertyId, constructedSiteUrl);
     sessionStorage.setItem('popup_site_url', constructedSiteUrl);
     sessionStorage.setItem('popup_site_phase', 'saved');

     // ── Migrate user's edited text into the new property ──
     // sessionStorage always has the user's typed edits when this function is called.
     // Run migration EVERY TIME — user edits must be saved regardless of session state.
     try {
       const { data: od } = await supabase
         .from('onboarding_data')
         .select('scraped_title, scraped_location, scraped_description, scraped_hero_image, scraped_images, scraped_guests, scraped_rating, scraped_reviews, hero_image, images, location, property_desc, bedrooms, beds, baths, property_name, property_headline')
         .eq('user_id', user.id)
         .maybeSingle();
       const ssWebsiteName = sessionStorage.getItem('popup_user_website_name') || sessionStorage.getItem('popup_website_name') || websiteName || '';
       const ssHeadline = sessionStorage.getItem('popup_property_headline') || propertyHeadline || od?.property_headline || '';
       // ssDesc: user's 12-word edited description. Falls back to DB if sessionStorage was cleared (Stripe redirect).
       const ssDesc = sessionStorage.getItem('popup_website_desc') || websiteDesc || od?.property_desc || '';
       // Get FULL original description — priority:
       // 1. resolvedScrapedData (already loaded from DB above)
       // 2. sessionStorage popup_property_intro (set at scrape time, survives if not cleared)
       // 3. sessionStorage popup_scraped_data.description (may be cleared by App.tsx on startup)
       // 4. DB fields as last resort
       let fullOriginalDesc = resolvedScrapedData?.description || propertyIntroFull || '';
       if (!fullOriginalDesc) {
         fullOriginalDesc = sessionStorage.getItem('popup_property_intro') || '';
       }
       if (!fullOriginalDesc) {
         try {
           const scrapedRaw = sessionStorage.getItem('popup_scraped_data');
           if (scrapedRaw) fullOriginalDesc = JSON.parse(scrapedRaw).description || '';
         } catch {}
       }
       if (!fullOriginalDesc) {
         fullOriginalDesc = od?.scraped_description || od?.property_desc || '';
       }
       // The description we deploy = user's edited text (from popup_website_desc) if they edited it,
       // otherwise fall back to the full original scrape text.
       // INPUT FIELD WINS: always deploy the user's edited 12-word description.
       // fullOriginalDesc is only a last resort for when the field was left empty.
       const deployedDesc = ssDesc || fullOriginalDesc;
       // [C3] Migration data build
       console.log('[C3] MIGRATE od_desc='+(od?.property_desc||'').slice(0,30)+' ssDesc='+ssDesc.slice(0,30)+' fullOrig='+fullOriginalDesc.slice(0,30)+' deployedDesc='+deployedDesc.slice(0,30));
       const migrationData = {
         ...(od || {}),
         name: ssWebsiteName.startsWith('@') ? ssWebsiteName : `@${ssWebsiteName}`,
         title: ssWebsiteName,
         property_headline: ssHeadline,
         description: (ssDesc || fullOriginalDesc).replace(/\s+/g, ' ').trim(),
         property_intro: fullOriginalDesc,
         address: resolvedScrapedData?.location || od?.scraped_location || od?.location || '',
         hero_image: resolvedScrapedData?.hero_image || od?.scraped_hero_image || od?.hero_image || '',
         images: resolvedScrapedData?.images?.length ? resolvedScrapedData.images : (od?.scraped_images?.length ? od.scraped_images : od?.images || []),
         max_guests: resolvedScrapedData?.guests || od?.scraped_guests || null,
         bedrooms: od?.bedrooms ?? null,
         beds: od?.beds ?? null,
         baths: od?.baths ?? null,
         // Always read brand_color from sessionStorage first — React state may not be restored yet
         // if handleSaveSiteInPopup runs before loadSavedData has a chance to set brandColor.
         brand_color: sessionStorage.getItem('popup_brand_color') || brandColor,
         font_accent: sessionStorage.getItem('popup_font_accent') || fontAccent,
         // Pass subscription fields so migrate-property can write them to the property record
         stripe_subscription_status: (user as any).stripe_subscription_status || null,
         stripe_subscription_plan: (user as any).stripe_subscription_plan || null,
         stripe_customer_id: (user as any).stripe_customer_id || null,
         stripe_subscription_id: (user as any).stripe_subscription_id || null,
       };
       const { data: { session } } = await supabase.auth.getSession();
       const migRes = await fetch(`${supabaseUrl}/functions/v1/migrate-property`, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           'Authorization': `Bearer ${session?.access_token || ''}`,
           'Apikey': supabaseAnonKey,
         },
         body: JSON.stringify({
           publishAttemptId,
           targetPropertyId: result.propertyId,
           onboardingData: migrationData,
         }),
       });
       const migData = await migRes.json();
       if (migRes.ok && migData.success) {
         console.log(`[${publishAttemptId}] [handleSaveSiteInPopup] ✅ Migrated scraped data:`, migData.fields_copied);
         sessionStorage.setItem('popup_property_id', result.propertyId);
       } else {
         console.warn(`[${publishAttemptId}] [handleSaveSiteInPopup] ⚠️ Migration failed:`, migData.error);
       }
     } catch (migErr) {
       console.warn(`[${publishAttemptId}] [handleSaveSiteInPopup] ⚠️ Migration error:`, migErr);
     }

     // ── Deploy React app to Hostinger via upload.php ──
     // Wrap in try-catch so the function ALWAYS returns result even if deploy fails
     let deployUrl = constructedSiteUrl;
     // Skipped for a fresh draft (migrationMode=false) -- the site should not go live
     // until the user actually publishes (and pays) from the sidebar Publish button,
     // which deploys via the newer duplicateSiteAfterPayment() path instead.
     if (migrationMode) {
     try {
       console.log('[handleSaveSiteInPopup] 🚀 Deploying React app to /props/', result.slug, '...');

     // Fetch fresh property data from DB — the migration just ran and updated it with
     // the user's edited text. Use THIS as the source of truth for HTML generation,
     // NOT the original `data` object which was built before migration happened.
     const { data: freshProp } = await supabase
       .from('properties')
       .select('title, property_title, property_headline, property_intro, description, address, hero_image, images, bedrooms, beds, bathrooms, max_guests, price_per_night, rating, reviews')
       .eq('id', result.propertyId)
       .single();
     console.log('[handleSaveSiteInPopup] Fresh DB property:', freshProp?.title, '| prop_intro:', (freshProp?.property_intro || '').slice(0, 60));

     // Fetch the GitHub template
     const GITHUB_RAW = 'https://raw.githubusercontent.com/millymollison-stack/surfhousebaja/main/src/public/template';
     let templateHtml: string;
     try {
       const tRes = await fetch(`${GITHUB_RAW}/template.html`);
       if (!tRes.ok) throw new Error(`Template not found (${tRes.status})`);
       templateHtml = await tRes.text();
       console.log('[handleSaveSiteInPopup] ✅ Template loaded:', templateHtml.length, 'chars');
     } catch (e: any) {
       throw new Error(`Failed to fetch template from GitHub: ${e.message}`);
     }

     // Build data object from FRESH DB values — this is what the user actually typed/edited
     const freshData = {
       ...data,
       propertyId: result.propertyId,
       slug: result.slug,
       websiteName: freshProp?.title || data.websiteName,
       websiteDesc: freshProp?.property_intro || freshProp?.description || data.websiteDesc,
       // David 2026-09-22: was reading property_title for the headline template
       // token too -- property_headline is the field that's actually kept up to
       // date now (see ImageGallery.tsx/App.tsx), property_title can lag behind.
       propertyHeadline: freshProp?.property_headline || freshProp?.property_title || data.propertyHeadline,
       propertyTitle: freshProp?.property_title || data.propertyTitle,
       scrapedData: data.scrapedData,
     };

     // Generate property-specific HTML
     const indexHtml = generateTemplateHtml(templateHtml, freshData, supabaseUrl, supabaseAnonKey);

     // Fetch React bundle from CDN
     // NOTE: If this fails due to CORS (localhost → propbook.pro), the popup flow still
     // completes — the site deploys without the embedded React app and uses the previously
     // deployed app.js from the CDN instead.
     const CDN_BASE = 'https://www.propbook.pro/scripts/react-assets/assets';
     const REACT_BUNDLE = 'app.js';
     const CACHE_BUST = '';
     let reactJs = '';
     try {
       const r = await fetch(`${CDN_BASE}/${REACT_BUNDLE}${CACHE_BUST}`);
       if (!r.ok) throw new Error(`React bundle not found (${r.status})`);
       reactJs = await r.text();
       console.log('[handleSaveSiteInPopup] ✅ React bundle loaded:', (reactJs.length / 1024).toFixed(0) + 'KB');
     } catch (e: any) {
       // Non-fatal: fall back to previously deployed app.js on the CDN (if one exists)
       console.warn('[handleSaveSiteInPopup] ⚠️ React bundle fetch failed (CORS/network) — using CDN fallback:', e.message);
     }

     // UTF-8 safe base64 — btoa() only handles Latin1
     const encodeBase64 = (str: string) => btoa(unescape(encodeURIComponent(str)));

     // Route through deploy-site edge function (server-side, no CORS)
     // The edge function calls upload.php internally, bypassing browser CORS restrictions
     const { data: { session } } = await supabase.auth.getSession();
     const token = session?.access_token;
     if (!token) throw new Error('Not authenticated');
     console.log('[handleSaveSiteInPopup] 🚀 Calling deploy-site edge function...');
     const deployRes = await fetch(`${supabaseUrl}/functions/v1/deploy-site`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
       body: JSON.stringify({
         propertyId: result.propertyId,
         slug: result.slug,
         prebuiltHtml: encodeBase64(indexHtml),
       }),
     });
     if (!deployRes.ok) {
       const text = await deployRes.text().catch(() => deployRes.statusText);
       throw new Error(`deploy-site HTTP ${deployRes.status}: ${text}`);
     }
     const deployData = await deployRes.json();
     if (!deployData.success) throw new Error(`Deploy failed: ${deployData.error || 'unknown'}`);
     const deployUrl = deployData.siteUrl || `https://www.propbook.pro/props/${result.slug}`;
       console.log('[handleSaveSiteInPopup] ✅ Deploy result:', deployUrl);
     } catch (deployErr) {
       console.warn('[handleSaveSiteInPopup] ⚠️ Deploy failed (non-fatal, site records created):', deployErr);
     }
     }

     // Show success state — suppressed in migration mode; the ?paid handler
     // redirects to the deployed site URL instead of showing any banner.
     console.log('[DIAG handleSaveSiteInPopup] reached success tail, migrationMode=', migrationMode, 'about to setShowWelcomeModal(true)?', !migrationMode);
     setCongratsUrl(constructedSiteUrl);
     setDeployUrl(deployUrl);
     setSavingSite(false);
     // David 2026-10-22: save-site-records just flipped this user's profile
     // role to 'admin' server-side (so they get edit access without having
     // subscribed) -- but the in-memory `user` from the auth store is stale
     // until something refetches the profile, and nothing else here does a
     // full page reload. Without this, the Edit button and every edit-mode
     // handler gated on role==='admin' stay dark until an unrelated reload.
     refreshUser().catch(err => console.warn('[handleSaveSiteInPopup] refreshUser after site creation failed:', err));
     if (!migrationMode) setIsOpen(false);
     if (!migrationMode) setShowWelcomeModal(true);

     // Return the result so callers (e.g. ?paid handler in App.tsx) can get the propertyId
     return { propertyId: result.propertyId, siteUrl: constructedSiteUrl, slug: result.slug };
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
   {/* Global brand-color accent for all checkboxes, radios, and form controls */}
   <style>{`input[type=radio], input[type=checkbox], input[type=range] { accent-color: var(--brand-accent, ${brandColor}); }`}</style>

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

   {/* Welcome modal — shown once the draft is saved (no payment yet). Lives
       here, outside {isOpen && (...)}, so it still renders even though
       handlePublish's success tail closes the main popup (setIsOpen(false))
       right before showing this. */}
   {showWelcomeModal && (
     <div className="popup-backdrop" style={{ background: 'rgba(0,0,0,0.85)', zIndex: 99999 }} onClick={(e) => { if (e.target === e.currentTarget) { setShowWelcomeModal(false); if (onClose) onClose(); } }}>
       <div className="popup-modal" style={{ maxWidth: 420, alignItems: 'center', textAlign: 'center', padding: '36px 40px' }} onClick={e => e.stopPropagation()}>
         <h1 style={{ marginBottom: 14 }}>
           Your Draft Site!
         </h1>
         <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.9rem', marginBottom: 24, lineHeight: 1.5 }}>
           Click the Edit button in the nav and enter text, descriptions and additional photos before subscribing and publishing.
         </p>
         <button
           onClick={() => { setShowWelcomeModal(false); if (onClose) onClose(); }}
           style={{ background: 'var(--brand, #C47756)', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 32px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' }}
         >Got it</button>
       </div>
     </div>
   )}

   {/* ── Finish building popup ── */}
   {showFinishPopup && (
     <div className="popup-backdrop" style={{ background: 'rgba(0,0,0,0.75)', zIndex: 9999, pointerEvents: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowFinishPopup(false); }}>
       <div className="popup-modal" style={{ maxWidth: 400, alignItems: 'center', textAlign: 'center', padding: '36px 40px' }}>
         <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>✅</div>
         <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: 12, color: '#fff', textTransform: 'none', letterSpacing: 0 }}>Finish building your site and publish it via the sidebar.</h2>
         <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.9rem', marginBottom: 24, lineHeight: 1.5 }}>Your data is saved. Continue editing your property details, photos, and location — then hit Publish in the sidebar when you&apos;re ready.</p>
         <button
           onClick={() => setShowFinishPopup(false)}
           style={{
             background: 'var(--brand, #C47756)',
             color: '#fff',
             border: 'none',
             borderRadius: 8,
             padding: '12px 32px',
             fontSize: '1rem',
             fontWeight: 600,
             cursor: 'pointer',
           }}
         >Got it</button>
       </div>
     </div>
   )}
 {isOpen && (
 <div className="popup-backdrop" onClick={handleClose}>
 <div className="popup-modal" onClick={(e) => e.stopPropagation()}>
 <button onClick={handleClose} className="popup-close"><X className="h-5 w-5" /></button>

 {/* David 2026-10-21: upgrade gate -- replaces the whole onboarding form when the
     signed-in user is already at their plan's site limit, instead of letting them
     fill out the form and only failing at save time. */}
 {atSiteLimit ? (
   <div style={{ padding: '8px 0 4px' }}>
     <h1>You're at your plan limit</h1>
     <p>
       Your {user?.stripe_subscription_plan === 'growth' ? 'Growth' : 'Starter'} plan includes {siteLimit} property site{siteLimit === 1 ? '' : 's'}, and you already have {ownedSiteCount}.
       {user?.stripe_subscription_plan !== 'growth' && ' Upgrade to Growth ($25/mo) to add a second site.'}
     </p>
     <p style={{ color: '#999', fontSize: '0.85rem' }}>
       {user?.stripe_subscription_plan === 'growth'
         ? 'Contact us if you need more than 2 sites.'
         : 'You can upgrade from the Subscription section in your sidebar.'}
     </p>
   </div>
 ) : (
 <>
 {/* Intro */}
 <h1>Create your site</h1>
 <p>Set up your own property booking site now. You can continue editing the site once published.</p>
 <div style={{ height: 16 }} />

 {/* Account upgrade -- only makes sense once someone is actually signed in;
     previously rendered unconditionally and fell back to the literal string
     "account", showing "Signed in as account" to signed-out visitors. */}
 {user && (
 <label style={{ display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', padding: '10px 0' }}>
   <span style={{ color: '#ccc', fontSize: 'clamp(0.85rem, 1.5vw, 1rem)' }}>Signed in as <strong style={{ background: 'rgba(80,180,100,0.2)', border: '1px solid rgba(80,180,100,0.4)', borderRadius: 6, padding: '2px 8px', color: '#6fdb8c', fontWeight: 700 }}>{user.full_name || user.email}</strong></span>
   <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
     <input
       type="checkbox"
       checked={adminUpgrade}
       onChange={(e) => { e.stopPropagation(); setAdminUpgrade(e.target.checked); }}
       style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0, accentColor: brandColor }}
     />
     Switch to an Admin account
   </div>
 </label>
 )}
 {/* David 2026-10-21: signed-out fallback for the block above -- previously this whole
     section just vanished with nothing in its place, and the only other feedback was
     handlePublish's inert "Please sign in..." error text with no way to act on it from
     here. Your draft (Airbnb link, scraped photos/text) is already kept in sessionStorage
     and restored automatically on remount, so logging back in from right here picks up
     exactly where you left off -- no need to sign up again or risk a duplicate account. */}
 {!user && (
 <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: 'rgba(240,180,60,0.12)', border: '1px solid rgba(240,180,60,0.35)', borderRadius: 8, margin: '10px 0' }}>
   <span style={{ color: '#f0b43c', fontSize: 'clamp(0.8rem, 1.4vw, 0.95rem)' }}>You're signed out — your progress is saved, log back in to continue.</span>
   <button
     type="button"
     onClick={(e) => { e.stopPropagation(); onOpenLogin?.(); }}
     style={{ flexShrink: 0, background: 'var(--brand, #C47756)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
   >Log In</button>
 </div>
 )}


  {/* Banking section - completed in sidebar after signup */}

 {/* Design */}
 <hr />
 <h1>Design your website</h1>
 <div className="popup-airbnb-section" style={{ paddingBottom: 0 }}>
 <div style={{ display: 'flex', gap: 0 }}>
 <button
 onClick={() => setDesignChoice('airbnb')}
 style={{
 flex: 1,
 padding: '10px 8px',
 background: designChoice === 'airbnb' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
 color: designChoice === 'airbnb' ? '#fff' : '#aaa',
 border: 'none',
 borderBottom: designChoice === 'manual' ? '2px solid rgba(255,255,255,0.15)' : '2px solid var(--brand, #C47756)',
 borderRadius: '8px 8px 0 0',
 cursor: 'pointer',
 fontWeight: '600',
 fontSize: '0.9rem',
 }}
 >Import</button>
 <button
 onClick={() => { setDesignChoice('manual'); setScrapedData(null); }}
 style={{
 flex: 1,
 padding: '10px 8px',
 background: designChoice === 'manual' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
 color: designChoice === 'manual' ? '#fff' : '#aaa',
 border: 'none',
 borderBottom: designChoice === 'airbnb' ? '2px solid rgba(255,255,255,0.15)' : '2px solid var(--brand, #C47756)',
 borderRadius: '8px 8px 0 0',
 cursor: 'pointer',
 fontWeight: '600',
 fontSize: '0.9rem',
 }}
 >Manual</button>
 </div>
 {designChoice === 'manual' && (
 <div style={{ paddingTop: 16 }}>
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
 // Round 6: `capture="environment"` forced iOS/Android straight into the
 // camera instead of the photo library -- removed so the normal
 // library/camera choice sheet shows (the user can still tap through to
 // the live camera from there if they want).
 style={{ display: 'none' }}
 onChange={async (e) => {
 // David: "Photo upload only lets you upload 1 photo at a time. Change
 // it so you can upload 8 photos at once." -- the <input multiple> above
 // and this loop already accept any number of files; capping (and
 // telling the user) at 8 per selection makes that limit explicit
 // instead of silently unbounded.
 const MAX_PHOTOS_PER_SELECTION = 8;
 let files = Array.from(e.target.files || []);
 if (files.length === 0) return;
 if (files.length > MAX_PHOTOS_PER_SELECTION) {
 alert(`You can upload up to ${MAX_PHOTOS_PER_SELECTION} photos at once -- using the first ${MAX_PHOTOS_PER_SELECTION}.`);
 files = files.slice(0, MAX_PHOTOS_PER_SELECTION);
 }
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
 {designChoice === 'airbnb' && (
 <div style={{ paddingTop: 16 }}>
 <p style={{ fontSize: '0.9rem', color: '#ccc', margin: '0 0 12px 0' }}>Paste your Airbnb profile link to import your property photos and text. $10 fee to access Airbnb data.</p>
 <input
 type="text"
 placeholder="Airbnb listing url"
 className="editmode field-dark"
 value={airbnbUrl}
 onChange={e => setAirbnbUrl(e.target.value)}
 />
 <button
 className="btn"
 onClick={(e) => { e.stopPropagation(); handleAirbnbScrape(e); }}
 disabled={isImporting || !airbnbUrl}
 >
 {/* David: "Landing page: Change the button text in the first panel to:
     Preview your site now" -- was "Get data". This is the Airbnb-import
     tab's submit button, shown by default (designChoice starts as
     'airbnb') the moment the "Create your site" popup opens on
     propbook.pro with no property loaded -- i.e. the first thing a new
     visitor clicks. */}
 {isImporting ? `Importing... (${countdown}s)` : 'Preview your site now'}
 </button>
 {importError && <p>{importError}</p>}
 {isImporting && (
 <div style={{ marginTop: 10 }}>
 <h3 style={{ marginBottom: 4 }}>Importing your listing - takes about 2 minutes.</h3>
 <p style={{ fontSize: '0.8rem', color: '#aaa', margin: 0 }}>Pick your brand color and font below while you wait.</p>
 </div>
 )}

 {/* Preview - only show when scrape has fully landed (not during countdown) */}
 {scrapedData && !isImporting && (
 <div className="popup-preview popup-preview-compact">
 <h3>Preview:</h3>
 <TemplatePreview
 title={propertyHeadline || scrapedData.title || websiteName || ''}
 location={scrapedData.location || ''}
 price={scrapedData.price || ''}
 description={websiteDesc || scrapedData.description || ''}
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
 </div>

<p>Choose your sites accent color.</p>
 <div className="popup-color-picker">
 <div className="popup-color-grid">
 {['#E63946','#F77F00','#FFC300','#0096C7','#7B2D8E','#00B4D8','#FF6B35','#FF4757','#E84393','#1DD1A1','#00CEC9','#CCFF00'].map(hex => (
 <button
 key={hex}
 onClick={(e) => { e.stopPropagation();
 markAppearanceEdited();
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

 {/* Font accent selector */}
 <div className="popup-font-section">
 <p style={{ marginTop: 16 }}>Choose your font for headings.</p>
 <FontDropdown
 value={fontAccent}
 options={fontOptions}
 onChange={font => {
 setFontAccent(font);
 // Was duplicating applyFontAccent()'s logic here (and missing the
 // --title-size-multiplier boost it now also sets for the 6 large-condensed
 // fonts) -- routed through the shared helper instead.
 saveFontAccent(font);
 }}
 triggerClassName="popup-font-dropdown-trigger"
 />
 </div>

 {/* Name property */}
 <hr />
 <h1>Name your website</h1>
 <p style={{ fontSize: '0.9rem', color: '#ccc', margin: '0 0 12px 0' }}>Text from your Airbnb profile imports into the text boxes where it can be edited.</p>
 <h4>Website name <span style={{ color: '#e53e3e', fontWeight: 700 }}>(IMPORTANT)</span></h4>
 <input type="text" id="website-name" name="websiteName" placeholder="Website name (max 16 chars)" className="editmode field-dark" value={websiteName} onChange={e => handleNameChange(e.target.value)} style={{ maxWidth: 360 }} />
 <h4 style={{ marginTop: 16 }}>Property headline</h4>
 <input type="text" id="property-headline" name="propertyHeadline" placeholder="Property headline" className="editmode field-dark" value={propertyHeadline} onChange={e => handlePropertyHeadlineChange(e.target.value)} style={{ maxWidth: 360 }} />
 <h4 style={{ marginTop: 16 }}>Property description</h4>
 <textarea
 id="property-description"
 name="propertyDescription"
 placeholder="Property description"
 className="popup-textarea editmode field-dark"
 value={websiteDesc}
 onChange={e => handleDescChange(e.target.value)}
 onBlur={handleDescBlur}
 />
 {propertyIntroFull && (
 <div style={{ marginTop: 8, width: '100%', maxWidth: '100%' }}>
 <h4 style={{ marginTop: 16 }}>Full description (unedited)</h4>
 <textarea
 id="property-intro-full"
 name="propertyIntroFull"
 className="popup-textarea editmode field-dark"
 style={{ minHeight: 80, overflowY: 'auto', whiteSpace: 'pre-wrap' }}
 value={propertyIntroFull}
 placeholder="Full scraped description will appear here after import"
 onChange={e => {
 setPropertyIntroFull(e.target.value);
 sessionStorage.setItem('popup_property_intro', e.target.value);
 }}
 />
 </div>
 )}


 {/* NOTE: the manual-flow "Preview:" card for photos/description already
 renders earlier (next to the photo upload section) when manualImages.length > 0.
 A second, near-duplicate preview used to render again here, right above
 Hosting options — that's the "phantom preview window" reported; removed. */}
 <div style={{ marginBottom: 24 }} />

 {/* David 2026-10-21: "Remove subscription & Hosting options from the onboarding
     popup before you even see the site. We handle the subscription one step later
     now anyway." Both sections removed outright -- the "Create your draft" copy
     right below already says the real publish-and-pay step happens later, from
     the sidebar (AdminSidebarBundle.tsx -> handlePublishFromSidebar), so asking
     for a plan/hosting choice here was already vestigial, not just redundant.
     planChoice/hostingChoice state is left in place (still read by
     handleSaveSiteInPopup/migration below) rather than ripped out, since removing
     the inputs that set them is enough on its own and touching the save payload
     isn't part of this ask. */}
 <hr />

 {/* Payment */}
 <h1>Create your draft</h1>
 <p>Save your site as a draft to preview and keep editing it. You'll publish (and pay) from the sidebar once it's ready.</p>
 <br />
 <button
 className="h2 publish-btn"
 onClick={(e) => { e.stopPropagation(); handlePublish(e); }}
 disabled={!websiteName.trim() || stripeProcessing}
 >
   {stripeProcessing ? 'SAVING...' : 'CREATE DRAFT SITE'}
 </button>
 {/* David 2026-10-22: moved out of the removed "Total due today" banner
     (that banner always showed a fictional charge -- Create Draft Site
     never actually charges anything, payment happens later from the
     sidebar) -- this is the only place handlePublish's validation errors
     ("Please sign in", "Please enter a website name first") were shown. */}
 {stripeError && <div className="popup-stripe-error">{stripeError}</div>}

 {/* David 2026-09-22: REMOVED (was here) — the embedded Stripe Payment Modal
     (showStripeModal / stripeClientSecret / stripePayMethod / <CheckoutForm>).
     Confirmed dead: nothing ever calls setShowStripeModal(true). See
     claude/stability-plan-2026-09-22.md, item 1. */}

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

 </>
 )}
 </div>
 </div>
 )}

 </>
 );
}
