// Shared font accent utility for the New Site Template.

export const FONT_OPTIONS = [
  'Playfair Display',
  'Libre Baskerville',
  'Oswald',
  'Sintony',
  'Raleway',
  'Nixie One',
  'Oleo Script',
  'Unbounded',
  'Urbanist',
  'Barrio',
  'Advent Pro',
  'DM Serif Display',
  'Fraunces',
  'Archivo Black',
];

export function saveFontAccent(font: string) {
  localStorage.setItem('site-font-accent', font);
  applyFontAccent(font);
}

export function applyFontAccent(font: string) {
  console.log('[applyFontAccent] applying font=', font);
  document.documentElement.style.setProperty('--font-accent', `'${font}', serif`);
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
