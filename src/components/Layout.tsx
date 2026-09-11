import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Home, LogIn, Share, User } from 'lucide-react';
import { useAuth } from '../store/auth';
import { useProperty } from '../store/property';
import ColorPicker from './ColorPicker';
import { applyFontAccent, loadFontAccent } from '../lib/fontAccent';

export function Layout({ children, isEditing, onToggleEdit, hasChanges, onSaveChanges, siteName, onSiteNameChange, onOpenSidebar, onOpenLogin, onOpenGuestSidebar }: { 
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

  const handleShare = async () => {
    // On a published property site, the Share button opens the in-page share/QR
    // popup (CustomerSite.tsx) instead of the OS share sheet — same button, same nav,
    // just a different action depending on what page we're on.
    if (activeProperty) {
      window.dispatchEvent(new CustomEvent('propbook:open-share-popup'));
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
        // (CustomerSite.tsx) is the primary share UX now.
      } catch (clipboardError) {
        console.error('Failed to copy to clipboard:', clipboardError);
        alert('Unable to share. Please copy the URL manually.');
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
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
    </div>
  );
}