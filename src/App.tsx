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
import { Onboarding } from './pages/Onboarding';
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
  const [showGetSite, setShowGetSite] = useState(false);
  // Lifted state for GetSite → Home real-time preview
  const [scrapedProperty, setScrapedProperty] = useState<Partial<Property> | null>(null);
  const [scrapedImages, setScrapedImages] = useState<PropertyImage[]>([]);

  // Expose setShowGetSite as a window function so sidebar button can call it directly
  // (bypasses prop chain issues where the prop might be undefined)
  useEffect(() => {
    (window as any).__openGetSite = () => setShowGetSite(true);
    return () => { delete (window as any).__openGetSite; };
  }, []);
  // Looked up once when user logs in — the slug of the user's own property
  const [userPropertySlug, setUserPropertySlug] = useState<string | null>(null);

  // Resolve the user's property slug from the DB — look up directly by owner_id
  useEffect(() => {
    if (!user) { setUserPropertySlug(null); return; }
    supabase
      .from('properties')
      .select('slug')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setUserPropertySlug(data?.slug ?? null));
  }, [user]);
  const saveAllRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    initialize();
    loadBrandColor();
    loadFontAccent();
    // Clear stale onboarding session data so it doesn't override nav title
    // (but read popup_website_name first — we use it for the page title above)
    sessionStorage.removeItem('popup_website_desc');
    sessionStorage.removeItem('popup_scraped_data');
  }, [initialize]);

  // ── Handle Stripe return redirect ( ?paid=true ) ─────────────────────────────
  // Lives here in App.tsx so it ALWAYS fires regardless of which popup is open.
  // After verifying the session, opens GetSite so handleSaveSiteInPopup runs inside it.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const paid = params.get('paid');
    const sessionId = params.get('session_id');
    if (paid === 'true' && sessionId) {
      console.log('[App ?paid handler] Detected Stripe return, sessionId:', sessionId);
      // Remember where the user came from so we redirect back after the save completes
      sessionStorage.setItem('stripe_original_pathname', window.location.pathname);
      // Clear URL params without reload FIRST
      window.history.replaceState({}, '', window.location.pathname);
      // Persist so GetSite can read it even after URL params are cleared
      sessionStorage.setItem('stripe_session_id', sessionId);
      sessionStorage.setItem('stripe_paid_returning', '1');
      // Set role to admin so they see the admin sidebar immediately — wait for it to complete
      // before opening GetSite so the sidebar shows the correct state on first render
      if (user.role !== 'admin') {
        supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id).then(() => {
          refreshUser().then(() => setShowGetSite(true));
        });
      } else {
        setShowGetSite(true);
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
  // NOTE: imported.property_title and imported.description are the user's edited values
  // from the input fields — use them directly, do NOT re-slice/replace.
  const handleGetSiteImported = (imported: {
    title: string;
    description?: string;
    property_title?: string;
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
    // property_intro = first 24 words of description (shown under photos on the published page).
    // Read the full original from sessionStorage so re-edits always have the untruncated text to
    // work from, then apply the 24-word limit for the page display.
    let fullDesc = imported.description || '';
    try {
      const scrapedRaw = sessionStorage.getItem('popup_scraped_data');
      if (scrapedRaw) {
        const scraped = JSON.parse(scrapedRaw);
        if (scraped?.description) fullDesc = scraped.description;
      }
    } catch { /* use imported.description as fallback */ }
    // 24-word limit for the published page text
    const words = fullDesc.trim().split(/\s+/);
    const propertyIntro24 = words.length > 24 ? words.slice(0, 24).join(' ') : fullDesc;
    setScrapedProperty({
      title: imported.title,
      // property_title: user's edited Property Headline input — respect it
      property_title: imported.property_title || imported.title,
      property_intro: propertyIntro24,
      description: fullDesc,
      location: imported.location || '',
      price_per_night: imported.price || null,
      max_guests: imported.guests || null,
    });
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
          <Route path="/" element={(window as any).__PROPERTY_DATA__ ? (() => { const pathname = typeof window < 'u' ? window.location.pathname : ''; const slugMatch = pathname.match(/\/props\/([^/]+)/); const urlSlug = slugMatch?.[1]; return <CustomerSite onSiteNameChange={setSiteName} isEditing={isEditing} registerSaveAll={(fn) => { saveAllRef.current = fn; return true; }} onPropertyLoaded={(ownerId) => setCurrentPropertyOwnerId(ownerId)} scrapedProperty={scrapedProperty} scrapedImages={scrapedImages} urlSlug={urlSlug} />; })() : (<Home onOpenLogin={() => setShowLogin(true)} isEditing={isEditing} onHasChanges={setHasChanges} registerSaveAll={(fn) => { saveAllRef.current = fn; return true; }} onSiteNameChange={setSiteName} onOpenSidebar={() => setSidebarOpen(true)} forceOpenOnboarding={showOnboarding} onOnboardingClose={() => setShowOnboarding(false)} scrapedProperty={scrapedProperty} scrapedImages={scrapedImages} />)} />
          <Route path="/auth/confirm" element={<EmailConfirmation />} />
          <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/" replace />} />
          <Route path="/property-admin" element={user ? <PropertyAdmin /> : <Navigate to="/login" replace />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/pay/:bookingId" element={<PaymentPage />} />
          <Route path="/props/:slug" element={<CustomerSite onSiteNameChange={setSiteName} isEditing={isEditing} registerSaveAll={(fn) => { saveAllRef.current = fn; return true; }} onPropertyLoaded={(ownerId) => setCurrentPropertyOwnerId(ownerId)} scrapedProperty={scrapedProperty} scrapedImages={scrapedImages} urlSlug={undefined} />} />
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
      {/* AdminSidebar — shown when user owns the current property OR is an admin */}
      {user && (isViewingOwnProperty || user.role === 'admin') && (
        <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onPropertyLoaded={setSiteName} onOpenOnboarding={() => setShowOnboarding(true)} showGetSite={showGetSite} setShowGetSite={setShowGetSite} />
      )}

      {/* GuestSidebar — shown when user is logged in but doesn't own this property (and not admin) */}
      {user && !isViewingOwnProperty && user.role !== 'admin' && (
        <GuestSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} currentSlug={location.pathname.replace('/props/', '')} onOpenGetSite={() => setShowGetSite(true)} onOpenLogin={() => setShowLogin(true)} />
      )}




      {/* GetSite popup — shown when guest clicks 'Get your own booking website' in sidebar */}
      {showGetSite && (
        <GetSite onClose={() => setShowGetSite(false)} onImported={handleGetSiteImported} onSiteNameChange={setSiteName} />
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
