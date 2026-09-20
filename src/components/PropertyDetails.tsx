import React, { useState, useEffect } from 'react';
import { MapPin } from 'lucide-react';
import type { Property } from '../types';
import { LocationMap } from './LocationMap';

interface PropertyDetailsProps {
  property: Property;
  isEditing: boolean;
  onEditingChange: (isEditing: boolean) => void;
  onSave?: (updates: Partial<Property>) => Promise<void>;
  onBeforeSave?: (() => Promise<void>) | null;
  onHasChanges?: (hasChanges: boolean) => void;
  trackDirty?: (updates: Partial<Property>) => void;
}

export function PropertyDetails({ property, isEditing, onSave, onHasChanges, trackDirty }: PropertyDetailsProps) {
  const [formData, setFormData] = useState(property);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [_openSection, _setOpenSection] = useState<string | null>(null);

  // Keep formData in sync when property prop updates (e.g., after save)
  useEffect(() => {
    setFormData(property);
  }, [property]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Report dirty field to parent for Save All
    trackDirty?.({ [name]: value });
    onHasChanges?.(true);
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: parseFloat(value)
    }));
    onHasChanges?.(true);
  };




  // Consistent edit input style - apply to all editable fields
  const editInputClass = "w-full px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]";

  const renderEditableText = (
    name: keyof Property,
    value: string | number,
    type: 'text' | 'textarea' | 'number' = 'text',
    className = '',
    _hideIcons = false
  ) => {
    if (!isEditing) {
      return <span className={className}>{value}</span>;
    }

    if (type === 'textarea') {
      console.log('[PropertyDetails renderEditableText] RENDERING TEXTAREA for', name, 'isEditing=', isEditing, 'value=', String(value).substring(0,30));
      return (
        <textarea
          name={name}
          value={value}
          onChange={(e) => { console.log('[PropertyDetails TEXTAREA onChange]', name); handleInputChange(e); }}
          className={`${editInputClass} edit-textarea`}
          rows={4}
        />
      );
    }

    return (
      <input
        type={type}
        name={name}
        value={value}
        onChange={type === 'number' ? handleNumberChange : handleInputChange}
        className={`${editInputClass} edit-input`}
      />
    );
  };

  return (
    <>
      {/* Copy block - outside background container */}
      <div className="flex justify-between items-start px-4">
        <div className="space-y-2 flex-1 w-full">
          <div className="mt-2 w-full">
            {isEditing ? (
              renderEditableText('property_intro', formData.property_intro || '', 'textarea')
            ) : (
              <p className="hero-subtitle">{property.property_intro || formData.property_intro}</p>
            )}
          </div>
        </div>
      </div>

      {/* Location Map trigger button */}
      <div className="location-button-container">
        <button
          onClick={() => setIsMapOpen(true)}
          className="view-location-btn"
        >
          <MapPin />
          View Location
        </button>
      </div>

      {!isEditing && (
        <div className="book-now-banner">
          <div className="book-now-rating">
            <span>★★★★★</span>
            <span>4.97</span>
            <span>(128 reviews)</span>
          </div>
          <button
            onClick={() => document.getElementById('calendar-section')?.scrollIntoView({ behavior: 'smooth' })}
            className="book-now-btn"
          >
            Book Now
          </button>
        </div>
      )}

      <LocationMap
        property={property}
        onSave={onSave!}
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
      />
    </>
  );
}