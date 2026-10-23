import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Upload, Trash2, Star, Image, Bed, Bath, Users, Layers, X } from 'lucide-react';
import { applyFontAccent } from '../lib/fontAccent';
import type { PropertyImage, Property } from '../types';
import { useAuth } from '../store/auth';

// David 2026-10-21: "The intro copy should be limited to only be 12 words so it
// works on Mobile... making sure it works as that info is brought into many
// versions of the inputs as it moves through migration mode." The live-edit
// textarea below already capped new edits at 12 words, but propertyIntro was
// also seeded straight from property.description in three places with no cap
// at all -- so a property migrated or imported from before this change (or
// written by a path that bypasses the textarea) could still render a much
// longer teaser on the actual live site. Capping right where it's read from
// the property record, not just where it's edited, means it's correct no
// matter which version of the data got it there.
function capIntroWords(text: string | null | undefined): string {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= 12) return text;
  // David 2026-10-22: add an ellipsis when the cut lands mid-sentence instead
  // of leaving it hanging with no indication more text existed.
  const truncated = words.slice(0, 12).join(' ');
  return /[.!?]$/.test(truncated) ? truncated : `${truncated}…`;
}

interface ImageGalleryProps {
  images: PropertyImage[];
  property: Property;
  isEditing: boolean;
  isAdmin?: boolean;
  onImageUpload?: (file: File) => Promise<void>;
  onImageDelete?: (imageId: string) => Promise<void>;
  onImageUpdate?: (imageId: string, updates: Partial<PropertyImage>) => Promise<void>;
  onPropertyUpdate?: (updates: Partial<Property>) => Promise<void>;
  registerSaveHandler?: (handler: () => Promise<void>) => boolean;
}

export function ImageGallery({
  images,
  property,
  isEditing,
  isAdmin: externalIsAdmin,
  onImageUpload,
  onImageDelete,
  onImageUpdate,
  onPropertyUpdate,
  registerSaveHandler
}: ImageGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  // Resolve the display title for the H1:
  // Priority: property_headline (the ONE canonical headline field, set at
  //           onboarding and editable from both this hero box and the
  //           sidebar's "Property headline" field)
  //          → property.name if it starts with '@' (user's chosen website handle)
  //          → default
  // David 2026-09-22: property_title used to be a second fallback here, but
  // it was also where handlePropertyTextSave below (wrongly) saved edits to
  // -- so a headline typed in this box would save to property_title while
  // this line kept reading property_headline first, making edits look like
  // they silently failed. Dropped property_title from this read entirely;
  // a one-time DB backfill (property_headline = property_title where null)
  // covers any older property that never had property_headline set.
  const resolveTitle = (p: typeof property) =>
    p?.property_headline || (p?.name?.startsWith('@') ? p.name : '@surfhousebaja');

  const [propertyTitle, setPropertyTitle] = useState(() => resolveTitle(property));
  const [propertyIntro, setPropertyIntro] = useState(capIntroWords(property?.description));

  const [editPrice, setEditPrice] = useState(property?.price_per_night || 0);
  const [editBedrooms, setEditBedrooms] = useState(property?.bedrooms || 0);
  const [editBathrooms, setEditBathrooms] = useState(property?.bathrooms || 0);
  const [editMaxGuests, setEditMaxGuests] = useState(property?.max_guests || 0);
  const { user } = useAuth();
  // Use external isAdmin if provided, otherwise check local auth
  const isAdmin = externalIsAdmin ?? user?.role === 'admin';
  // Debounce flag — prevent accidental double-saves within 2 seconds
  const saveInProgressRef = useRef(false);

  // Initialize state from property - only on mount or when property ID changes
  useEffect(() => {
    setPropertyTitle(resolveTitle(property));
    setPropertyIntro(capIntroWords(property?.description));
  }, [property?.id]);  // Only reinitialize when property ID changes, not when content changes

  // Sync title/intro from scraped property data arriving from Home (without DB write)
  // Also re-sync when property ID changes (after save completes)
  useEffect(() => {
    // (no-op — just syncing state from prop)
    if (property?.property_headline) setPropertyTitle(property.property_headline);
    else if (property?.name?.startsWith('@')) setPropertyTitle(property.name);
    if (property?.description) setPropertyIntro(capIntroWords(property.description));
    if (property?.price_per_night) setEditPrice(property.price_per_night);
  }, [property?.name, property?.property_headline, property?.description, property?.price_per_night, property?.id]);

  useEffect(() => {
    if (registerSaveHandler) {
      registerSaveHandler(handlePropertyTextSave);
    }
  }, [registerSaveHandler]);

  const sortedImages = [...images].sort((a, b) => {
    if (a.is_main) return -1;
    if (b.is_main) return 1;
    if (a.is_featured && !b.is_featured) return -1;
    if (!a.is_featured && b.is_featured) return 1;
    return a.position - b.position;
  });

  // Apply current font accent to title/price inputs on mount
  useEffect(() => {
    const savedFont = localStorage.getItem('site-font-accent');
    if (savedFont) applyFontAccent(savedFont);
  }, [isEditing]);

  // Auto-advance images every 2 seconds for signed-out visitors only.
  // David: this had gotten inverted (autoplaying for logged-in users
  // instead of guests) — restored to the original intent, Round 5.
  useEffect(() => {
    if (sortedImages.length > 1 && !isEditing && !user) {
      const interval = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % sortedImages.length);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [sortedImages.length, isEditing, user]);

  const handlePropertyTextSave = async () => {
    if (!onPropertyUpdate) return;
    // Debounce: prevent accidental double-saves
    if (saveInProgressRef.current) {
      // debounce guard
      return;
    }
    saveInProgressRef.current = true;
    const titleToSave = propertyTitle;
    const introToSave = propertyIntro;

    // Guard: only write to DB if value actually changed
    // David 2026-09-22: was comparing against property_title while writing
    // to property_title too -- but resolveTitle() above reads
    // property_headline first, so the value on screen (and the value the
    // user just edited) is actually property_headline. Comparing/writing
    // against property_title meant edits here never touched the field the
    // page actually displays. property_headline is now the single field
    // both this hero box and the sidebar's "Property headline" input read
    // and write.
    const currentTitle = property?.property_headline ?? '';
    const currentIntro = property?.description ?? '';
    if (titleToSave === currentTitle && introToSave === currentIntro) {
      saveInProgressRef.current = false;
      return;
    }
    setPropertyTitle(titleToSave);
    setPropertyIntro(introToSave);
    try {

      await onPropertyUpdate({
        property_headline: titleToSave,
        description: introToSave
      });

    } catch (error) {
      console.error('Failed to update property text:', error);
    } finally {
      setTimeout(() => { saveInProgressRef.current = false; }, 2000);
    }
  };

  const handlePropertyStatsSave = async () => {
    if (!onPropertyUpdate) return;
    try {
      await onPropertyUpdate({
        price_per_night: editPrice,
        bedrooms: editBedrooms,
        bathrooms: editBathrooms,
        max_guests: editMaxGuests
      });
    } catch (error) {
      console.error('Failed to update property stats:', error);
    }
  };

  const nextImage = () => {
    setCurrentIndex((prev) => (prev + 1) % sortedImages.length);
  };

  const previousImage = () => {
    setCurrentIndex((prev) => (prev - 1 + sortedImages.length) % sortedImages.length);
  };

  // David: "Create a large white modal containing a swipeable photo
  // gallery when you click the image in phone viewport." -- gated to
  // phone-width taps only (matches Tailwind's md breakpoint); desktop
  // clicking the hero image is unchanged.
  const [showGalleryModal, setShowGalleryModal] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const touchStartXRef = useRef<number | null>(null);

  const openGalleryModal = (index: number) => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) return;
    setGalleryIndex(index);
    setShowGalleryModal(true);
  };

  const galleryNext = () => {
    setGalleryIndex((prev) => (prev + 1) % sortedImages.length);
  };

  const galleryPrevious = () => {
    setGalleryIndex((prev) => (prev - 1 + sortedImages.length) % sortedImages.length);
  };

  const handleGalleryTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleGalleryTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
    const SWIPE_THRESHOLD = 40;
    if (deltaX > SWIPE_THRESHOLD) galleryPrevious();
    else if (deltaX < -SWIPE_THRESHOLD) galleryNext();
    touchStartXRef.current = null;
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onImageUpload) return;
    
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    const invalidFiles = files.filter(
      file => !validTypes.includes(file.type) || file.size > maxSize
    );

    if (invalidFiles.length > 0) {
      alert('Some files were not valid. Please ensure all files are images (JPEG, PNG, or WebP) and less than 5MB.');
      return;
    }

    setLoading(true);
    try {
      for (const file of files) {
        await onImageUpload(file);
      }
    } catch (error) {
      console.error('Failed to upload images:', error);
      alert('Failed to upload some images. Please try again.');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleImageDelete = async (imageId: string) => {
    if (!onImageDelete) return;

    if (!confirm('Are you sure you want to delete this image?')) return;

    setLoading(true);
    try {
      await onImageDelete(imageId);
      if (currentIndex >= sortedImages.length - 1) {
        setCurrentIndex(Math.max(0, sortedImages.length - 2));
      }
    } catch (error) {
      console.error('Failed to delete image:', error);
      alert('Failed to delete image. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleFeatured = async (image: PropertyImage) => {
    if (!onImageUpdate) return;

    try {
      await onImageUpdate(image.id, { is_featured: !image.is_featured });
    } catch (error) {
      console.error('Failed to update image:', error);
      alert('Failed to update image. Please try again.');
    }
  };

  const toggleBackground = async (image: PropertyImage) => {
    if (!onImageUpdate) return;

    try {
      await onImageUpdate(image.id, { is_background: !image.is_background });
    } catch (error) {
      console.error('Failed to update image:', error);
      alert('Failed to update image. Please try again.');
    }
  };

  const setMainPhoto = async (image: PropertyImage) => {
    if (!onImageUpdate) return;

    try {
      if (image.is_main) {
        // If clicking on current main photo, unset it
        await onImageUpdate(image.id, { is_main: false });
      } else {
        // First, remove main photo status from all images
        for (const img of images) {
          if (img.is_main) {
            await onImageUpdate(img.id, { is_main: false });
          }
        }
        // Then set the new main photo
        await onImageUpdate(image.id, { is_main: true });
        setCurrentIndex(0); // Show the main photo
      }
    } catch (error) {
      console.error('Failed to set main photo:', error);
      alert('Failed to set main photo. Please try again.');
    }
  };

  if (sortedImages.length === 0) {
    return (
      <div className="h-[600px] bg-gray-100 flex items-center justify-center rounded-lg">
        <p className="body-on-light">No images available</p>
      </div>
    );
  }

  if (sortedImages.length === 0) {
    return (
      <div className="relative h-[500px] md:h-[600px] overflow-hidden gallery-shadow">
        <div className="absolute inset-0 gallery-gradient-overlay"></div>
        <div className="absolute inset-0 bg-cover bg-center bg-image-gallery"></div>
        
        <div className="absolute bottom-0 left-0 right-0 z-20 gallery-content-overlay bg-dark-overlay">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 md:px-12">
            <h1 className="hero-title">{propertyTitle}</h1>
            <p className="hero-subtitle">{propertyIntro}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="relative bg-black">
      {/* Main large image */}
      <div className="relative h-[500px] md:h-[600px] overflow-hidden gallery-shadow gallery-bg-image">
        <div className="absolute inset-0">
          <img
            src={sortedImages[currentIndex]?.url || ''}
            alt={`Property view ${currentIndex + 1}`}
            className="h-full w-full object-cover cursor-pointer md:cursor-default"
            onError={(e) => { e.currentTarget.src = sortedImages[0]?.url || ''; }}
            onClick={() => openGalleryModal(currentIndex)}
          />
        </div>
        {/* Gradient overlay on top of image */}
        <div className="absolute inset-0 pointer-events-none gallery-gradient-overlay-light"></div>
        
        {/* Title and subtitle overlay with blurred glass */}
        <div className="absolute bottom-0 left-0 right-0 z-20 gallery-content-overlay bg-dark-overlay">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 md:px-12">
            {/* Title - always show */}
            {isEditing && isAdmin ? (
              <div className="titleandpricebox">
                <input
                  type="text"
                  value={propertyTitle}
                  onChange={(e) => setPropertyTitle(e.target.value)}
                  onBlur={handlePropertyTextSave}
                  className="text-2xl md:text-3xl font-normal text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand)] px-2 py-1 edit-title-input"
                />
                {/* David 2026-09-22: dropped the USD/night label in edit mode --
                    fighting .titleandpricebox's baseline alignment to keep it
                    tucked under a text <input> (rather than under the .hero-title-price
                    h1 it was designed for) kept coming back as floating/detached
                    text in his screenshots. Read-only mode below is untouched. */}
                <div className="flex items-baseline edit-price-row">
                  <span className="hero-price-currency">$</span>
                  <input
                    type="number"
                    value={editPrice}
                    onChange={(e) => setEditPrice(parseFloat(e.target.value) || 0)}
                    onBlur={handlePropertyStatsSave}
                    className="w-24 text-2xl md:text-3xl font-bold text-white focus:outline-none edit-price-input"
                    onFocus={(e) => {
                      e.target.style.border = '1px solid var(--brand)';
                    }}
                    min="0"
                  />
                </div>
              </div>
            ) : (
              <div className="titleandpricebox">
                <h1 className="hero-title">{propertyTitle}</h1>
                <div className="flex flex-col items-start">
                  <div className="flex items-baseline">
                    <span className="hero-price-currency">$</span>
                    <h1 className="hero-title-price">{editPrice}</h1>
                  </div>
                  <span className="hero-price-suffix">USD/night</span>
                </div>
              </div>
            )}

            {/* Intro - always show */}
            {isEditing && isAdmin ? (
              <textarea
                value={propertyIntro}
                onChange={(e) => {
                  // David 2026-10-21: "The intro copy should be limited to only be 12
                  // words so it works on Mobile." Was 24 -- matches the same cap in
                  // App.tsx's onImported handler and GetSite.tsx's extractFirst12Words.
                  const words = e.target.value.trim().split(/\s+/);
                  let limited = e.target.value;
                  if (words.length > 12) {
                    const truncated = words.slice(0, 12).join(' ');
                    limited = /[.!?]$/.test(truncated) ? truncated : `${truncated}…`;
                  }
                  setPropertyIntro(limited);
                }}
                onBlur={handlePropertyTextSave}
                className="w-full text-white resize-none font-normal p-2 mt-2 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] edit-intro-textarea"
                rows={2}
                placeholder="Enter property introduction..." 
              />
            ) : (
              <p className="whitespace-pre-line hero-subtitle">{propertyIntro}</p>
            )}
              
            {/* Property stats - always show */}
            <div className="flex flex-wrap gap-2 sm:gap-3 mt-3">
              {isEditing && isAdmin ? (
                <>
                  <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-[0.5rem] bg-white/10 backdrop-blur-sm border border-white/15 text-white text-xs sm:text-sm font-medium">
                    <Bed className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                    <input
                      type="number"
                      value={editBedrooms}
                      onChange={(e) => setEditBedrooms(parseInt(e.target.value) || 0)}
                      onBlur={handlePropertyStatsSave}
                      className="bg-transparent text-white focus:outline-none text-xs sm:text-sm edit-stat-input text-center"
                      onFocus={(e) => {
                        e.target.style.border = '2px solid var(--brand)';
                      }}
                      min="0"
                    />
                    <span className="ml-1 text-xs sm:text-sm">Beds</span>
                  </span>
                  <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-[0.5rem] bg-white/10 backdrop-blur-sm border border-white/15 text-white text-xs sm:text-sm font-medium">
                    <Bath className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                    <input
                      type="number"
                      value={editBathrooms}
                      onChange={(e) => setEditBathrooms(parseInt(e.target.value) || 0)}
                      onBlur={handlePropertyStatsSave}
                      className="bg-transparent text-white focus:outline-none text-xs sm:text-sm edit-stat-input text-center"
                      onFocus={(e) => {
                        e.target.style.border = '2px solid var(--brand)';
                      }}
                      min="0"
                    />
                    <span className="ml-1 text-xs sm:text-sm">Bath</span>
                  </span>
                  <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-[0.5rem] bg-white/10 backdrop-blur-sm border border-white/15 text-white text-xs sm:text-sm font-medium">
                    <Users className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                    <input
                      type="number"
                      value={editMaxGuests}
                      onChange={(e) => setEditMaxGuests(parseInt(e.target.value) || 0)}
                      onBlur={handlePropertyStatsSave}
                      className="bg-transparent text-white focus:outline-none text-xs sm:text-sm edit-stat-input text-center"
                      onFocus={(e) => {
                        e.target.style.border = '2px solid var(--brand)';
                      }}
                      min="0"
                    />
                    <span className="ml-1 text-xs sm:text-sm">Persons</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="lozenge">
                    <Bed className="w-4 h-4 mr-2" />
                    {property.bedrooms} Beds
                  </span>
                  <span className="lozenge">
                    <Bath className="w-4 h-4 mr-2" />
                    {property.bathrooms} Bath
                  </span>
                  <span className="lozenge">
                    <Users className="w-4 h-4 mr-2" />
                    {property.max_guests} Persons
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Navigation arrows */}
        {sortedImages.length > 1 && !isEditing && (
          <div className="absolute inset-0 flex items-center justify-between p-4 pointer-events-none z-10">
            <button
              onClick={previousImage}
              className="px-3 py-2 bg-white/20 backdrop-blur-sm border border-white/15 rounded text-white/90 hover:bg-white/30 hover:text-white transition-all pointer-events-auto"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              onClick={nextImage}
              className="px-3 py-2 bg-white/20 backdrop-blur-sm border border-white/15 rounded text-white/90 hover:bg-white/30 hover:text-white transition-all pointer-events-auto"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>
        )}

      </div>

      {/* Thumbnail grid */}
      {sortedImages.length > 1 && (
        <div className="grid grid-cols-2 gap-0">
          {sortedImages.slice(1, 3).map((image, index) => (
            <div key={image.id} className="relative group">
              <button
                onClick={() => setCurrentIndex(index + 1)}
                className="relative h-48 md:h-[292px] w-full overflow-hidden focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
              >
                <img
                  src={image.url}
                  alt={`Property view ${index + 2}`}
                  className="h-full w-full object-cover"
                />
              </button>
              {isAdmin && isEditing && (
                <div className="absolute top-2 right-2 flex space-x-2">
                  <button
                    onClick={() => toggleFeatured(image)}
                    className={`p-2 rounded-full ${
                      image.is_featured
                        ? 'bg-yellow-400 text-white'
                        : 'bg-white/80 text-gray-800'
                    } hover:bg-yellow-500 hover:text-white transition-colors`}
                  >
                    <Star className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleImageDelete(image.id)}
                    className="p-2 rounded-full bg-red-600/80 text-white hover:bg-red-600 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Image management grid for admins */}
      {isAdmin && isEditing && (
        <div className="mt-8">
          <div className="flex justify-center gallery-upload-wrap">
            <label 
              className="inline-flex items-center bg-[var(--brand)] text-white rounded-lg hover:bg-[var(--brand-hover)] cursor-pointer shadow-lg gallery-upload-btn"
            >
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="hidden"
                disabled={loading}
              />
              <Upload className="h-5 w-5 mr-2" />
              Upload New Photo
            </label>
          </div>
          <h3 className="manage-images-heading">Manage Images</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {sortedImages.map((image) => (
              <div key={image.id} className="relative group">
                <img
                  src={image.url}
                  alt="Property"
                  className="w-full h-32 object-cover"
                />
                <div className="image-overlay-btns">
                  <button
                    onClick={() => setMainPhoto(image)}
                    className={`p-2 rounded-full ${
                      image.is_main
                        ? 'bg-blue-500 text-white'
                        : 'bg-white/80 text-gray-800'
                    } hover:bg-blue-500 hover:text-white transition-colors`}
                    title={image.is_main ? 'Remove as main photo' : 'Set as main photo'}
                  >
                    <Image className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => toggleFeatured(image)}
                    className={`p-2 rounded-full ${
                      image.is_featured
                        ? 'bg-yellow-500 text-white'
                        : 'bg-white/80 text-gray-800'
                    } hover:bg-yellow-500 hover:text-white transition-colors`}
                    title={image.is_featured ? 'Remove from featured' : 'Add to featured'}
                  >
                    <Star className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => toggleBackground(image)}
                    className={`p-2 rounded-full ${
                      image.is_background
                        ? 'bg-purple-500 text-white'
                        : 'bg-white/80 text-gray-800'
                    } hover:bg-purple-500 hover:text-white transition-colors`}
                    title={image.is_background ? 'Remove from background' : 'Use as background'}
                  >
                    <Layers className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleImageDelete(image.id)}
                    className="p-2 rounded-full bg-red-600/80 text-white hover:bg-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="absolute top-2 right-2 flex flex-col items-end space-y-1">
                  {image.is_main && (
                    <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                      Main Photo
                    </span>
                  )}
                  {image.is_featured && (
                    <span className="bg-yellow-400 text-white text-xs px-2 py-1 rounded-full">
                      Featured
                    </span>
                  )}
                  {image.is_background && (
                    <span className="bg-purple-600 text-white text-xs px-2 py-1 rounded-full">
                      Background
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>

    {/* Full-screen swipeable gallery -- phone viewport only (see
        openGalleryModal above). White modal per David's spec, not the
        usual dark popup treatment used elsewhere in the app. David:
        "make the arrows match the image slider's style, white modal
        with 6px corner radius and a title, 5px margin from the edge of
        the viewport, keep the photo counter." Inset 5px on every side
        (instead of a flush inset-0) so the rounded corners actually
        show against the page behind it. */}
    {showGalleryModal && (
      <div className="fixed inset-[5px] z-[100] bg-white rounded-[6px] shadow-xl flex flex-col overflow-hidden">
        {/* David: "the style to say Photos and be a tile at the top of the
            modal" -- a plain flush header read as part of the body, so it
            gets its own filled bar (rounded to match the modal's own 6px
            corners) to read as a distinct header tile. */}
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 rounded-t-[6px]">
          <span className="hero-title-edit booking-modal-title truncate flex-1 min-w-0">Photos</span>
          <span className="text-sm font-medium text-gray-500 flex-shrink-0">
            {galleryIndex + 1} / {sortedImages.length}
          </span>
          <button
            type="button"
            onClick={() => setShowGalleryModal(false)}
            aria-label="Close gallery"
            className="p-2 -mr-2 text-gray-700 flex-shrink-0"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <div
          className="relative flex-1 overflow-hidden bg-black"
          onTouchStart={handleGalleryTouchStart}
          onTouchEnd={handleGalleryTouchEnd}
        >
          <img
            src={sortedImages[galleryIndex]?.url || ''}
            alt={`Property view ${galleryIndex + 1}`}
            className="h-full w-full object-cover select-none"
            draggable={false}
          />
          <button
            type="button"
            onClick={galleryPrevious}
            aria-label="Previous photo"
            className="absolute left-4 top-1/2 -translate-y-1/2 px-3 py-2 bg-white/20 backdrop-blur-sm border border-white/15 rounded text-white/90 hover:bg-white/30 hover:text-white transition-all"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={galleryNext}
            aria-label="Next photo"
            className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-2 bg-white/20 backdrop-blur-sm border border-white/15 rounded text-white/90 hover:bg-white/30 hover:text-white transition-all"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>
      </div>
    )}
    </>
  );
}