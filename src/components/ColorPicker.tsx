import ReactDOM from 'react-dom';
import { useState, useRef, useEffect } from 'react';
import { Palette, X, Check } from 'lucide-react';
import { saveBrandColor, loadBrandColor } from '../lib/brandColor';
import { FONT_OPTIONS, saveFontAccent, loadFontAccent, applyFontAccent } from '../lib/fontAccent';
import { FontDropdown } from './FontDropdown';
import './ColorPicker.css';

const PRESET_COLORS = [
  { hex: '#E63946', label: 'Strong Red' },
  { hex: '#F77F00', label: 'Bright Orange' },
  { hex: '#FFC300', label: 'Signal Yellow' },
  { hex: '#0096C7', label: 'Ocean Blue' },
  { hex: '#7B2D8E', label: 'Royal Purple' },
  { hex: '#00B4D8', label: 'Bright Cyan' },
  { hex: '#FF6B35', label: 'Sunset Orange' },
  { hex: '#FF4757', label: 'Coral Red' },
  { hex: '#E84393', label: 'Hot Pink' },
  { hex: '#1DD1A1', label: 'Emerald' },
  { hex: '#00CEC9', label: 'Aqua' },
  { hex: '#CCFF00', label: 'Electric Lime' },
];

export default function ColorPicker({ isEditing }: { isEditing?: boolean }) {
  const [open, setOpen] = useState(false);
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false);
  const [fontDropdownRect, setFontDropdownRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef(false);
  const [customHex, setCustomHex] = useState(() => {
    try {
      const raw = localStorage.getItem('site-brand-color');
      if (raw) return JSON.parse(raw).brand || '#C47756';
    } catch(e) {}
    return '#C47756';
  });
  const [fontAccent, setFontAccent] = useState(
    (typeof window !== 'undefined' && localStorage.getItem('site-font-accent')) || 'Playfair Display'
  );
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadBrandColor();
    try {
      const raw = localStorage.getItem('site-brand-color');
      if (raw) {
        const { brand } = JSON.parse(raw);
        if (brand) setCustomHex(brand);
      }
    } catch(e) {}
    loadFontAccent();
  }, []);

  useEffect(() => {
    applyFontAccent(fontAccent);
  }, [fontAccent]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef.current) { triggerRef.current = false; return; }
      if (panelRef.current && panelRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const applyColor = (hex: string) => {
    saveBrandColor(hex);
    setCustomHex(hex);
  };

  const handleCustomChange = (val: string) => {
    setCustomHex(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      applyColor(val);
    }
  };

  if (!isEditing) return null;

  return (
    <div ref={panelRef} className="fixed z-[9998] color-picker-panel">
      {open && (
        <div className="color-picker-modal">
          {/* Header */}
          <div className="color-picker-header">
            <div className="color-picker-header-label">
              <Palette className="h-4 w-4 text-[var(--brand)]" />
              <span>Brand Color</span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              className="color-picker-close-btn"
            >
              <X className="h-4 w-4 text-gray-400" />
            </button>
          </div>

          {/* Preset swatches */}
          <div className="color-picker-presets">
            <p className="color-picker-presets-label">Presets</p>
            <div className="color-picker-swatches">
              {PRESET_COLORS.map(({ hex, label }) => {
                const active = customHex.toLowerCase() === hex.toLowerCase();
                return (
                  <button
                    key={hex}
                    title={label}
                    onClick={() => applyColor(hex)}
                    className={`color-picker-swatch${active ? ' active' : ''}`}
                    style={{ '--swatch-color': hex } as React.CSSProperties}
                  >
                    {active && (
                      <Check
                        className="h-3.5 w-3.5"
                        style={{ color: isLight(hex) ? '#111' : '#fff' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom hex input */}
          <div className="color-picker-custom">
            <p className="color-picker-custom-label">Custom</p>
            <div className="color-picker-custom-row">
              <div
                className="color-picker-swatch-preview"
                style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(customHex) ? customHex : '#C47756' }}
              />
              <input
                type="text"
                value={customHex}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder="#C47756"
                maxLength={7}
                className="color-picker-hex-input"
              />
            </div>
            {customHex.length > 0 && !/^#[0-9a-fA-F]{6}$/.test(customHex) && (
              <p className="color-picker-error">Enter a valid hex (#rrggbb)</p>
            )}
          </div>

          {/* Font accent picker */}
          <div className="color-picker-font-section">
            <p className="color-picker-font-label">Heading Font</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                setFontDropdownRect(rect);
                setFontDropdownOpen(o => !o);
              }}
              className="color-picker-font-trigger"
              style={{ fontFamily: `'${fontAccent}', serif` }}
            >
              <span>{fontAccent}</span>
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* FontDropdown portal */}
      {fontDropdownOpen && fontDropdownRect && ReactDOM.createPortal(
        <div
          className="font-dropdown-portal"
          style={{
            top: fontDropdownRect.bottom + 4,
            left: fontDropdownRect.left,
            right: window.innerWidth - fontDropdownRect.right,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {FONT_OPTIONS.map(font => (
            <button
              key={font}
              onMouseEnter={() => {
                document.documentElement.style.setProperty('--font-accent', `'${font}', serif`);
                document.querySelectorAll('h1').forEach(el => { (el as HTMLElement).style.fontFamily = `'${font}', serif`; });
                document.querySelectorAll('.edit-title-input, .edit-price-input').forEach(el => { (el as HTMLElement).style.fontFamily = `'${font}', serif`; });
              }}
              onClick={() => {
                console.log('[FontDropdown onClick] font=', font);
                setFontAccent(font);
                saveFontAccent(font);
                setFontDropdownOpen(false);
              }}
              className="font-dropdown-option"
              style={{ fontFamily: `'${font}', serif` }}
            >
              <span>{font}</span>
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Floating trigger button */}
      <button
        onMouseDown={(e) => { triggerRef.current = true; }}
        onClick={() => { setOpen(o => !o); setTimeout(() => { triggerRef.current = false; }, 0); }}
        className="color-picker-trigger"
        title="Change brand color"
      >
        {open ? (
          <X className="h-5 w-5 text-white" />
        ) : (
          <Palette className="h-5 w-5 text-white" />
        )}
      </button>
    </div>
  );
}

function isLight(hex: string): boolean {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = num >> 16;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}
