import React, { useEffect, useState } from 'react';
import { Share, User, X } from 'lucide-react';
import { useAuth } from '../store/auth';
import { useProperty } from '../store/property';
import ColorPicker from './ColorPicker';

export function Layout({ children, isEditing, onToggleEdit, hasChanges, onSaveChanges, siteName, onOpenSidebar, onOpenLogin}: { 
  children: React.ReactNode; 
  isEditing?: boolean;
  siteName?: string;
  onSiteNameChange?: (name: string) => void; 
  onToggleEdit?: () => void;
  hasChanges?: boolean;
  onSaveChanges?: () => void;
  onOpenSidebar?: () => void;
  onOpenLogin?: () => void;
  onOpenGuestSidebar?: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const activeProperty = useProperty(s => s.activeProperty);
  const isOwner = activeProperty?.owner_id === user?.id;
  // Show edit button for admins on property pages (if owner) or on any non-property page when logged in
  const showEditButton = isAdmin && (isOwner || !window.location.pathname.startsWith('/props/'));

  useEffect(() => {
    if (document.querySelector('script[src="https://elfsightcdn.com/platform.js"]')) return;
    const script = document.createElement('script');
    script.src = 'https://elfsightcdn.com/platform.js';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  // ── Share / QR popup ─────────────────────────────────────────────────────────
  // Lives here (not in CustomerSite.tsx) so the same black, centered-QR popup
  // shows no matter which page mounts Layout — it used to only work on the
  // published CustomerSite view because CustomerSite was the only thing
  // listening for the button's event; on Home.tsx (the default /app view,
  // where activeProperty is ALSO set) nothing was listening, so the button
  // was a true no-op. Round 6 follow-up: David flagged the button "doesn't
  // do anything" — this was the actual cause, not the popup's styling
  // (which was already correct).
  const [showSharePopup, setShowSharePopup] = useState(false);
  const [sharePopupClosing, setSharePopupClosing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const siteUrl = activeProperty?.site_url || (activeProperty?.slug ? `https://www.propbook.pro/props/${activeProperty.slug}` : window.location.href);
  // Display-only: David -- "Remove the https://www. from the url" -- the
  // full siteUrl (with protocol) is still what's copied and QR-encoded.
  const displaySiteUrl = siteUrl.replace(/^https?:\/\/(www\.)?/, '');
  const qrCodeUrl = siteUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(siteUrl)}` : '';
  const handleCopySiteUrl = () => {
    // try/catch: some embedded/sandboxed browser contexts throw
    // synchronously on clipboard access instead of rejecting the promise --
    // guard so the "Link copied!" message always shows either way.
    try {
      navigator.clipboard?.writeText(siteUrl).catch(() => {});
    } catch {}
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // Animate the popup back into the nav's Share icon, then dismiss it.
  const closeSharePopup = () => {
    setSharePopupClosing(true);
    setTimeout(() => {
      setShowSharePopup(false);
      setSharePopupClosing(false);
    }, 320);
  };

  // Detect first visit after publishing — GetSite/sidebar redirects with ?published=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('published') === '1') {
      window.history.replaceState({}, '', window.location.pathname);
      setShowSharePopup(true);
      const timer = setTimeout(() => closeSharePopup(), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleShare = async () => {
    // On a property (activeProperty set — true on both the published
    // CustomerSite view and Home.tsx's own-site preview/editing view), Share
    // opens the in-page black/QR popup instead of the OS share sheet.
    if (activeProperty) {
      setShowSharePopup(true);
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({
          title: siteName || '@propbook',
          url: window.location.href,
        });
      } else {
        throw new Error('Share API not supported');
      }
    } catch (error) {
      try {
        await navigator.clipboard.writeText(window.location.href);
        // Silent copy — no native alert() anymore, the styled share/QR popup
        // above is the primary share UX now.
      } catch (clipboardError) {
        console.error('Failed to copy to clipboard:', clipboardError);
        alert('Unable to share. Please copy the URL manually.');
      }
    }
  };

  return (
    // David: double scrollbar on the right, present on every page load
    // regardless of sidebar state -- root cause is here, not the sidebar.
    // `overflow-x-hidden` with no overflow-y set makes the CSS spec compute
    // overflow-y as `auto` on this element too (a UA cannot leave one axis
    // `visible` while the other is not). Any child bleeding even 1px past
    // this div's bottom (normal with min-h-screen + flex-col) then makes
    // *this div* its own scroll container, with its own scrollbar, right
    // next to the real document scrollbar. `overflow-y-visible` forces
    // vertical scrolling back onto the document only.
    <div className="min-h-screen flex flex-col overflow-x-hidden overflow-y-visible">
      <header className="site-nav-header header-transparent">
        <nav className="site-nav-shell">
          <a href={window.location.pathname} className="site-nav-brand">
            <span className="site-nav-brand-text">{siteName || "@propbook"}</span>
          </a>

          <div className="site-nav-actions">
            {showEditButton && (
              <>
                {hasChanges ? (
                  <button
                    onClick={() => { onSaveChanges?.(); }}
                    className="nav-btn nav-btn-success animate-pulse"
                  >
                    Save Now
                  </button>
                ) : isEditing ? (
                  <button
                    onClick={() => { onToggleEdit?.(); }}
                    className="nav-btn nav-btn-solid"
                  >
                    Save
                  </button>
                ) : (
                  <button
                    onClick={() => onToggleEdit?.()}
                    className="nav-btn nav-btn-solid"
                  >
                    Edit
                  </button>
                )}
              </>
            )}
            <button
              onClick={handleShare}
              className="nav-share-btn"
            >
              <Share className="h-4 w-4" />
              <span className="nav-share-label">Share</span>
            </button>
            <div className="elfsight-app-723b3461-972c-4953-af10-a9662ce4a71b" data-elfsight-app-lazy></div>
            {user ? (
              <button
                onClick={() => { if (user) { onOpenSidebar?.(); } else { onOpenLogin?.(); } }}
                className="nav-btn nav-btn-glass"
              >
                <User className="h-4 w-4" />
                <span>{user.full_name?.split(' ')[0] || 'Profile'}</span>
              </button>
            ) : (
              <button
                onClick={() => onOpenLogin?.()}
                className="nav-btn nav-btn-glass"
              >
                Sign In
              </button>
            )}
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <ColorPicker isEditing={isEditing} propertyId={activeProperty?.id} />
      <footer className="bg-gray-50 border-t">
        {isEditing ? null : (
          <div className="redbanner">
            {/* TODO: restore booking callout once Go Live is wired */}
            {/* <p className="text-base sm:text-lg font-medium">Book Direct, No Airbnb Fees, Chat with Host.</p> */}
          </div>
        )}
        <div className={`copyright-footer${isEditing ?? false ? '' : ' footer-pad-top'}`}>
          <p className="copyright-text">
            © {new Date().getFullYear()} {siteName || '@propbook'}. All rights reserved.
          </p>
        </div>
      </footer>

      {/* ── Share popup ─────────────────────────────────────────────────────────── */}
      {showSharePopup && (
        <div
          className={`cs-share-overlay${sharePopupClosing ? ' closing' : ''}`}
          onClick={(e) => { if (e.target === e.currentTarget) closeSharePopup(); }}
        >
          {/* Centered normally; when closing, shrinks and slides up toward the Share icon
              in the top-right of the nav so the popup reads as "collapsing back into it". */}
          <div className={`cs-share-modal${sharePopupClosing ? ' closing' : ''}`}>
            {/* Same floating-X close system as every other dark modal
                (auth-modal, popup-modal) -- David: "remember consistency
                on everything". */}
            <button className="popup-close" onClick={closeSharePopup} aria-label="Close"><X className="h-5 w-5" /></button>

            {/* David: remove the big blue share icon from the top of this
                popup. */}
            {/* Same changeable accent-font title class every other title in
                the app uses. */}
            <h2 className="hero-title cs-share-title">Share this link with your audience</h2>
            <p className="cs-share-subtitle">Scan the QR code or share the link.</p>

            {/* QR Code -- already per-property (built from siteUrl, which is
                activeProperty.site_url / slug) */}
            {qrCodeUrl && (
              <div className="cs-share-qr-wrap">
                <img src={qrCodeUrl} alt="QR Code" width={160} height={160} className="cs-share-qr-img" />
              </div>
            )}

            {/* URL -- click to copy (buttons removed: "it's obvious what to
                do"). Displayed without the https://www. prefix; the full
                URL is still what actually gets copied and QR-encoded. */}
            <div
              className="cs-share-url-box"
              onClick={handleCopySiteUrl}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCopySiteUrl(); }}
            >
              {displaySiteUrl}
            </div>
            {linkCopied && <p className="cs-share-copied">Link copied!</p>}
          </div>
        </div>
      )}
    </div>
  );
}