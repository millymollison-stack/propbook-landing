import React, { useState } from 'react';

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
}

export function SeoSection({ fields, onChange, images }: {
  fields: SeoFields;
  onChange: React.Dispatch<React.SetStateAction<SeoFields>>;
  images?: string[];
}) {
  const [saved, setSaved] = useState(false);
  const metaLength = fields.meta_description.length;
  const isOverLimit = metaLength > 160;

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
          className="sb-input-light"
          style={{ marginTop: 6 }}
        />
        <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 3 }}>Shown in browser tab and Google results</p>
      </div>

      {/* Meta Description */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Meta description</h4>
        <textarea
          value={fields.meta_description}
          onChange={e => onChange(f => ({ ...f, meta_description: e.target.value }))}
          placeholder="Write a compelling 150-160 character description for Google search results"
          className="sb-input-light"
          rows={3}
          maxLength={300}
          style={{ marginTop: 6, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
          <p style={{ fontSize: '0.72rem', color: isOverLimit ? '#ef4444' : '#9ca3af' }}>
            {isOverLimit ? `${metaLength - 160} over limit` : `${160 - metaLength} characters remaining`}
          </p>
          <p style={{ fontSize: '0.72rem', color: metaLength === 0 ? '#9ca3af' : isOverLimit ? '#ef4444' : '#16a34a' }}>
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
          className="booking-modal-select"
          style={{ marginTop: 6 }}
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
            style={{ marginTop: 8, width: '100%', maxHeight: 80, objectFit: 'cover', borderRadius: 6 }}
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 3 }}>Recommended: 1200×630px for Facebook/LinkedIn</p>
      </div>

      {/* Google Business Profile */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Google Business Profile URL</h4>
        <input
          type="url"
          value={fields.google_business_url}
          onChange={e => onChange(f => ({ ...f, google_business_url: e.target.value }))}
          placeholder="https://business.google.com/..."
          className="sb-input-light"
          style={{ marginTop: 6 }}
        />
        <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 3 }}>
          Link your Google Business Profile for better local search visibility
        </p>
      </div>

      {/* Google Site Verification */}
      <div className="sb-field-row">
        <h4 className="sb-h4-grey">Google site verification</h4>
        <input
          type="text"
          value={fields.google_verification}
          onChange={e => onChange(f => ({ ...f, google_verification: e.target.value }))}
          placeholder="e.g. A4O8H3XK2Z9R7P6"
          className="sb-input-light"
          style={{ marginTop: 6 }}
        />
        <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 3 }}>
          Add your site to Google Search Console → Settings → Verification → HTML tag → paste the content after <code style={{fontSize:'0.68rem',background:'#f3f4f6',padding:'1px 4px',borderRadius:3}}>content=</code>
        </p>
      </div>

      {/* Robots noindex */}
      <div className="sb-toggle-row" style={{ borderTop: '1px solid #f0f0f0', paddingTop: 10, marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.85rem', fontWeight: 500, color: '#111827', margin: 0 }}>Hide from search engines</p>
          <p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: '2px 0 0' }}>Adds noindex meta tag to published site</p>
        </div>
        <div
          onClick={() => onChange(f => ({ ...f, robots_noindex: !f.robots_noindex }))}
          style={{
            width: 40, height: 22, borderRadius: 11, background: fields.robots_noindex ? '#16a34a' : '#d1d5db',
            position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
          }}
        >
          <div style={{
            width: 18, height: 18, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 2, left: fields.robots_noindex ? 20 : 2,
            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </div>
      </div>

      {/* AI/SEO Discovery Files — section header */}
      <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 10, marginTop: 10 }}>
        <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>AI / LLM Discovery Files</p>
        <p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: '0 0 12px' }}>Generated at publish time. Help AI crawlers and search engines discover your listing.</p>

        {/* robots.txt toggle */}
        <div className="sb-toggle-row" style={{ marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 500, color: '#111827', margin: 0 }}>robots.txt</p>
            <p style={{ fontSize: '0.68rem', color: '#9ca3af', margin: '1px 0 0' }}>Allows AI bots to crawl your site</p>
          </div>
          <div
            onClick={() => onChange(f => ({ ...f, generate_robots_txt: !f.generate_robots_txt }))}
            style={{
              width: 40, height: 22, borderRadius: 11, background: fields.generate_robots_txt ? '#16a34a' : '#d1d5db',
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 2, left: fields.generate_robots_txt ? 20 : 2,
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>

        {/* sitemap.xml toggle */}
        <div className="sb-toggle-row" style={{ marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 500, color: '#111827', margin: 0 }}>sitemap.xml</p>
            <p style={{ fontSize: '0.68rem', color: '#9ca3af', margin: '1px 0 0' }}>Helps search engines index all pages</p>
          </div>
          <div
            onClick={() => onChange(f => ({ ...f, generate_sitemap_xml: !f.generate_sitemap_xml }))}
            style={{
              width: 40, height: 22, borderRadius: 11, background: fields.generate_sitemap_xml ? '#16a34a' : '#d1d5db',
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 2, left: fields.generate_sitemap_xml ? 20 : 2,
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>

        {/* llms.txt toggle */}
        <div className="sb-toggle-row" style={{ marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 500, color: '#111827', margin: 0 }}>llms.txt</p>
            <p style={{ fontSize: '0.68rem', color: '#9ca3af', margin: '1px 0 0' }}>Plain-text site description for LLMs</p>
          </div>
          <div
            onClick={() => onChange(f => ({ ...f, generate_llms_txt: !f.generate_llms_txt }))}
            style={{
              width: 40, height: 22, borderRadius: 11, background: fields.generate_llms_txt ? '#16a34a' : '#d1d5db',
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 2, left: fields.generate_llms_txt ? 20 : 2,
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>

        {/* faq-ai.txt toggle */}
        <div className="sb-toggle-row" style={{ marginBottom: 0 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 500, color: '#111827', margin: 0 }}>faq-ai.txt</p>
            <p style={{ fontSize: '0.68rem', color: '#9ca3af', margin: '1px 0 0' }}>5-8 FAQ Q&A pairs about the property</p>
          </div>
          <div
            onClick={() => onChange(f => ({ ...f, generate_faq_ai_txt: !f.generate_faq_ai_txt }))}
            style={{
              width: 40, height: 22, borderRadius: 11, background: fields.generate_faq_ai_txt ? '#16a34a' : '#d1d5db',
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 2, left: fields.generate_faq_ai_txt ? 20 : 2,
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}
