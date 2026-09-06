import React, { useState, useEffect, useRef } from 'react';
import './ImageGallery.css';
import { ChevronLeft, ChevronRight, CreditCard as Edit2, Upload, Trash2, Star, Image, X, Check, Bed, Bath, Users, Layers } from 'lucide-react';
import { applyFontAccent } from '../lib/fontAccent';
import type { PropertyImage, Property } from '../types';
import { useAuth } from '../store/auth';

interface ImageGalleryProps {
  images: PropertyImage[];
  property: Property;
  isEditing: boolean;
  isAdmin?: boolean;
  onImageUpload?: (file: File) => Promise<void>;
  onImageDelete?: (imageId: string) => Promise<void>;
  onImageUpdate?: (imageId: string, updates: Partial<PropertyImage>) => Promise<void>;
  onPropertyUpdate?: (updates: { property_title?: string; property_intro?: string }) => Promise<void>;
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
  // Priority: property_headline (full scraped headline, no 12-char limit)
  //          → property_title (scraped title)
  //          → property.name if it starts with '@' (user's chosen website handle)
  //          → default
  const resolveTitle = (p: typeof property) =>
    p?.property_headline || p?.property_title || (p?.name?.startsWith('@') ? p.name : '@surfhousebaja');

  const [propertyTitle, setPropertyTitle] = useState(() => resolveTitle(property));
  const [propertyIntro, setPropertyIntro] = useState(property?.property_intro || '');

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
    setPropertyIntro(property?.property_intro || '');
  }, [property?.id]);  // Only reinitialize when property ID changes, not when content changes

  // Sync title/intro from scraped property data arriving from Home (without DB write)
  // Also re-sync when property ID changes (after save completes)
  useEffect(() => {
    // (no-op — just syncing state from prop)
    if (property?.property_headline) setPropertyTitle(property.property_headline);
    else if (property?.property_title) setPropertyTitle(property.property_title);
    else if (property?.name?.startsWith('@')) setPropertyTitle(property.name);
    if (property?.property_intro) setPropertyIntro(property.property_intro);
    if (property?.price_per_night) setEditPrice(property.price_per_night);
  }, [property?.name, property?.property_title, property?.property_intro, property?.price_per_night, property?.id]);

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

  // Auto-advance images every 2 seconds (logged-in users only)
  useEffect(() => {
    if (sortedImages.length > 1 && !isEditing && user) {
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
    const currentTitle = property?.property_title ?? '';
    const currentIntro = property?.property_intro ?? '';
    if (titleToSave === currentTitle && introToSave === currentIntro) {
      saveInProgressRef.current = false;
      return;
    }
    setPropertyTitle(titleToSave);
    setPropertyIntro(introToSave);
    try {

      await onPropertyUpdate({
        property_title: titleToSave,
        property_intro: introToSave
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
        <p className="text-gray-500">No images available</p>
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
    <div className="relative bg-black">
      {/* Main large image */}
      <div className="relative h-[500px] md:h-[600px] overflow-hidden gallery-shadow gallery-bg-image">
        <div className="absolute inset-0">
          <img
            src={sortedImages[currentIndex]?.url || ''}
            alt={`Property view ${currentIndex + 1}`}
            className="h-full w-full object-cover"
            onError={(e) => { e.currentTarget.src = sortedImages[0]?.url || ''; }}
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
                  className="text-2xl md:text-3xl font-normal uppercase text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand)] px-2 py-1 edit-title-input"
                />
                <div className="flex items-baseline justify-end">
                  <span className="text-2xl md:text-3xl font-bold text-white">$</span>
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
                  <span className="text-white/80 text-base font-normal ml-1">USD /night</span>
                </div>
              </div>
            ) : (
              <div className="titleandpricebox">
                <h1 className="hero-title text-white">{propertyTitle}</h1>
                <div className="flex items-baseline">
                  <h1 className="hero-title-price text-white">
                    ${editPrice}
                  </h1>
                  <span className="text-white/80 text-base font-normal">USD /night</span>
                </div>
              </div>
            )}

            {/* Intro - always show */}
            {isEditing && isAdmin ? (
              <textarea
                value={propertyIntro}
                onChange={(e) => {
                  const words = e.target.value.trim().split(/\s+/);
                  const limited = words.length > 24 ? words.slice(0, 24).join(' ') : e.target.value;
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
                      className="w-8 sm:w-10 bg-transparent text-white focus:outline-none text-xs sm:text-sm edit-stat-input"
                      onFocus={(e) => {
                        e.target.style.border = '2px solid var(--brand)';
                      }}
                      min="0"
                    />
                    <span className="ml-1 text-xs sm:text-sm">Beds</span>
                  </span>
                  <span className="inline-flex items-center px-4 py-1.5 rounded-[0.5rem] bg-white/10 backdrop-blur-sm border border-white/15 text-white text-sm font-medium">
                    <Bath className="w-4 h-4 mr-2" />
                    <input
                      type="number"
                      value={editBathrooms}
                      onChange={(e) => setEditBathrooms(parseInt(e.target.value) || 0)}
                      onBlur={handlePropertyStatsSave}
                      className="w-8 sm:w-10 bg-transparent text-white focus:outline-none text-xs sm:text-sm edit-stat-input"
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
                      className="w-8 sm:w-10 bg-transparent text-white focus:outline-none text-xs sm:text-sm edit-stat-input"
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
  );
}