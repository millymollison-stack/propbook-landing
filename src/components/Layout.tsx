import React, { useEffect } from 'react';
import './Layout.css';
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
        alert('Link copied to clipboard!');
      } catch (clipboardError) {
        console.error('Failed to copy to clipboard:', clipboardError);
        alert('Unable to share. Please copy the URL manually.');
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <header className="absolute top-0 left-0 right-0 z-50 header-transparent">
        <nav className="max-w-7xl mx-auto px-4 sm:px-8 md:px-12 h-16 flex items-center justify-between">
          <a href={window.location.pathname} className="flex items-center space-x-2 text-white hover:text-white no-underline">
            <span className="text-lg font-medium">{siteName || "@propbook"}</span>
          </a>
          
          <div className="flex items-center space-x-3">
            {showEditButton && (
              <>
                {hasChanges ? (
                  <button
                    onClick={() => { onSaveChanges?.(); }}
                    className="px-3 py-1.5 rounded text-sm font-bold transition-all bg-green-600 hover:bg-green-700 text-white animate-pulse"
                  >
                    Save Now
                  </button>
                ) : isEditing ? (
                  <button
                    onClick={() => { onToggleEdit?.(); }}
                    className="px-3 py-1.5 rounded text-sm font-bold transition-all bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white"
                  >
                    Save
                  </button>
                ) : (
                  <button
                    onClick={() => onToggleEdit?.()}
                    className="edit-btn"
                  >
                    Edit
                  </button>
                )}
              </>
            )}
            <button
              onClick={handleShare}
              className="flex items-center space-x-1 text-white/80 hover:text-white text-sm"
            >
              <Share className="h-4 w-4" />
              <span className="hidden sm:inline">Share</span>
            </button>
            <div className="elfsight-app-723b3461-972c-4953-af10-a9662ce4a71b" data-elfsight-app-lazy></div>
            {user ? (
              <button
                onClick={() => { if (user) { onOpenSidebar?.(); } else { onOpenLogin?.(); } }}
                className="flex items-center space-x-1 px-3 py-1.5 bg-white/20 backdrop-blur-sm border border-white/15 rounded text-white font-bold text-sm hover:bg-white/30"
              >
                <User className="h-4 w-4" />
                <span>{user.full_name?.split(' ')[0] || 'Profile'}</span>
              </button>
            ) : (
              <button
                onClick={() => onOpenLogin?.()}
                className="px-4 py-2 bg-white/20 backdrop-blur-sm border border-white/15 rounded text-white/90 hover:bg-white/30 hover:text-white text-sm transition-all"
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

      <ColorPicker isEditing={isEditing} />
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