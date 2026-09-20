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
  const [_saved, _setSaved] = useState(false);
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
    </div>
  );
}
