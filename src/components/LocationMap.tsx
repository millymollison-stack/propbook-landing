import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import { CreditCard as Edit2, X, MapPin, Check, Search } from 'lucide-react';
import { useAuth } from '../store/auth';
import type { Property } from '../types';
import 'leaflet/dist/leaflet.css';
import './LocationMap.css';
import './sidebar.css';
import './OnboardingPopup.css';
import L from 'leaflet';

// Fix for default marker icon in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface LocationMapProps {
  property: Property;
  onSave: (updates: Partial<Property>) => Promise<void>;
  onClose: () => void;
  isOpen: boolean;
}

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    // Start at zoom 5 (~800mi radius around property), then fly in to street level (zoom 16)
    map.setView(center, 5, { animate: false });
    const timer = setTimeout(() => {
      map.flyTo(center, 16, { duration: 4.0 });
    }, 1000);
    return () => clearTimeout(timer);
  }, [center, map]);
  return null;
}

export function LocationMap({ property, onSave, onClose, isOpen }: LocationMapProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [address, setAddress] = useState(property.address || '');
  const [coordinates, setCoordinates] = useState<[number, number]>([
    property.latitude || 23.1631,
    property.longitude || -109.6834
  ]);
  const [locationType, setLocationType] = useState<'address' | 'coordinates'>(
    property.location_type || 'address'
  );
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  if (!isOpen) return null;

  const handleAddressSearch = async () => {
    if (!address) return;

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`
      );
      const data = await response.json();

      if (data && data[0]) {
        const { lat, lon } = data[0];
        setCoordinates([parseFloat(lat), parseFloat(lon)]);
      } else {
        setError('Address not found. Please try a different address or use coordinates.');
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      setError('Failed to find address. Please try again or use coordinates.');
    }
  };

  const handleMapClick = (e: L.LeafletMouseEvent) => {
    if (isEditing) {
      setCoordinates([e.latlng.lat, e.latlng.lng]);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      await onSave({
        address: locationType === 'address' ? address : null,
        latitude: coordinates[0],
        longitude: coordinates[1],
        location_type: locationType
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save location:', error);
      setError('Failed to save location. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-2 pt-2 pb-2 text-center sm:px-4 sm:pt-4 sm:pb-20 sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true">
          <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={onClose}></div>
        </div>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl w-full location-map-modal">
          <div className="bg-white px-3 pt-4 pb-3 sm:px-6 sm:pt-5 sm:pb-4">
            <div className="flex justify-between items-center mb-4">
              <h1>Location</h1>
              <div className="location-edit-container">
                {isAdmin && (
                  <>
                    {isEditing ? (
                      <button
                        onClick={() => setIsEditing(false)}
                        className="edit-location-btn"
                      >
                        <Check className="h-4 w-4" />
                        <span className="hidden sm:inline">Done</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="edit-location-btn"
                      >
                        <Edit2 className="h-4 w-4" />
                        <span className="hidden sm:inline">Edit</span>
                      </button>
                    )}
                    {isEditing && (
                      <button
                        onClick={() => setIsEditing(false)}
                        className="sidebar-btn-cancel inline-flex-row"
                      >
                        <X className="h-4 w-4" />
                        <span className="btn-text hidden sm:inline">Cancel</span>
                      </button>
                    )}
                  </>
                )}
                <button onClick={onClose} className="sidebar-btn-close">
                  <X className="h-6 w-6" />
                </button>
              </div>
            </div>

            {isEditing && (
              <div className="location-edit-form">
                <div>
                  <label className="location-edit-label">
                    Location Type
                  </label>
                  <div className="mt-2 space-x-4">
                    <label className="inline-flex items-center">
                      <input
                        type="radio"
                        value="address"
                        checked={locationType === 'address'}
                        onChange={(e) => setLocationType(e.target.value as 'address' | 'coordinates')}
                        className="form-radio h-4 w-4 text-[var(--brand)]"
                      />
                      <span className="location-edit-text">Street Address</span>
                    </label>
                    <label className="inline-flex items-center">
                      <input
                        type="radio"
                        value="coordinates"
                        checked={locationType === 'coordinates'}
                        onChange={(e) => setLocationType(e.target.value as 'address' | 'coordinates')}
                        className="form-radio h-4 w-4 text-[var(--brand)]"
                      />
                      <span className="location-edit-text">Coordinates</span>
                    </label>
                  </div>
                </div>

                {locationType === 'address' ? (
                  <div>
                    <label className="location-edit-label">
                      Street Address
                    </label>
                    <div className="mt-1 flex items-center gap-2" style={{ width: '100%' }}>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddressSearch()}
                        className="sb-input-light"
                        style={{ flex: 1 }}
                        placeholder="Enter street address"
                      />
                      <button
                        onClick={handleAddressSearch}
                        className="btn"
                        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: '0.8rem' }}
                        aria-label="Search address"
                      >
                        <Search className="h-4 w-4" />Search
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="location-edit-label">
                        Latitude
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={coordinates[0]}
                        onChange={(e) => setCoordinates([parseFloat(e.target.value), coordinates[1]])}
                        className="sb-input-light"
                      />
                    </div>
                    <div>
                      <label className="location-edit-label">
                        Longitude
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={coordinates[1]}
                        onChange={(e) => setCoordinates([coordinates[0], parseFloat(e.target.value)])}
                        className="sb-input-light"
                      />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded-md bg-red-50 p-4">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="location-edit-cancel-btn"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={loading}
                    className="btn"
                  >
                    {loading ? 'Saving...' : 'Save Location'}
                  </button>
                </div>
              </div>
            )}

            <div className="h-[300px] sm:h-[400px] w-full rounded-lg overflow-hidden shadow-md">
              <MapContainer
                center={coordinates}
                zoom={5}
                className="map-full-size"
                onClick={handleMapClick}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={coordinates} />
                <MapUpdater center={coordinates} />
              </MapContainer>
            </div>

            {!isEditing && (property.address || property.local_area) && (
              <p className="location-address-text">{property.address || property.local_area || ''}</p>
            )}
            {!isEditing && (() => {
              const lat = coordinates[0];
              const lng = coordinates[1];
              const addr = property.address || property.local_area || '';
              const mapsUrl = lat && lng
                ? `https://www.google.com/maps?q=${lat},${lng}`
                : addr
                  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`
                  : null;
              return mapsUrl ? (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="edit-location-btn"
                  style={{ marginTop: '0.75rem', display: 'inline-flex' }}
                >
                  <MapPin className="h-4 w-4" />
                  Open in Google Maps
                </a>
              ) : null;
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}