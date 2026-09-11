import { create } from 'zustand';
import type { Property } from '../types';

interface PropertyState {
  title: string | null;
  setTitle: (title: string) => void;
  // The property currently being viewed in CustomerSite / the URL slug
  activeProperty: Property | null;
  setActiveProperty: (prop: Property | null) => void;
}

// Onboarding/edit screens stash the field the user is currently typing into one of
// these global, unscoped sessionStorage keys and treat "whatever's in sessionStorage"
// as authoritative regardless of which property is active. Nothing used to clear them
// on a property switch, so editing Property A then switching to Property B in the same
// tab let B's edit screens pick up A's leftover values (headline, description, brand
// color, scraped data, etc.) — the "data following the user between properties" bug.
// This is every 'popup_*' key currently used anywhere in the app (kept in sync by grep
// over src/ for sessionStorage.(get|set|remove)Item('popup_...') — see PROPBOOK memory).
const POPUP_SESSION_KEYS = [
  'popup_brand_color', 'popup_design', 'popup_extras_ads', 'popup_extras_analytics',
  'popup_extras_seo', 'popup_extras_social', 'popup_font_accent', 'popup_hosting',
  'popup_plan', 'popup_property_headline', 'popup_property_id', 'popup_property_intro',
  'popup_property_name', 'popup_published_slug', 'popup_scraped_data', 'popup_site_phase',
  'popup_site_url', 'popup_user_website_name', 'popup_website_desc', 'popup_website_name',
];

function clearPopupSessionKeys() {
  try {
    POPUP_SESSION_KEYS.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* sessionStorage unavailable (SSR / privacy mode) — nothing to clear */ }
}

export const useProperty = create<PropertyState>((set, get) => ({
  title: null,
  setTitle: (title) => set({ title }),
  activeProperty: null,
  setActiveProperty: (prop) => {
    const prevId = get().activeProperty?.id;
    const nextId = prop?.id;
    // Only clear on an actual A -> B switch between two different real properties —
    // NOT on the null <-> property transitions that happen on ordinary mount/unmount
    // (e.g. Home.tsx sets this on every render while onboarding a brand-new property,
    // which itself is actively writing these same keys — clearing then would break
    // onboarding, not fix a leak).
    if (prevId && nextId && prevId !== nextId) {
      clearPopupSessionKeys();
    }
    set({ activeProperty: prop });
  },
}));
