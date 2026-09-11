import React, { useState, useEffect } from 'react';
import { Wifi, Car, Coffee, Tv, Waves, Scale, Fish, Truck, ChevronDown, ChevronUp, MapPin, Utensils, Wind, Flame, Shirt, Timer, UtensilsCrossed, Flower2, Sun, Mountain, Sunset, Anchor, Footprints, Dumbbell, Bike, Gamepad2, BookOpen, Monitor, Printer, Shield, KeyRound, Siren, Heart, Zap, BedDouble, Sparkles, Scissors, DoorOpen, PawPrint, Accessibility, Palmtree } from 'lucide-react';
import type { Property } from '../types';
import { useAuth } from '../store/auth';
import { LocationMap } from './LocationMap';

// Full list of 50 vacation rental amenities
const ALL_AMENITIES = [
  { name: 'WiFi', icon: Wifi },
  { name: 'Free Parking', icon: Car },
  { name: 'Full Kitchen', icon: Utensils },
  { name: 'Air Conditioning', icon: Wind },
  { name: 'Heating', icon: Flame },
  { name: 'Washer', icon: Shirt },
  { name: 'Dryer', icon: Shirt },
  { name: 'Smart TV', icon: Tv },
  { name: 'Coffee Maker', icon: Coffee },
  { name: 'Microwave', icon: Timer },
  { name: 'Refrigerator', icon: UtensilsCrossed },
  { name: 'Dishwasher', icon: UtensilsCrossed },
  { name: 'Swimming Pool', icon: Waves },
  { name: 'Hot Tub', icon: Waves },
  { name: 'BBQ Grill', icon: Flame },
  { name: 'Outdoor Dining', icon: Utensils },
  { name: 'Garden', icon: Flower2 },
  { name: 'Patio', icon: Sun },
  { name: 'Beach Access', icon: Palmtree },
  { name: 'Ocean View', icon: Waves },
  { name: 'Mountain View', icon: Mountain },
  { name: 'Sunset View', icon: Sunset },
  { name: 'Surfboards', icon: Waves },
  { name: 'Kayaks', icon: Waves },
  { name: 'Paddleboards', icon: Waves },
  { name: 'Boat Dock', icon: Anchor },
  { name: 'Fishing Gear', icon: Fish },
  { name: 'Hiking Trails', icon: Footprints },
  { name: 'Yoga Mats', icon: Scale },
  { name: 'Fitness Center', icon: Dumbbell },
  { name: 'Bicycles', icon: Bike },
  { name: 'Game Room', icon: Gamepad2 },
  { name: 'Book Library', icon: BookOpen },
  { name: 'Workspace', icon: Monitor },
  { name: 'Printer', icon: Printer },
  { name: 'Safe', icon: Shield },
  { name: 'Keyless Entry', icon: KeyRound },
  { name: 'Smoke Detector', icon: Siren },
  { name: 'Carbon Monoxide Detector', icon: Siren },
  { name: 'First Aid Kit', icon: Heart },
  { name: '24Hr Security', icon: Shield },
  { name: 'Air Purifier', icon: Wind },
  { name: '4x4 Off Roading', icon: Truck },
  { name: 'Linens Provided', icon: BedDouble },
  { name: 'Toiletries', icon: Sparkles },
  { name: 'Hair Dryer', icon: Wind },
  { name: 'Fire Pit', icon: Flame },
  { name: 'Private Entrance', icon: DoorOpen },
  { name: 'Pet Friendly', icon: PawPrint },
  { name: 'Wheelchair Accessible', icon: Accessibility },
  { name: 'EV Charger', icon: Zap }
];

interface PropertyAmenitiesProps {
  property: Property;
  isEditing: boolean;
  onHasChanges?: (hasChanges: boolean) => void;
  onUpdate?: (updates: Partial<Property>) => Promise<void>;
  trackDirty?: (updates: Partial<Property>) => void;
}

interface CollapsibleSectionProps {
  title: string;
  content: string | null;
  isEditing: boolean;
  isAdmin: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onHasChanges?: (hasChanges: boolean) => void;
  onUpdate?: (updates: Partial<Property>) => Promise<void>;
  trackDirty?: (updates: Partial<Property>) => void;
  fieldName?: keyof Property;
}

function CollapsibleSection({ title, content, isEditing, isAdmin, isOpen, onToggle, onHasChanges, onUpdate, trackDirty, fieldName }: CollapsibleSectionProps) {
  const [editedContent, setEditedContent] = useState(content || '');

  // Keep editedContent in sync when content prop updates (after save completes)
  useEffect(() => {
    setEditedContent(content || '');
  }, [content]);

  const handleSave = async () => {
    if (trackDirty && fieldName) {
      trackDirty({ [fieldName]: editedContent });
      onHasChanges?.(false);
    } else if (onUpdate && fieldName) {
      await onUpdate({ [fieldName]: editedContent });
      onHasChanges?.(false);
    }
  };

  return (
    <div className="dropdown-section">
      <button
        onClick={onToggle}
        className="dropdown-header"
      >
        <h1 className="hero-title">{title}</h1>
        {isOpen ? <ChevronUp className="h-5 w-5 text-white" /> : <ChevronDown className="h-5 w-5 text-white" />}
      </button>
      
      {isOpen && (
        <div className="p-4">
          {isEditing ? (
            <div className="space-y-4">
              <textarea
                value={editedContent}
                onChange={(e) => {
                  setEditedContent(e.target.value);
                  if (trackDirty && fieldName) {
                    trackDirty({ [fieldName]: e.target.value });
                  }
                  onHasChanges?.(true);
                }}
                className="edit-section-textarea"
                rows={6}
                placeholder={`Enter ${title.toLowerCase()} information...`}
              />
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

export function PropertyAmenities({ property, isEditing, onHasChanges, onUpdate, trackDirty }: PropertyAmenitiesProps) {
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Default 8 favorite amenities
  const defaultAmenities = ['WiFi', 'Free Parking', 'Full Kitchen', 'Air Conditioning', 'Smart TV', 'Coffee Maker', 'Swimming Pool', 'Hot Tub'];
  
  // Use property amenities or defaults
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>(
    property.amenities?.length ? property.amenities : defaultAmenities
  );

  // In edit mode: show selector directly, no display below
  // In view mode: show only selected amenities
  const displayAmenities = ALL_AMENITIES.filter(a => selectedAmenities.includes(a.name));

  const toggleAmenity = (name: string) => {
    setSelectedAmenities(prev => {
      if (prev.includes(name)) {
        return prev.filter(a => a !== name);
      }
      // Allow up to 12
      if (prev.length >= 12) {
        return prev;
      }
      return [...prev, name];
    });
    onHasChanges?.(true);
  };

  // Save to database when called (from Save Now button)
  const handleSaveAmenities = async () => {
    if (onUpdate) {
      await onUpdate({ amenities: selectedAmenities });
      onHasChanges?.(false);
    }
  };

  return (
    <>
      {/* Content container - background handled by parent */}
      <div className="mt-5 relative amenities-content space-y-8 pb-8">
        {/* Amenities */}
        <div className="glass-card">
          <h1 className="hero-title">Amenities</h1>
          
          {/* Edit mode: always show selector */}
          {isEditing && (
            <div className="glass-card p-4">
              <div className="w-full amenity-scroll-container">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {ALL_AMENITIES.map(({ name, icon: Icon }) => {
                    const isSelected = selectedAmenities.includes(name);
                    const isMaxReached = selectedAmenities.length >= 12;
                    return (
                      <button
                        key={name}
                        onClick={() => toggleAmenity(name)}
                        disabled={isMaxReached && !isSelected}
                        className={`flex items-center space-x-2 px-3 py-2 rounded-[8px] text-left text-sm transition-all amenity-btn ${isSelected ? 'selected' : ''} ${isMaxReached && !isSelected ? 'max-reached' : ''}`}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="body-on-dark mt-3">{selectedAmenities.length}/12 amenities selected</p>
            </div>
          )}

          {/* View mode: show only selected amenities */}
          {!isEditing && (
            <div className="grid-2-cols">
              {displayAmenities.map(({ name, icon: Icon }) => (
                <div key={name} className="flex items-center space-x-2">
                  <Icon className="h-5 w-5 text-white" />
                  <span className="body-on-dark">{name}</span>
                </div>
              ))}
              {displayAmenities.length === 0 && (
                <p className="body-on-dark" style={{ fontStyle: "italic" }}>No amenities selected</p>
              )}
            </div>
          )}
        </div>

        {/* Dropdown sections */}
        <div className="space-y-4">
          <CollapsibleSection
            title="Property Details"
            content={property.property_details}
            isEditing={isEditing}
            isAdmin={isAdmin}
            isOpen={openSection === 'property_details'}
            onToggle={() => setOpenSection(openSection === 'property_details' ? null : 'property_details')}
            onHasChanges={onHasChanges}
            onUpdate={onUpdate}
            trackDirty={trackDirty}
            fieldName="property_details"
          />
          <CollapsibleSection
            title="Activities"
            content={property.activities}
            isEditing={isEditing}
            isAdmin={isAdmin}
            isOpen={openSection === 'activities'}
            onToggle={() => setOpenSection(openSection === 'activities' ? null : 'activities')}
            onHasChanges={onHasChanges}
            onUpdate={onUpdate}
            trackDirty={trackDirty}
            fieldName="activities"
          />
          <CollapsibleSection
            title="Local Area"
            content={property.local_area}
            isEditing={isEditing}
            isAdmin={isAdmin}
            isOpen={openSection === 'local_area'}
            onToggle={() => setOpenSection(openSection === 'local_area' ? null : 'local_area')}
            onHasChanges={onHasChanges}
            onUpdate={onUpdate}
            trackDirty={trackDirty}
            fieldName="local_area"
          />
          <CollapsibleSection
            title="Getting There"
            content={property.getting_there}
            isEditing={isEditing}
            isAdmin={isAdmin}
            isOpen={openSection === 'getting_there'}
            onToggle={() => setOpenSection(openSection === 'getting_there' ? null : 'getting_there')}
            onHasChanges={onHasChanges}
            onUpdate={onUpdate}
            trackDirty={trackDirty}
            fieldName="getting_there"
          />
        </div>
      </div>

      <LocationMap
        property={property}
        onSave={() => {}}
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
      />
    </>
  );
}
