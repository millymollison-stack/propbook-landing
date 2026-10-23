import React, { useState } from 'react';
import { Instagram, Facebook, Youtube, Twitter, Check, X } from 'lucide-react';

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  twitter?: string;
  youtube?: string;
}

export interface SeoFields {
  meta_description: string;
  og_image_url: string;
  google_business_url: string;
  robots_noindex: boolean;
  custom_page_title: string;
  google_verification: string;
  // AI/SEO discovery file toggles
  generate_robots_txt: boolean;
  generate_sitemap_xml: boolean;
  generate_llms_txt: boolean;
  generate_faq_ai_txt: boolean;
  // David 2026-10-23: "Put an input in for social media accounts... use
  // icons not text and individual inputs... keep it small."
  social_links: SocialLinks;
}

const SOCIAL_PLATFORMS: { key: keyof SocialLinks; label: string; icon: typeof Instagram; placeholder: string }[] = [
  { key: 'instagram', label: 'Instagram', icon: Instagram, placeholder: 'instagram.com/...' },
  { key: 'facebook', label: 'Facebook', icon: Facebook, placeholder: 'facebook.com/...' },
  { key: 'twitter', label: 'X / Twitter', icon: Twitter, placeholder: 'x.com/...' },
  { key: 'youtube', label: 'YouTube', icon: Youtube, placeholder: 'youtube.com/...' },
];

export function SeoSection({ fields, onChange, images, isEditing }: {
  fields: SeoFields;
  onChange: React.Dispatch<React.SetStateAction<SeoFields>>;
  images?: string[];
  // David 2026-10-23: "The SEO section looks like it is in edit mode...
  // build a none edit mode section where the data is not editable" -- every
  // other sidebar section (Property, Website, Contact) already branches on
  // the sidebar's shared isEditing flag; this one just never had. View mode
  // below reuses the same .sb-field-value styling those sections use, so
  // nothing here introduces a new text size/style of its own.
  isEditing?: boolean;
}) {
  const [_saved, _setSaved] = useState(false);
  const metaLength = fields.meta_description.length;
  const isOverLimit = metaLength > 160;

  // David 2026-10-23: redesigned from 4 separate boxes to one input + a
  // platform dropdown + a lightweight "verify" step -- "nothing that gets
  // complicated with social sign ins, I just want to capture their account
  // info so I can tag it." "Verify" here is just a format sanity check
  // (non-empty, not just whitespace), not any kind of OAuth/sign-in --
  // picking a platform that's already linked overwrites its saved value.
  const [newPlatform, setNewPlatform] = useState<keyof SocialLinks>('instagram');
  const [newValue, setNewValue] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const handleAddSocial = () => {
    const trimmed = newValue.trim();
    if (trimmed.length < 2) {
      setAddError("That doesn't look like a valid handle or link.");
      return;
    }
    setAddError(null);
    onChange(f => ({ ...f, social_links: { ...f.social_links, [newPlatform]: trimmed } }));
    setNewValue('');
  };

  if (!isEditing) {
    return (
      <div>
        <div className="sb-field-row">
          <h4 className="sb-h4-grey">Page title</h4>
          <p className="sb-field-value">{fields.custom_page_title || '—'}</p>
        </div>

        <div className="sb-field-row">
          <h4 className="sb-h4-grey">Meta description</h4>
          <p className="sb-field-value" style={{ whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fields.meta_description || '—'}</p>
        </div>

        <div className="sb-field-row">
          <h4 className="sb-h4-grey">Social share image</h4>
          {fields.og_image_url ? (
            <img
              src={fields.og_image_url}
              alt="Social share preview"
              className="seo-og-preview"
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <p className="sb-field-value">Auto (first property image)</p>
          )}
        </div>

        <div className="sb-field-row">
          <h4 className="sb-h4-grey">Google Business Profile URL</h4>
          <p className="sb-field-value" style={{ wordBreak: 'break-all' }}>{fields.google_business_url || '—'}</p>
        </div>

        <div className="sb-field-row">
          <h4 className="sb-h4-grey">Google site verification</h4>
          <p className="sb-field-value">{fields.google_verification || '—'}</p>
        </div>

        <div className="sb-field-row">
          <h4 className="sb-h4-grey">Hide from search engines</h4>
          <p className="sb-field-value">{fields.robots_noindex ? 'Yes' : 'No'}</p>
        </div>

        <div className="sb-field-row">
          <h4 className="sb-h4-grey">AI / LLM discovery files</h4>
          <p className="sb-field-value">
            robots.txt: {fields.generate_robots_txt ? 'On' : 'Off'} · sitemap.xml: {fields.generate_sitemap_xml ? 'On' : 'Off'} · llms.txt: {fields.generate_llms_txt ? 'On' : 'Off'} · faq-ai.txt: {fields.generate_faq_ai_txt ? 'On' : 'Off'}
          </p>
        </div>

        <div className="sb-field-row" style={{ borderBottom: 'none' }}>
          <h4 className="sb-h4-grey">Social accounts</h4>
          <div className="seo-social-row">
            {SOCIAL_PLATFORMS.map(({ key, label, icon: Icon }) => {
              const value = fields.social_links?.[key];
              return value ? (
                <a key={key} href={value} target="_blank" rel="noopener noreferrer" className="seo-social-icon-link seo-social-icon-link--linked" title={`${label}: linked`}>
                  <Icon className="h-4 w-4" />
                  <span className="seo-social-linked-dot" />
                </a>
              ) : (
                <span key={key} className="seo-social-icon-link seo-social-icon-link--empty" title={`${label}: not set`}>
                  <Icon className="h-4 w-4" />
                </span>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Custom Page Title */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Page title</h4>
        <input
          type="text"
          value={fields.custom_page_title}
          onChange={e => onChange(f => ({ ...f, custom_page_title: e.target.value }))}
          placeholder="Custom SEO title (defaults to property name)"
          className="sb-input-light seo-input-spaced"
        />
      </div>

      {/* Meta Description */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Meta description</h4>
        <textarea
          value={fields.meta_description}
          onChange={e => onChange(f => ({ ...f, meta_description: e.target.value }))}
          placeholder="Write a compelling 150-160 character description for Google search results"
          className="sb-input-light seo-textarea"
          rows={3}
          maxLength={300}
        />
        <div className="seo-meta-counter-row">
          <p className={`seo-meta-counter-text${isOverLimit ? ' over-limit' : ''}`}>
            {isOverLimit ? `${metaLength - 160} over limit` : `${160 - metaLength} characters remaining`}
          </p>
          <p className={`seo-meta-counter-count${metaLength === 0 ? ' zero' : isOverLimit ? ' over-limit' : ' ok'}`}>
            {metaLength}/160
          </p>
        </div>
      </div>

      {/* OG Image */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Social share image</h4>
        <select
          value={fields.og_image_url}
          onChange={e => onChange(f => ({ ...f, og_image_url: e.target.value }))}
          className="sb-input-light seo-input-spaced"
        >
          <option value="">Auto (first property image)</option>
          {images && images.map((img, i) => (
            <option key={i} value={img}>
              {`Image ${i + 1}`}
            </option>
          ))}
        </select>
        {fields.og_image_url && (
          <img
            src={fields.og_image_url}
            alt="OG preview"
            className="seo-og-preview"
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </div>

      {/* Google Business Profile */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Google Business Profile URL</h4>
        <input
          type="url"
          value={fields.google_business_url}
          onChange={e => onChange(f => ({ ...f, google_business_url: e.target.value }))}
          placeholder="https://business.google.com/..."
          className="sb-input-light seo-input-spaced"
        />
      </div>

      {/* Google Site Verification */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Google site verification</h4>
        <input
          type="text"
          value={fields.google_verification}
          onChange={e => onChange(f => ({ ...f, google_verification: e.target.value }))}
          placeholder="e.g. A4O8H3XK2Z9R7P6"
          className="sb-input-light seo-input-spaced"
        />
      </div>

      {/* Robots noindex */}
      <div className="sb-toggle-row seo-section-divider">
        <div className="seo-toggle-flex1">
          <p className="seo-toggle-label">Hide from search engines</p>
        </div>
        <div
          onClick={() => onChange(f => ({ ...f, robots_noindex: !f.robots_noindex }))}
          className={`seo-toggle-track${fields.robots_noindex ? ' on' : ''}`}
        >
          <div className={`seo-toggle-thumb${fields.robots_noindex ? ' on' : ''}`} />
        </div>
      </div>

      {/* AI/SEO Discovery Files — section header */}
      <div className="seo-section-divider">
        <p className="seo-section-title">AI / LLM Discovery Files</p>

        {/* robots.txt toggle */}
        <div className="sb-toggle-row seo-toggle-row-mb">
          <div className="seo-toggle-flex1">
            <p className="seo-toggle-label-sm">robots.txt</p>
          </div>
          <div
            onClick={() => onChange(f => ({ ...f, generate_robots_txt: !f.generate_robots_txt }))}
            className={`seo-toggle-track${fields.generate_robots_txt ? ' on' : ''}`}
          >
            <div className={`seo-toggle-thumb${fields.generate_robots_txt ? ' on' : ''}`} />
          </div>
        </div>

        {/* sitemap.xml toggle */}
        <div className="sb-toggle-row seo-toggle-row-mb">
          <div className="seo-toggle-flex1">
            <p className="seo-toggle-label-sm">sitemap.xml</p>
          </div>
          <div
            onClick={() => onChange(f => ({ ...f, generate_sitemap_xml: !f.generate_sitemap_xml }))}
            className={`seo-toggle-track${fields.generate_sitemap_xml ? ' on' : ''}`}
          >
            <div className={`seo-toggle-thumb${fields.generate_sitemap_xml ? ' on' : ''}`} />
          </div>
        </div>

        {/* llms.txt toggle */}
        <div className="sb-toggle-row seo-toggle-row-mb">
          <div className="seo-toggle-flex1">
            <p className="seo-toggle-label-sm">llms.txt</p>
          </div>
          <div
            onClick={() => onChange(f => ({ ...f, generate_llms_txt: !f.generate_llms_txt }))}
            className={`seo-toggle-track${fields.generate_llms_txt ? ' on' : ''}`}
          >
            <div className={`seo-toggle-thumb${fields.generate_llms_txt ? ' on' : ''}`} />
          </div>
        </div>

        {/* faq-ai.txt toggle */}
        <div className="sb-toggle-row">
          <div className="seo-toggle-flex1">
            <p className="seo-toggle-label-sm">faq-ai.txt</p>
          </div>
          <div
            onClick={() => onChange(f => ({ ...f, generate_faq_ai_txt: !f.generate_faq_ai_txt }))}
            className={`seo-toggle-track${fields.generate_faq_ai_txt ? ' on' : ''}`}
          >
            <div className={`seo-toggle-thumb${fields.generate_faq_ai_txt ? ' on' : ''}`} />
          </div>
        </div>
      </div>

      {/* Social accounts -- one input + a platform dropdown + a "Verify &
          Link" step, instead of four always-visible boxes (David: "keep it
          small"; the verify step is just a format check, not a sign-in --
          "nothing that gets complicated with social sign ins"). Linked
          accounts list below with a green check so it's obvious it took,
          and can be removed with the X. */}
      <div className="seo-section-divider">
        <p className="seo-section-title">Social Accounts</p>

        {SOCIAL_PLATFORMS.some(({ key }) => fields.social_links?.[key]) && (
          <div className="seo-social-linked-list">
            {SOCIAL_PLATFORMS.map(({ key, icon: Icon, label }) => {
              const value = fields.social_links?.[key];
              if (!value) return null;
              return (
                <div key={key} className="seo-social-linked-row">
                  <Icon className="h-4 w-4 seo-social-linked-icon" />
                  <span className="seo-social-linked-label">{label}</span>
                  <span className="seo-social-linked-value">{value}</span>
                  <span className="seo-social-linked-badge"><Check className="h-3 w-3" />Linked</span>
                  <button
                    type="button"
                    onClick={() => onChange(f => ({ ...f, social_links: { ...f.social_links, [key]: '' } }))}
                    className="seo-social-linked-remove"
                    aria-label={`Remove ${label}`}
                    title={`Remove ${label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="seo-social-add-row">
          <select
            value={newPlatform}
            onChange={e => { setNewPlatform(e.target.value as keyof SocialLinks); setAddError(null); }}
            className="seo-social-add-select"
            aria-label="Social network"
          >
            {SOCIAL_PLATFORMS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          <input
            type="text"
            value={newValue}
            onChange={e => { setNewValue(e.target.value); setAddError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSocial(); } }}
            placeholder={SOCIAL_PLATFORMS.find(p => p.key === newPlatform)?.placeholder || 'Profile URL or @handle'}
            aria-label="Profile URL or handle"
            className="seo-social-add-input"
          />
          <button type="button" onClick={handleAddSocial} disabled={!newValue.trim()} className="seo-social-add-btn">
            Verify &amp; Link
          </button>
        </div>
        {addError && <p className="seo-social-add-error">{addError}</p>}
      </div>
    </div>
  );
}
