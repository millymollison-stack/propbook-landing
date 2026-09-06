// Admin Panel Component
// src/pages/PropertyAdmin.tsx

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';
import type { Property, PropertyImage, Booking } from '../types';
import { Layers, Star, X } from 'lucide-react';

export function PropertyAdmin() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [images, setImages] = useState<PropertyImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'properties' | 'bookings' | 'images' | 'settings'>('properties');

  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user]);

  async function loadData() {
    if (!user?.id) return;
    
    // Load properties for this owner
    const { data: props } = await supabase
      .from('properties')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });
    
    if (props && props.length > 0) {
      setProperties(props);
      setSelectedProperty(props[0]);
      await loadPropertyData(props[0].id);
    }
    setLoading(false);
  }

  async function loadPropertyData(propertyId: string) {
    const [bookingsRes, imagesRes] = await Promise.all([
      supabase.from('bookings').select('*').eq('property_id', propertyId).order('created_at', { ascending: false }),
      supabase.from('property_images').select('*').eq('property_id', propertyId).order('position')
    ]);
    
    setBookings(bookingsRes.data || []);
    setImages(imagesRes.data || []);
  }

  async function createProperty() {
    if (!user?.id) return;
    
    const newProperty = {
      title: 'New Property',
      description: 'Add your description',
      price_per_night: 100,
      bedrooms: 1,
      bathrooms: 1,
      max_guests: 2,
      amenities: [],
      owner_id: user.id
    };
    
    const { data, error } = await supabase
      .from('properties')
      .insert(newProperty)
      .select()
      .single();
    
    if (data) {
      setProperties([data, ...properties]);
      setSelectedProperty(data);
    }
  }

  async function updateProperty(updates: Partial<Property>) {
    if (!selectedProperty) return;
    
    const { data, error } = await supabase
      .from('properties')
      .update(updates)
      .eq('id', selectedProperty.id)
      .select()
      .single();
    
    if (data) {
      setProperties(properties.map(p => p.id === data.id ? data : p));
      setSelectedProperty(data);
    }
  }

  async function uploadImage(file: File) {
    if (!selectedProperty) return;
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${selectedProperty.id}/${Date.now()}.${fileExt}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('property-images')
      .upload(fileName, file);
    
    if (uploadData) {
      const { data: { publicUrl } } = supabase.storage
        .from('property-images')
        .getPublicUrl(fileName);
      
      await supabase.from('property_images').insert({
        property_id: selectedProperty.id,
        url: publicUrl,
        position: images.length,
        is_featured: images.length === 0,
        is_main: images.length === 0,
        is_background: false
      });
      
      await loadPropertyData(selectedProperty.id);
    }
  }

  async function updateImage(imageId: string, updates: Partial<PropertyImage>) {
    if (!selectedProperty) return;
    
    const { error } = await supabase
      .from('property_images')
      .update(updates)
      .eq('id', imageId);
    
    if (!error) {
      await loadPropertyData(selectedProperty.id);
    }
  }

  if (loading) return <div className="p-8"><div className="spinner-ring" /></div>;

  if (!user) {
    return <div className="p-8 text-center">Please log in to access property management.</div>;
  }

  if (properties.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <h2 className="text-2xl font-bold mb-4">Welcome to Property Admin!</h2>
            <p className="text-gray-600 mb-6">You don't have any properties yet. Let's add your first one!</p>
            <button
              onClick={createProperty}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 text-lg"
            >
              + Add Your First Property
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Property Admin</h1>
          <button
            onClick={createProperty}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            + Add Property
          </button>
        </div>
      </header>

      {/* Property Selector */}
      {properties.length > 1 && (
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 py-3 flex gap-4 overflow-x-auto">
            {properties.map(prop => (
              <button
                key={prop.id}
                onClick={() => { setSelectedProperty(prop); loadPropertyData(prop.id); }}
                className={`px-4 py-2 rounded-lg whitespace-nowrap ${
                  selectedProperty?.id === prop.id
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                {prop.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-4 border-b mb-6">
          {(['properties', 'bookings', 'images', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-2 capitalize ${
                activeTab === tab
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'properties' && selectedProperty && (
          <PropertyForm
            property={selectedProperty}
            onSave={updateProperty}
          />
        )}

        {activeTab === 'bookings' && (
          <BookingsList bookings={bookings} />
        )}

        {activeTab === 'images' && selectedProperty && (
          <ImageManager
            images={images}
            onUpload={uploadImage}
            onUpdate={updateImage}
            propertyId={selectedProperty.id}
          />
        )}

        {activeTab === 'settings' && selectedProperty && (
          <PropertySettings
            property={selectedProperty}
            onSave={updateProperty}
          />
        )}
      </div>
    </div>
  );
}

// Property Form Component
function PropertyForm({ property, onSave }: { property: Property; onSave: (updates: Partial<Property>) => Promise<void> }) {
  const [formData, setFormData] = useState(property);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave(formData);
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Property Title</label>
          <input
            type="text"
            value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Price per Night ($)</label>
          <input
            type="number"
            value={formData.price_per_night}
            onChange={e => setFormData({ ...formData, price_per_night: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bedrooms</label>
          <input
            type="number"
            value={formData.bedrooms}
            onChange={e => setFormData({ ...formData, bedrooms: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bathrooms</label>
          <input
            type="number"
            value={formData.bathrooms}
            onChange={e => setFormData({ ...formData, bathrooms: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Max Guests</label>
          <input
            type="number"
            value={formData.max_guests}
            onChange={e => setFormData({ ...formData, max_guests: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          value={formData.description}
          onChange={e => setFormData({ ...formData, description: e.target.value })}
          rows={4}
          className="w-full px-3 py-2 border rounded-lg"
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
}

// Bookings List Component
function BookingsList({ bookings }: { bookings: Booking[] }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Guest</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dates</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {bookings.map(booking => (
            <tr key={booking.id}>
              <td className="px-6 py-4">{booking.guest_name}</td>
              <td className="px-6 py-4">
                {new Date(booking.start_date).toLocaleDateString()} - {new Date(booking.end_date).toLocaleDateString()}
              </td>
              <td className="px-6 py-4">
                <span className={`px-2 py-1 rounded text-xs ${
                  booking.status === 'approved' ? 'bg-green-100 text-green-800' :
                  booking.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-red-100 text-red-800'
                }`}>
                  {booking.status}
                </span>
              </td>
              <td className="px-6 py-4">${booking.total_price}</td>
            </tr>
          ))}
          {bookings.length === 0 && (
            <tr>
              <td colSpan={4} className="px-6 py-8 text-center text-gray-500">No bookings yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Image Manager Component
function ImageManager({ images, onUpload, onUpdate, propertyId }: { 
  images: PropertyImage[]; 
  onUpload: (file: File) => Promise<void>;
  onUpdate?: (imageId: string, updates: Partial<PropertyImage>) => Promise<void>;
  propertyId: string;
}) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUpload(e.target.files[0]);
    }
  };

  const toggleBackground = async (image: PropertyImage) => {
    if (!onUpdate) return;
    await onUpdate(image.id, { is_background: !image.is_background });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium mb-4">Upload Images</h3>
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {images.map(image => (
          <div key={image.id} className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden group">
            <img src={image.url} alt="" className="w-full h-full object-cover" />
            {image.is_main && (
              <span className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded">Main</span>
            )}
            {/* Background toggle button */}
            <button
              onClick={() => toggleBackground(image)}
              className={`absolute top-2 right-2 p-1.5 rounded-full transition-all ${
                image.is_background 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-black/50 text-white opacity-0 group-hover:opacity-100'
              }`}
              title={image.is_background ? 'Remove from background' : 'Use as background'}
            >
              <Layers className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Settings Component  
function PropertySettings({ property, onSave }: { property: Property; onSave: (updates: Partial<Property>) => Promise<void> }) {
  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-6">
      <h3 className="text-lg font-medium">Property Settings</h3>
      <p className="text-gray-500">Additional settings coming soon...</p>
    </div>
  );
}
