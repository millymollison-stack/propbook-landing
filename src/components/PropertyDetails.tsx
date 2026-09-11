import React, { useState, useEffect, useCallback } from 'react';
import { Bed, Bath, Users, Wifi, Car, Coffee, Tv, Check, X, MapPin, ChevronDown, ChevronUp, CreditCard as Edit2, Waves, Scale, Fish, Truck } from 'lucide-react';
import type { Property } from '../types';
import { useAuth } from '../store/auth';
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

interface CollapsibleSectionProps {
  title: string;
  content: string | null;
  isEditing: boolean;
  onEdit?: (content: string) => void;
  isAdmin: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

function CollapsibleSection({ title, content, isEditing, onEdit, isAdmin, isOpen, onToggle }: CollapsibleSectionProps) {
  const [editedContent, setEditedContent] = useState(content || '');
  const [isEditingSection, setIsEditingSection] = useState(false);

  const handleSave = () => {
    onEdit?.(editedContent);
    setIsEditingSection(false);
  };

  return (
    <div className="property-drop-down">
      <button
        onClick={onToggle}
        className="property-drop-down-btn"
      >
        <h1 className="hero-title">{title}</h1>
        {isOpen ? <ChevronUp className="h-5 w-5 text-white" /> : <ChevronDown className="h-5 w-5 text-white" />}
      </button>
      
      {isOpen && (
        <div className="property-drop-down-content">
          {isAdmin && !isEditingSection ? (
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setIsEditingSection(true)}
                className="flex items-center space-x-2 text-sm text-[var(--brand)] hover:text-[var(--brand-hover)]"
              >
                <Edit2 className="h-4 w-4" />
                <span>Edit Section</span>
              </button>
            </div>
          ) : null}

          {isEditingSection ? (
            <div className="space-y-4">
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="edit-section-textarea"
                rows={6}
                placeholder={`Enter ${title.toLowerCase()} information...`}
              />
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setIsEditingSection(false)}
                  className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
                >
                  Done
                </button>
                <button
                  onClick={handleSave}
                  className="px-3 py-1 text-sm bg-[var(--brand)] text-white rounded hover:bg-[var(--brand-hover)]"
                >
                  Save Changes
                </button>
              </div>
            </div>
          ) : (
            <div className="prose max-w-none w-full">
              {content ? (
                <p className="whitespace-pre-line hero-subtitle">{content}</p>
              ) : (
                <p className="body-on-dark" style={{ fontStyle: "italic" }}>No information available</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PropertyDetails({ property, isEditing, onEditingChange, onSave, onBeforeSave, onHasChanges, trackDirty }: PropertyDetailsProps) {
  const [formData, setFormData] = useState(property);
  const [loading, setLoading] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

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

  const handleAmenityToggle = (amenity: string) => {
    setFormData(prev => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter(a => a !== amenity)
        : [...prev.amenities, amenity]
    }));
  };

  const handleSave = async () => {
    console.log('[PropertyDetails handleSave] formData keys:', Object.keys(formData));
    if (!onSave) { console.log('[PropertyDetails handleSave] NO onSave — returning'); return; }
    setLoading(true);
    try {
      // Save ImageGallery text first if handler is registered
      if (onBeforeSave) {
        await onBeforeSave();
      }
      // Then save the property details
      await onSave(formData);
      onHasChanges?.(false);
      onEditingChange(false);
    } catch (err) {
      console.error('[PropertyDetails handleSave] FAILED:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSectionEdit = (section: keyof Property) => async (content: string) => {
    if (!onSave) return;
    try {
      await onSave({ [section]: content });
      setFormData(prev => ({ ...prev, [section]: content }));
    } catch (error) {
      console.error(`Failed to update ${section}:`, error);
    }
  };

  // Consistent edit input style - apply to all editable fields
  const editInputClass = "w-full px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]";

  const renderEditableText = (
    name: keyof Property,
    value: string | number,
    type: 'text' | 'textarea' | 'number' = 'text',
    className = '',
    hideIcons = false
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