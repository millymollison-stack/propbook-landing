import React, { useEffect, useState, useRef, Component, ReactNode } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { supabase } from './lib/supabase';
import { AdminSidebar } from './export/AdminSidebarBundle';
import { GuestSidebar } from './components/GuestSidebar';
import { Layout } from './components/Layout';

import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { AdminDashboard } from './pages/AdminDashboard';
import { PropertyAdmin } from './pages/PropertyAdmin';
import { EmailConfirmation } from './pages/EmailConfirmation';
import { loadFontAccent } from './lib/fontAccent';
import { loadBrandColor } from './lib/brandColor';
import { CustomerSite } from './pages/CustomerSite';
import PaymentPage from './pages/PaymentPage';
import { SaasAdminDashboard } from './pages/SaasAdminDashboard';
import { GuestAccount } from './pages/GuestAccount';
import { GetSite } from './components/GetSite';
import type { Property, PropertyImage } from './types';

interface ErrorBoundaryProps { children: ReactNode; }
interface ErrorBoundaryState { hasError: boolean; error: string; }

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(e: Error): ErrorBoundaryState {
    return { hasError: true, error: e.message };
  }
  componentDidCatch(e: Error, info: React.ErrorInfo) {
    console.error('App ErrorBoundary caught:', e.message, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif', color: '#333' }}>
          <h1>Something went wrong</h1>
          <p style={{ color: '#666' }}>{this.state.error}</p>
          <button onClick={() => window.location.reload()} style={{ padding: '10px 20px', marginTop: '16px', cursor: 'pointer' }}>
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { initialize, user, refreshUser } = useAuth();
  const location = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  // Default to @surfhousebaja; will be updated via onPropertyLoaded once AdminSidebar loads from DB
  const [siteName, setSiteName] = useState('@surfhousebaja');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Set by CustomerSite when it loads a property — tells us who owns it
  const [currentPropertyOwnerId, setCurrentPropertyOwnerId] = useState<string | null>(null);
  // True when the logged-in user owns the currently-viewed property
  const isViewingOwnProperty = !!(user && currentPropertyOwnerId && user.id === currentPropertyOwnerId);
  const [showLogin, setShowLogin] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  // Controls the onboarding popup (triggered from sidebar button)
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Controls the GetSite popup (shown when guest clicks 'Get your own booking website')
  // David: "set this page to open with the GetSite.tsx already opened
  // and displayed on the page" -- defaults to true so localhost:5173/app
  // loads straight into the GetSite popup instead of requiring the
  // sidebar button click first. Flip back to false to restore the old
  // behavior.
  // BUT: AppContent is shared between /app (the main app) AND every
  // rendered property site (/props/<slug>) -- see App() below, both
  // routes mount the same component. The unconditional `true` meant a
  // property site loaded with GetSite already open too, including for
  // David himself visiting his own site as its admin. Scope the
  // convenience default to the main app only (window.__PROPERTY_DATA__
  // is only set on a rendered property site).
  const [showGetSite, setShowGetSite] = useState(() => !(window as any).__PROPERTY_DATA__);
  useEffect(() => {
    console.log('[DIAG showGetSite changed] ->', showGetSite);
  }, [showGetSite]);
  // Lifted state for GetSite → Home real-time preview
  const [scrapedProperty, setScrapedProperty] = useState<Partial<Property> | null>(null);
  const [scrapedImages, setScrapedImages] = useState<PropertyImage[]>([]);

  // Expose setShowGetSite as a window function so sidebar button can call it directly
  // (bypasses prop chain issues where the prop might be undefined)
  useEffect(() => {
    (window as any).__openGetSite = () => {
      // David: "Get your own booking website" is clicked from GuestSidebar,
      // which only ever renders on SOMEONE ELSE'S already-deployed /props/<slug>
      // page. That page's whole bundle -- router basename, embedded
      // window.__PROPERTY_DATA__ -- is pinned to THAT property. Opening
      // GetSite in place there meant a freshly created draft could never be
      // shown afterward (AdminSidebar's slug check still points at the
      // property whose page this is, not the new draft), which is what
      // looked like "I click Create Draft Site and nothing happens, still on
      // the old property, only a guest sidebar". /app has no property pinned
      // to it, so send them there first -- it's the only context a brand-new
      // draft can actually be continued in afterward.
      if ((window as any).__PROPERTY_DATA__) {
        sessionStorage.setItem('propbook_force_getsite', '1');
        window.location.href = '/app';
        return;
      }
      setShowGetSite(true);
    };
    return () => { delete (window as any).__openGetSite; };
  }, []);
  // David: one-shot flag set by __openGetSite above right before redirecting
  // to /app — lets the very next /app load force GetSite open and skip the
  // "existing owner, stop nagging" auto-close effect below just this once,
  // without weakening that effect for a normal /app visit.
  const forceGetSiteRef = useRef(false);
  useEffect(() => {
    if (sessionStorage.getItem('propbook_force_getsite') === '1') {
      sessionStorage.removeItem('propbook_force_getsite');
      forceGetSiteRef.current = true;
      setShowGetSite(true);
    }
  }, []);
  // Looked up once when user logs in — the slug of the user's own property
  const [_userPropertySlug, setUserPropertySlug] = useState<string | null>(null);

  // Resolve the user's property slug from the DB — look up directly by owner_id
  useEffect(() => {
    if (!user) { setUserPropertySlug(null); return; }
    supabase
      .from('properties')
      .select('slug')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setUserPropertySlug(data?.slug ?? null);
        // David: "created a draft, never saw an admin sidebar" -- on /app,
        // nothing was ever wiring up currentPropertyOwnerId at all (only
        // CustomerSite's per-property page did that, via onPropertyLoaded
        // below). isViewingOwnProperty was therefore ALWAYS false on /app,
        // for every non-admin-role user, so AdminSidebar could never render
        // there -- only GuestSidebar. Finding a property owned by this user
        // here means isViewingOwnProperty should be true on /app too.
        if (data?.slug && !(window as any).__PROPERTY_DATA__) {
          setCurrentPropertyOwnerId(user.id);
        }
      });
  }, [user]);

  // David: fires the instant a brand-new draft is saved (GetSite's "Create
  // Draft Site" button) -- sets ownership immediately rather than waiting on
  // the effect above to notice, which never re-runs on its own since `user`
  // doesn't change when a property is created. This is what actually flips
  // AdminSidebar on right after a draft is created, instead of leaving the
  // user stuck looking at GuestSidebar with nowhere to go.
  const handleSiteCreated = (propertyId: string, siteUrl: string) => {
    console.log('[DIAG handleSiteCreated] FIRED propertyId=', propertyId, 'siteUrl=', siteUrl, 'user=', !!user);
    if (!user) return;
    // David: this update to _userPropertySlug below re-triggers the "stop
    // nagging existing owners" effect further down, which immediately closed
    // GetSite (and its own Welcome-modal state along with it) the instant
    // ownership registered -- before the Welcome modal it was about to show
    // itself ever rendered. That effect is only guarded for the cross-
    // property redirect path (forceGetSiteRef), not this one. Creating a
    // draft is just as legitimate a reason to skip that auto-close, so set
    // the same guard here too.
    forceGetSiteRef.current = true;
    setCurrentPropertyOwnerId(user.id);
    const slugMatch = siteUrl.match(/\/props\/([^/?#]+)/);
    if (slugMatch) setUserPropertySlug(slugMatch[1]);
    // Give an immediate, visible confirmation even if the Welcome modal is
    // missed/dismissed quickly -- slide the admin sidebar open right away
    // rather than leaving the user staring at a page with nothing changed.
    setSidebarOpen(true);
  };

  // Once we learn the signed-in user already has a published property, stop
  // forcing the GetSite ("Create Your Site") popup open on /app -- that
  // convenience default is for brand-new/anonymous visitors only, not for an
  // existing owner returning to the site they already built. Scoped to /app
  // (no __PROPERTY_DATA__) since property-site pages already default this to
  // false on their own.
  useEffect(() => {
    console.log('[DIAG autoclose effect] fired. _userPropertySlug=', _userPropertySlug, 'forceGetSiteRef=', forceGetSiteRef.current, 'hasPropertyData=', !!(window as any).__PROPERTY_DATA__);
    if (forceGetSiteRef.current) { console.log('[DIAG autoclose effect] SKIPPED — forceGetSiteRef is true'); return; }
    if (_userPropertySlug && !(window as any).__PROPERTY_DATA__) {
      console.log('[DIAG autoclose effect] CLOSING GetSite now');
      setShowGetSite(false);
    }
  }, [_userPropertySlug]);
  const saveAllRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    initialize();
    // David 2026-10-22: these two restore THIS BROWSER's last-used editor
    // pick from localStorage -- useful for resuming an in-progress edit on
    // /app, but wrong on a public property page, where the only source of
    // truth is that property's own saved brand_color/font_accent (applied
    // separately, per-property, inside CustomerSite/Home). Running them
    // unconditionally let an unrelated earlier edit on this device --
    // on ANY property -- flash in and bleed into whatever a guest saw
    // before the real per-property value loaded a moment later.
    const onPropertyPage = window.location.pathname.startsWith('/props/') || !!(window as any).__PROPERTY_DATA__;
    if (!onPropertyPage) {
      loadBrandColor();
      loadFontAccent();
    }
    // Only clear stale onboarding session data when NOT returning from Stripe.
    // popup_scraped_data and popup_website_desc must survive the Stripe redirect
    // round-trip so migration has the user's scraped text and description.
    const returningFromStripe = !!(sessionStorage.getItem('stripe_paid_returning') || sessionStorage.getItem('stripe_session_id'));
    if (!returningFromStripe) {
      sessionStorage.removeItem('popup_website_desc');
      sessionStorage.removeItem('popup_scraped_data');
    }
  }, [initialize]);

  // ── Handle Stripe return redirect ( ?paid=true ) ─────────────────────────────
  // Lives here in App.tsx so it ALWAYS fires regardless of which popup is open.
  // After verifying the session, opens GetSite so handleSaveSiteInPopup runs inside it.
  useEffect(() => {
    if (!user) return;
    // Supabase's own auth client can strip URL query params shortly after load
    // (detectSessionInUrl cleanup) — this races against us reading ?paid=true here,
    // and Supabase can win before this effect (or even the first render) runs.
    // main.tsx captures the raw URL synchronously, before React or Supabase touch
    // anything, into sessionStorage.__earliest_url — fall back to that so a lost
    // race doesn't silently swallow a completed Stripe payment.
    const earliestUrl = sessionStorage.getItem('__earliest_url') || '';
    const earliestParams = new URLSearchParams(earliestUrl.split('?')[1] || '');
    const params = new URLSearchParams(window.location.search);
    const paid = params.get('paid') || earliestParams.get('paid');
    const sessionId = params.get('session_id') || earliestParams.get('session_id');
    // One-shot: whatever we needed from __earliest_url has now been read into
    // `paid`/`sessionId` above (and gets persisted into durable stripe_* flags
    // below before GetSite ever needs them). Clearing it here stops this same
    // stale capture from re-triggering the effect the NEXT time `user` changes
    // for an unrelated reason on a completely different page.
    sessionStorage.removeItem('__earliest_url');
    if (paid === 'true' && sessionId) {
      // Publish was triggered from the sidebar's Publish button (not GetSite) --
      // that flow verifies the session itself and deploys directly, so don't pop
      // GetSite back open on top of it. (David, 2026-09-21.)
      const pendingSidebarPublish = !!sessionStorage.getItem('pending_publish_property_id');
      // The user was in the sidebar when they clicked Publish; a full-page Stripe
      // redirect resets sidebarOpen to its default (closed), which would stop
      // AdminSidebar from loading `property` and prevent its own post-checkout
      // effect (which needs it) from ever running. Re-open it here.
      if (pendingSidebarPublish) setSidebarOpen(true);
      console.log('[App ?paid handler] Detected Stripe return, sessionId:', sessionId);
      // Remember where the user came from so we redirect back after the save completes
      sessionStorage.setItem('stripe_original_pathname', window.location.pathname);
      // Clear URL params without reload FIRST
      window.history.replaceState({}, '', window.location.pathname);
      // Persist so GetSite can read it even after URL params are cleared
      sessionStorage.setItem('stripe_session_id', sessionId);
      sessionStorage.setItem('stripe_paid_returning', '1');
      // Set role to admin so they see the admin sidebar immediately.
      // David 2026-09-22: this used to also open GetSite here when !pendingSidebarPublish,
      // for a "checkout initiated outside the sidebar" case -- but GetSite.tsx's own
      // internal handler that would have processed that state (verify session, run
      // handleSaveSiteInPopup) was itself confirmed dead and removed (see
      // claude/stability-plan-2026-09-22.md, item 1): the only live way to reach this
      // effect with paid=true&sessionId is the sidebar's handlePublishFromSidebar, which
      // always sets pending_publish_property_id first. Opening GetSite here would have
      // shown the normal onboarding UI with nothing left to act on the pending payment,
      // not actually completed anything -- so removed rather than left as a silent no-op.
      if (user.role !== 'admin') {
        (async () => {
          try {
            await supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id);
            await refreshUser();
          } catch (e: any) {
            console.error('[App ?paid handler] role update failed:', e?.message || e);
          }
        })();
      }
    }
  }, [user]);

  // Update page title when user logs in and we know their website name
  useEffect(() => {
    if (user) {
      const savedWebsiteName = sessionStorage.getItem('popup_website_name');
      if (savedWebsiteName && savedWebsiteName !== siteName) {
        setSiteName(savedWebsiteName);
      }
    }
  }, [user]);

  // Initialize auth modal state from URL params
  useEffect(() => {
    const authParam = new URLSearchParams(location.search).get('auth');
    if (authParam === 'login' && !user) setShowLogin(true);
    else if (authParam === 'signup' && !user) setShowSignup(true);
  }, [location.search, user]);

  const handleSaveAll = async () => {
    if (saveAllRef.current) await saveAllRef.current();
    setHasChanges(false);
    setIsEditing(false);
  };

  // Handles imported data from GetSite popup → pushes to Home page behind the popup
  // NOTE: imported.property_headline and imported.description are the user's edited values
  // from the input fields — use them directly, do NOT re-slice/replace.
  // David 2026-09-22: this used to be named property_title (matching a same-named bug in
  // GetSite.tsx/ImageGallery.tsx) even though it's the headline preview value -- renamed
  // to property_headline so the same field name carries the headline end-to-end: GetSite's
  // popup input -> this live preview -> the DB column -> the sidebar field -> the hero box.
  const handleGetSiteImported = (imported: {
    title: string;
    description?: string;
    property_headline?: string;
    hero_image?: string;
    images?: string[];
    location?: string;
    price?: string;
    guests?: number;
    bedrooms?: number;
    beds?: number;
    baths?: number;
    rating?: number;
    reviews?: number;
    host_name?: string;
  }) => {
    setSiteName(imported.title.startsWith('@') ? imported.title : '@' + imported.title);
    // David 2026-10-21: "The intro copy should be limited to only be 12 words so it
    // works on Mobile." Was 24 -- cut to 12 here and in ImageGallery.tsx's matching
    // live-edit limiter + GetSite.tsx's extractFirst12Words (same cap, independently
    // implemented in each place since this teaser gets produced from three different
    // entry points: the onboarding scrape, a live edit on the hero overlay, and here).
    // description = first 12 words (hero-image overlay teaser, via ImageGallery.tsx).
    // property_intro = full original text (below-photos section, via PropertyDetails.tsx).
    // Read the full original from sessionStorage so re-edits always have the untruncated text to
    // work from, then apply the 12-word limit for the teaser.
    let fullDesc = imported.description || '';
    // GetSite.tsx's onImported(...) calls never include a `location` field — there is no
    // location input anywhere in the onboarding popup, location only ever comes from the
    // original Airbnb scrape. Previously `location: imported.location || ''` silently WIPED
    // the real scraped location back to '' on every single field edit (headline, description,
    // and now website name too), because setScrapedProperty fully replaces the object. This
    // is the root cause of sites saved via the "already subscribed, skip Stripe" direct-save
    // path (handlePublish -> handleSaveSiteInPopup) coming out with an empty location: whatever
    // was left in this state right before that save is exactly what gets sent. Fix: recover the
    // real scraped location from sessionStorage (the same place fullDesc already falls back to),
    // and as a last resort keep whatever location was already in state instead of blanking it.
    let resolvedLocation = imported.location;
    try {
      const scrapedRaw = sessionStorage.getItem('popup_scraped_data');
      if (scrapedRaw) {
        const scraped = JSON.parse(scrapedRaw);
        if (scraped?.description) fullDesc = scraped.description;
        if (!resolvedLocation && scraped?.location) resolvedLocation = scraped.location;
      }
    } catch { /* use imported.description as fallback */ }
    // 12-word limit for the hero-overlay teaser. David 2026-10-22: add an
    // ellipsis when the cut lands mid-sentence (same rule as GetSite.tsx's
    // extractFirst12Words and ImageGallery.tsx's capIntroWords).
    const words = fullDesc.trim().split(/\s+/);
    let propertyIntro12 = fullDesc;
    if (words.length > 12) {
      const truncated = words.slice(0, 12).join(' ');
      propertyIntro12 = /[.!?]$/.test(truncated) ? truncated : `${truncated}…`;
    }
    setScrapedProperty(prev => ({
      title: imported.title,
      // property_headline: user's edited Property Headline input — respect it
      property_headline: imported.property_headline || imported.title,
      property_intro: fullDesc,
      description: propertyIntro12,
      location: resolvedLocation || (prev as any)?.location || '',
      price_per_night: imported.price || null,
      max_guests: imported.guests || null,
    }));
    if (imported.images && imported.images.length > 0) {
      setScrapedImages(imported.images.map((url, idx) => ({
        id: 'scraped-' + Date.now() + '-' + idx,
        property_id: 'scrape',
        url,
        position: idx + 1,
        is_featured: idx === 0,
        is_main: idx === 0,
        is_background: false,
        created_at: new Date().toISOString(),
      })));
    }
  };

  // authParam-derived values removed — now using useState above

  // Listen for static HTML buttons calling window.__openAdminSidebar
  useEffect(() => {
    function openAdmin() { setSidebarOpen(true); }
    document.addEventListener('open-admin-sidebar', openAdmin);
    return () => {
      document.removeEventListener('open-admin-sidebar', openAdmin);
    };
  }, []);

  // Listen for static HTML buttons calling window.__openGuestSidebar
  useEffect(() => {
    function openGuest() { setSidebarOpen(true); }
    document.addEventListener('open-guest-sidebar', openGuest);
    return () => {
      document.removeEventListener('open-guest-sidebar', openGuest);
    };
  }, []);

  return (
    <>
      <Layout
        isEditing={isEditing}
        onToggleEdit={() => setIsEditing(!isEditing)}
        hasChanges={hasChanges}
        onSaveChanges={handleSaveAll}
        siteName={siteName}
        onSiteNameChange={setSiteName}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenLogin={() => setShowLogin(true)}

      >
        {/* NOTE — urlSlug prop: when basename=/props/<slug> (isPropertySite), React Router strips the slug
             before useParams() sees it. window.location.pathname still has the full path, so App.tsx
             extracts it and passes urlSlug to CustomerSite. Debug: set window.__FORCE_SLUG__ in console. */}
        <Routes>
          <Route path="/" element={(window as any).__PROPERTY_DATA__ ? (() => { const pathname = typeof window < 'u' ? window.location.pathname : ''; const slugMatch = pathname.match(/\/props\/([^/]+)/); const urlSlug = slugMatch?.[1]; return <CustomerSite onSiteNameChange={setSiteName} isEditing={isEditing} registerSaveAll={(fn) => { saveAllRef.current = fn; return true; }} onPropertyLoaded={(ownerId) => setCurrentPropertyOwnerId(ownerId)} onHasChanges={setHasChanges} scrapedProperty={scrapedProperty} scrapedImages={scrapedImages} urlSlug={urlSlug} />; })() : (<Home onOpenLogin={() => setShowLogin(true)} isEditing={isEditing} onHasChanges={setHasChanges} registerSaveAll={(fn) => { saveAllRef.current = fn; return true; }} onSiteNameChange={setSiteName} onOpenSidebar={() => setSidebarOpen(true)} forceOpenOnboarding={showOnboarding} onOnboardingClose={() => setShowOnboarding(false)} scrapedProperty={scrapedProperty} scrapedImages={scrapedImages} />)} />
          <Route path="/auth/confirm" element={<EmailConfirmation />} />
          <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/" replace />} />
          <Route path="/property-admin" element={user ? <PropertyAdmin /> : <Navigate to="/login" replace />} />
                  <Route path="/pay/:bookingId" element={<PaymentPage />} />
          <Route path="/props/:slug" element={<CustomerSite onSiteNameChange={setSiteName} isEditing={isEditing} registerSaveAll={(fn) => { saveAllRef.current = fn; return true; }} onPropertyLoaded={(ownerId) => setCurrentPropertyOwnerId(ownerId)} onHasChanges={setHasChanges} scrapedProperty={scrapedProperty} scrapedImages={scrapedImages} urlSlug={undefined} />} />
          <Route path="/saas-admin" element={user?.role === 'saas_admin' ? <SaasAdminDashboard /> : <Navigate to="/" replace />} />
          <Route path="/guest/account" element={<GuestAccount />} />
        </Routes>
      </Layout>
      {showLogin && (
        <Login
          onSuccess={() => {
            setShowLogin(false);
            const url = new URL(window.location.href);
            url.searchParams.delete('auth');
            window.history.replaceState({}, '', url.pathname + url.search);
            window.location.reload();
          }}
          onClose={() => {
            setShowLogin(false);
            const url = new URL(window.location.href);
            url.searchParams.delete('auth');
            window.history.replaceState({}, '', url.pathname + url.search);
          }}
          onSwitchToSignup={() => { setShowLogin(false); setShowSignup(true); }}
        />
      )}
      {showSignup && (
        <Signup
          onSuccess={() => {
            setShowSignup(false);
            const url = new URL(window.location.href);
            url.searchParams.delete('auth');
            window.history.replaceState({}, '', url.pathname + url.search);
            window.location.reload();
          }}
          onClose={() => {
            setShowSignup(false);
            const url = new URL(window.location.href);
            url.searchParams.delete('auth');
            window.history.replaceState({}, '', url.pathname + url.search);
          }}
          onSwitchToLogin={() => { setShowSignup(false); setShowLogin(true); }}
        />
      )}
      {/* David 2026-10-20: "I would prefer it if we did not offer the choice
          to stay on the site and edit someone else's site... have them only
          see the site as if they were a guest visiting. So only guest
          sidebar and No edit button." -- the `|| user.role === 'admin'`
          bypass here let ANY admin-role account (every property owner's
          account is role:'admin', not just platform staff -- see
          AdminSidebarBundle's isAdmin comment) edit ANY other owner's
          property just by landing on its page and dismissing the "Property
          conflict" modal's "stay here and keep editing" option. Gating
          purely on isViewingOwnProperty (unchanged, independent ownership
          check) removes that: a non-owner, admin-role or not, now always
          gets GuestSidebar -- view-only, no PropertySection/edit UI. This
          also makes AdminSidebarBundle's "Property conflict" modal, its
          "Not Your Property" lock screen, and its isAccessDenied/migration-
          mode banner unreachable (AdminSidebar only ever mounts for the
          real owner now) -- left in place as dead code rather than ripped
          out in this same pass, since isAccessDenied threads through
          several other branches in that file that weren't audited here. */}
      {/* AdminSidebar — shown only when user owns the current property */}
      {user && isViewingOwnProperty && (
        <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onPropertyLoaded={setSiteName} onOpenOnboarding={() => setShowOnboarding(true)} showGetSite={showGetSite} setShowGetSite={setShowGetSite} />
      )}

      {/* GuestSidebar — shown whenever user is logged in but doesn't own this property, admin-role accounts included */}
      {user && !isViewingOwnProperty && (
        <GuestSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} currentSlug={(window as any).__PROPERTY_DATA__?.slug || ''} onOpenGetSite={() => setShowGetSite(true)} onOpenLogin={() => setShowLogin(true)} />
      )}




      {/* GetSite popup — shown when guest clicks 'Get your own booking website' in sidebar */}
      {showGetSite && (
        <GetSite onClose={() => setShowGetSite(false)} onImported={handleGetSiteImported} onSiteNameChange={setSiteName} onSiteCreated={handleSiteCreated} onOpenLogin={() => setShowLogin(true)} />
      )}
    </>
  );
}

function App() {
  const Router = (window as any).__USE_HASH_ROUTER__ ? HashRouter : BrowserRouter;
  const isPropertySite = !!(window as any).__PROPERTY_DATA__;
  const propData = (window as any).__PROPERTY_DATA__;
  // Property sites: basename=/props/<slug> so URL /props/ravenswortha1 strips to / and matches path="/"
  // Main app: basename=/app so URL /app/ strips to / and matches path="/"
  const basename = isPropertySite && propData?.slug ? `/props/${propData.slug}` : '/app';
  return (
    <Router basename={basename}>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </Router>
  );
}

export default App;
