// Shared font accent utility for the New Site Template.
import { markAppearanceEdited, hasAppearanceBeenEdited } from './appearanceGuard';

export const FONT_OPTIONS = [
  'Playfair Display',
  'Oswald',
  'Sintony',
  'Nixie One',
  'Urbanist',
  'Barrio',
  'Advent Pro',
  'DM Serif Display',
  'Fraunces',
  'Archivo Black',
  'Imbue',
  'Instrument Serif',
  'Alumni Sans Pinstripe',
  'Saira Extra Condensed',
  'Stint Ultra Condensed',
  'Asap Condensed',
];

// David: these six were added after the general title-size pass and
// render noticeably smaller/thinner at the same font-size than the
// original set (condensed widths / light weights) -- so they get a 25%
// size boost over every other font's title size, instead of the
// standard size. Drives --title-size-multiplier below, which multiplies
// whichever --title-font-size-base is currently active (set by CSS media
// queries in index.css, matched to the landing page's .hero__title) --
// this way the boost layers on top of the responsive base size instead of
// replacing it with a fixed clamp string that would silently defeat those
// media queries (an inline style always beats a stylesheet rule).
export const LARGE_TITLE_FONTS = [
  'Imbue',
  'Instrument Serif',
  'Alumni Sans Pinstripe',
  'Saira Extra Condensed',
  'Stint Ultra Condensed',
  'Asap Condensed',
];

const TITLE_SIZE_MULTIPLIER_STANDARD = '1';
const TITLE_SIZE_MULTIPLIER_LARGE = '1.25'; // +25% over standard

export function saveFontAccent(font: string) {
  markAppearanceEdited();
  localStorage.setItem('site-font-accent', font);
  applyFontAccent(font);
}

// Use this (not applyFontAccent) when applying a font read from a loaded
// property/server record, rather than from the user's own picker -- it's a
// no-op once the user has already made a manual choice this session, so a
// stale or late-arriving fetch can't revert their pick.
export function applyFontAccentFromServer(font: string) {
  if (hasAppearanceBeenEdited()) return;
  applyFontAccent(font);
}

export function applyFontAccent(font: string) {
  console.log('[applyFontAccent] applying font=', font);
  document.documentElement.style.setProperty('--font-accent', `'${font}', serif`);
  document.documentElement.style.setProperty(
    '--title-size-multiplier',
    LARGE_TITLE_FONTS.includes(font) ? TITLE_SIZE_MULTIPLIER_LARGE : TITLE_SIZE_MULTIPLIER_STANDARD
  );
  // Update all headline elements
  document.querySelectorAll('h1').forEach(el => {
    (el as HTMLElement).style.fontFamily = `'${font}', serif`;
  });
  // Update title and price inputs in edit mode
  document.querySelectorAll('.edit-title-input, .edit-price-input').forEach(el => {
    (el as HTMLElement).style.fontFamily = `'${font}', serif`;
  });
}

export function loadFontAccent() {
  const saved = localStorage.getItem('site-font-accent');
  console.log('[loadFontAccent] saved=', saved);
  if (saved && FONT_OPTIONS.includes(saved)) {
    applyFontAccent(saved);
    return saved;
  }
  return 'Playfair Display';
}
