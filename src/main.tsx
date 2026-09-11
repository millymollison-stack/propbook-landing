// ULTRA-EARLY capture + visual flash — fires before any React, before DOMContentLoaded.
// Shows full-screen overlay so user can SEE the URL even if it vanishes in 0.2s.
(function earliestCapture() {
  const url = window.location.href;
  if (url.includes('paid=') || url.includes('session_id=')) {
    sessionStorage.setItem('__earliest_url', url);
    sessionStorage.setItem('__earliest_time', Date.now().toString());
    // eslint-disable-next-line no-console
    console.log('[Stripe return] captured URL:', url);
    // Styled like the app's existing "Saving your data..." popup (GetSite.tsx)
    // instead of the old raw red debug dump — stays visible until React takes over.
    const flash = document.createElement('div');
    flash.id = '__url_flash';
    flash.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    flash.innerHTML =
      '<div style="background:rgba(10,10,10,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:36px 40px;max-width:360px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,0.4);">' +
        '<div style="font-size:2.2rem;margin-bottom:12px;">✅</div>' +
        '<h2 style="font-size:1.15rem;font-weight:700;margin:0 0 8px;color:#fff;">Payment received!</h2>' +
        '<p style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin:0 0 20px;line-height:1.5;">Finishing checkout and saving your site…</p>' +
        '<div style="width:40px;height:40px;border-radius:50%;border:3px solid rgba(255,255,255,0.2);border-top-color:#fff;margin:0 auto;animation:__earliestSpin 0.8s linear infinite;"></div>' +
      '</div>' +
      '<style>@keyframes __earliestSpin { to { transform: rotate(360deg); } }</style>';
    document.body.appendChild(flash);
    setTimeout(() => { const f = document.getElementById('__url_flash'); if (f) f.remove(); }, 3000);
  } else {
    sessionStorage.setItem('__earliest_url_noparams', url);
  }
})();

import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { loadBrandColor } from './lib/brandColor';
import './index.css';

loadBrandColor();

createRoot(document.getElementById('root')!).render(<App />);
