// ULTRA-EARLY capture + visual flash — fires before any React, before DOMContentLoaded.
// Shows full-screen overlay so user can SEE the URL even if it vanishes in 0.2s.
(function earliestCapture() {
  const url = window.location.href;
  if (url.includes('paid=') || url.includes('session_id=')) {
    sessionStorage.setItem('__earliest_url', url);
    sessionStorage.setItem('__earliest_time', Date.now().toString());
    document.title = 'REDIRECT: ' + url;
    // Full-screen flash — stays visible until React takes over
    const flash = document.createElement('div');
    flash.id = '__url_flash';
    flash.style.cssText = 'position:fixed;inset:0;background:#fffde7;z-index:999999;font-size:24px;font-family:monospace;padding:40px;overflow:auto;word-break:break-all;';
    flash.innerHTML = '<h2 style="color:red">STRIPE RETURN URL:</h2><pre style="font-size:18px;word-break:break-all">' + url + '</pre><p style="color:#666">This flash will vanish in ~3 seconds as React mounts. Check console for saved value.';
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
import './components/sidebar.css';
import './components/Editmode.css';

loadBrandColor();

createRoot(document.getElementById('root')!).render(<App />);
