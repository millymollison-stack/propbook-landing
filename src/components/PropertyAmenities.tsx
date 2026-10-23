import { useState, useEffect, useRef } from 'react';
import { Wifi, Car, Coffee, Tv, Waves, Scale, Fish, Truck, ChevronDown, ChevronUp, Utensils, Wind, Flame, Shirt, Timer, UtensilsCrossed, Flower2, Sun, Mountain, Sunset, Anchor, Footprints, Dumbbell, Bike, Gamepad2, BookOpen, Monitor, Printer, Shield, KeyRound, Siren, Heart, Zap, BedDouble, Sparkles, DoorOpen, PawPrint, Accessibility, Palmtree } from 'lucide-react';
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

function CollapsibleSection({ title, content, isEditing, isOpen, onToggle, onHasChanges, trackDirty, fieldName }: CollapsibleSectionProps) {
  const [editedContent, setEditedContent] = useState(content || '');
  const sectionRef = useRef<HTMLDivElement>(null);

  // Keep editedContent in sync when content prop updates (after save completes)
  useEffect(() => {
    setEditedContent(content || '');
  }, [content]);


  return (
    <div className="dropdown-section" ref={sectionRef}>
      <button
        onClick={(e) => {
          // David: opening a dropdown "jumps to the middle" of the section
          // instead of keeping its top in view -- that's the browser's own
          // "scroll the focused element into view" behavior kicking in once
          // the accordion content below the button changes the page height,
          // and it has no idea where we'd actually want to land. Blurring
          // the button first stops it from taking over, then we drive the
          // scroll ourselves once the new content has rendered, pinning the
          // section's own top edge instead of guessing at a middle.
          //
          // David 2026-10-21 follow-up: "click near, not necessarily on a
          // dropdown menu [and] the scroll effect is temporarily locked from
          // moving until you touch the screen in a different quadrant" -- a
          // `behavior: 'smooth'` scrollIntoView runs as its own animation
          // over several frames, and on mobile a touch-scroll gesture
          // started in that same region while the animation is still
          // running fights the browser's own programmatic scroll instead of
          // taking over, which reads as "locked" until you touch somewhere
          // the animation isn't actively fighting you. Two changes: skip the
          // correction entirely when the section's top is already close
          // enough to the viewport top (most taps don't need correcting at
          // all), and use an instant jump instead of an animated one when a
          // correction genuinely is needed, so there's no multi-frame window
          // left for a touch-scroll to collide with.
          e.currentTarget.blur();
          onToggle();
          requestAnimationFrame(() => {
            const rect = sectionRef.current?.getBoundingClientRect();
            if (rect && Math.abs(rect.top) > 24) {
              sectionRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
            }
          });
        }}
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
    Array.isArray(property.amenities) && property.amenities.length ? property.amenities : defaultAmenities
  );

  // David 2026-10-17: surfhousebaja was showing the generic 8-item default
  // list instead of the real 10 amenities saved in the DB. Root cause: the
  // useState above only runs its initializer on this component's FIRST
  // mount -- it never re-runs when the `property` prop changes later. On a
  // public page load, CustomerSite first renders from the baked, possibly
  // stale window.__PROPERTY_DATA__ snapshot (amenities often [] at publish
  // time), then corrects `property` a moment later from a live DB fetch.
  // That correction lands in the prop just fine, but selectedAmenities had
  // already locked onto `defaultAmenities` at mount and never picked it up.
  // This effect re-syncs selectedAmenities whenever the incoming amenities
  // actually change, skipped while actively editing so it can't clobber an
  // in-progress selection (same isEditing guard already used elsewhere for
  // this exact class of bug -- see stability-plan-2026-09-22.md).
  const amenitiesKey = JSON.stringify(property.amenities ?? []);
  useEffect(() => {
    if (isEditing) return;
    const incoming = Array.isArray(property.amenities) && property.amenities.length ? property.amenities : defaultAmenities;
    setSelectedAmenities(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amenitiesKey, isEditing]);

  // In edit mode: show selector directly, no display below
  // In view mode: show only selected amenities
  const displayAmenities = ALL_AMENITIES.filter(a => selectedAmenities.includes(a.name));

  const toggleAmenity = (name: string) => {
    const isSelected = selectedAmenities.includes(name);
    // Allow up to 12
    if (!isSelected && selectedAmenities.length >= 12) return;
    const next = isSelected ? selectedAmenities.filter(a => a !== name) : [...selectedAmenities, name];
    setSelectedAmenities(next);
    onHasChanges?.(true);
    // Save immediately -- same already-working onUpdate() save path used by
    // the Property Details/Activities/Local Area/Getting There sections and
    // LocationMap below. Previously this only updated local state, so
    // amenity selections never reached the database (David reported
    // selections not sticking after Save/republish -- the DB's `amenities`
    // column was stuck at [] since September).
    onUpdate?.({ amenities: next })?.catch(err => console.error('Failed to save amenities:', err));
  };

  // Save to database when called (from Save Now button)

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
                // David: "align the icons with the amenities title, remove
                // any padding around the icons except 4px on the right" --
                // space-x-2 was adding an 8px gap via margin on every side
                // of the row's flow; replaced with a single 4px right
                // margin directly on the icon (mr-1) so the icon's own left
                // edge lines up flush with "Amenities" above it, with only
                // the 4px separating it from its label.
                <div key={name} className="flex items-start">
                  <Icon className="h-5 w-5 text-white flex-shrink-0 mt-0.5 mr-1" />
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
        onSave={async (updates) => { if (onUpdate) await onUpdate(updates); }}
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
      />
    </>
  );
}
