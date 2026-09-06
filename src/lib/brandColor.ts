// Persists brand color to localStorage so it survives page reloads

export function saveBrandColor(hex: string) {
  const hover = adjustBrightness(hex, -20);
  const disabled = adjustBrightness(hex, 35);
  document.documentElement.style.setProperty('--brand', hex);
  document.documentElement.style.setProperty('--brand-hover', hover);
  document.documentElement.style.setProperty('--brand-disabled', disabled);
  try {
    localStorage.setItem('site-brand-color', JSON.stringify({
      brand: hex,
      brandHover: hover,
      brandDisabled: disabled,
    }));
  } catch (e) {}
}

export function adjustBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + percent));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + percent));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + percent));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function loadBrandColor() {
  try {
    const raw = localStorage.getItem('site-brand-color');
    if (!raw) return;
    const { brand, brandHover, brandDisabled } = JSON.parse(raw);
    document.documentElement.style.setProperty('--brand', brand || '#C47756');
    document.documentElement.style.setProperty('--brand-hover', brandHover || adjustBrightness(brand || '#C47756', -20));
    document.documentElement.style.setProperty('--brand-disabled', brandDisabled || adjustBrightness(brand || '#C47756', 35));
  } catch (e) {}
}
