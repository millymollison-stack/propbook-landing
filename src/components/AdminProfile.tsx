import React, { useState } from 'react';
import { CreditCard as Edit2, Save, X, Upload, Trash2 } from 'lucide-react';
import { useAuth } from '../store/auth';
import type { Property, PropertyImage } from '../types';

interface AdminProfileProps {
  property: Property;
  images: PropertyImage[];
  onSave: (updates: Partial<Property>) => Promise<void>;
  onImageUpload: (file: File) => Promise<void>;
  onImageDelete: (imageId: string) => Promise<void>;
}

export function AdminProfile({ property, images, onSave, onImageUpload, onImageDelete }: AdminProfileProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState(property);
  const { user } = useAuth();

  if (!user || user.role !== 'admin') return null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleAmenitiesChange = (amenity: string) => {
    setFormData(prev => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter(a => a !== amenity)
        : [...prev.amenities, amenity]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSave(formData);
      setIsEditing(false);
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type and size
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!validTypes.includes(file.type)) {
      alert('Please upload a valid image file (JPEG, PNG, or WebP)');
      return;
    }

    if (file.size > maxSize) {
      alert('Image size should be less than 5MB');
      return;
    }

    setLoading(true);
    try {
      await onImageUpload(file);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-[1.65rem] text-gray-900">Property Management</h2>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="sidebar-btn-edit"
          >
            {isEditing ? (
              <>
                <X className="h-4 w-4" />
                <span>Cancel</span>
              </>
            ) : (
              <>
                <Edit2 className="h-4 w-4" />
                <span>Edit Profile</span>
              </>
            )}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Title</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                disabled={!isEditing}
                className="sb-input-light"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Description</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                disabled={!isEditing}
                rows={4}
                className="sb-input-light"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Price per night</label>
                <input
                  type="number"
                  name="price_per_night"
                  value={formData.price_per_night}
                  onChange={handleInputChange}
                  disabled={!isEditing}
                  className="sb-input-light"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Bedrooms</label>
                <input
                  type="number"
                  name="bedrooms"
                  value={formData.bedrooms}
                  onChange={handleInputChange}
                  disabled={!isEditing}
                  className="sb-input-light"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Bathrooms</label>
                <input
                  type="number"
                  name="bathrooms"
                  value={formData.bathrooms}
                  onChange={handleInputChange}
                  disabled={!isEditing}
                  className="sb-input-light"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">House Rules</label>
              <textarea
                name="house_rules"
                value={formData.house_rules || ''}
                onChange={handleInputChange}
                disabled={!isEditing}
                rows={4}
                className="sb-input-light"
              />
            </div>
          </div>

          {isEditing && (
            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[var(--brand)] text-white rounded-md hover:bg-[var(--brand-hover)] disabled:bg-[var(--brand-disabled)]"
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </form>

        <div className="mt-8">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Property Images</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {images.map((image) => (
              <div key={image.id} className="relative group">
                <img
                  src={image.url}
                  alt="Property"
                  className="w-full h-48 object-cover rounded-lg"
                />
                {isEditing && (
                  <button
                    onClick={() => onImageDelete(image.id)}
                    className="absolute top-2 right-2 p-2 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {isEditing && (
              <label className="relative block w-full h-48 border-2 border-dashed border-gray-300 rounded-lg hover:border-[var(--brand)] transition-colors cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600">
                  <Upload className="h-8 w-8 mb-2" />
                  <span className="text-sm">Upload Image</span>
                </div>
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}