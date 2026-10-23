import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, CircleMarker, useMap } from 'react-leaflet';
import { CreditCard as Edit2, X, MapPin, Check, Search } from 'lucide-react';
import { useAuth } from '../store/auth';
import { supabase } from '../lib/supabase';
import type { Property } from '../types';
import 'leaflet/dist/leaflet.css';
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

function MapUpdater({ center, targetZoom }: { center: [number, number]; targetZoom: number }) {
  const map = useMap();
  useEffect(() => {
    // Start at zoom 5 (~800mi radius around property), then fly in. David
    // 2026-10-23: targetZoom is only street-level (16) once the viewer can
    // actually see the exact location (owner, or a guest with an approved
    // booking) -- otherwise it stops at a general-area zoom (13) so an
    // unbooked visitor gets the neighborhood, not the house.
    map.setView(center, 5, { animate: false });
    const timer = setTimeout(() => {
      map.flyTo(center, targetZoom, { duration: 4.0 });
    }, 1000);
    return () => clearTimeout(timer);
  }, [center, map, targetZoom]);
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

  // David 2026-10-23: "give a general area not the house number to users
  // that have not booked... when they have made a booking they can see the
  // actual full address." Self-contained check (same table/columns
  // GuestSidebar's own booking list already reads) so PropertyDetails /
  // PropertyAmenities don't need to thread booking state down just for this.
  const [hasApprovedBooking, setHasApprovedBooking] = useState(false);
  useEffect(() => {
    if (!isOpen || !user?.id) { setHasApprovedBooking(false); return; }
    let cancelled = false;
    supabase
      .from('bookings')
      .select('id')
      .eq('property_id', property.id)
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .limit(1)
      .then(({ data }) => { if (!cancelled) setHasApprovedBooking(!!data && data.length > 0); });
    return () => { cancelled = true; };
  }, [isOpen, user?.id, property.id]);

  const canSeeExactLocation = isAdmin || hasApprovedBooking;

  // Auto-search and save when map opens and has a location but no coordinates yet
  useEffect(() => {
    if (!isOpen) return;
    // David: "coordinates win over an address" -- the map's marker/center
    // already reads from `coordinates` state (seeded from property.latitude/
    // longitude below), so saved coordinates already take priority for
    // display. The one gap: `&&`/truthy checks here treat a real 0 lat or
    // lng (falsy) as "no coordinates" and would incorrectly kick off an
    // address geocode that could overwrite them -- using explicit
    // null/undefined checks so coordinates always win whenever both are
    // actually present, regardless of value.
    const hasLocation = !!(property.address || (property as any).location);
    const hasCoords = property.latitude != null && property.longitude != null;
    if (hasLocation && !hasCoords) {
      const loc = property.address || (property as any).location || '';
      setAddress(loc);
      // Geocode immediately
      fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(loc)}&limit=1`, {
        headers: { 'User-Agent': 'propbook-dev/1.0' }
      })
        .then(r => r.json())
        .then(async data => {
          if (data && data[0]) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            setCoordinates([lat, lon]);
            // Auto-save the resolved coordinates
            try {
              await onSave({ address: loc, latitude: lat, longitude: lon, location_type: 'address' });
            } catch (e) { console.warn('[LocationMap] Auto-save failed:', e); }
          }
        })
        .catch(() => {});
    }
  }, [isOpen, property.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

        <div className="inline-block align-bottom sb-panel-bg rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl w-full location-map-modal">
          {/* Round 6: was `bg-white` here on top of the outer sb-panel-bg wrapper --
              a plain opaque white layered over the app-wide 0.92 panel color, so this
              modal looked different (fully opaque) from every other sb-panel-bg surface.
              Dropped it so the shared variable shows through consistently. Also
              narrowed sm:max-w-3xl -> sm:max-w-2xl (matches the booking modal) and
              mb-4 -> mb-2 under the heading -- David: "the modal looks very big". */}
          <div className="px-3 pt-4 pb-3 sm:px-6 sm:pt-5 sm:pb-4">
            <div className="flex justify-between items-center mb-2">
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
                  <X className="h-5 w-5" />
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
                    <div className="mt-1 flex items-center gap-2 lm-address-row">
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddressSearch()}
                        className="sb-input-light lm-address-input"
                        placeholder="Enter street address"
                      />
                      <button
                        onClick={handleAddressSearch}
                        className="btn lm-search-btn"
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
                {...({
                  center: coordinates,
                  zoom: 5,
                  className: 'map-full-size',
                  // NOTE: react-leaflet v4's MapContainer doesn't type an onClick prop (map click
                  // handling normally goes through useMapEvents on a child component) — kept as-is
                  // via cast to preserve existing behavior; worth verifying click-to-set-location
                  // still works, otherwise this needs a proper useMapEvents wiring.
                  onClick: handleMapClick,
                } as any)}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {canSeeExactLocation ? (
                  <Marker position={coordinates} />
                ) : (
                  // "40px wide... don't know exactly where it is" -- a fuzzy
                  // area blob instead of a pinpoint marker. CircleMarker's
                  // radius is in screen pixels, so 20 = 40px across however
                  // far the map is zoomed.
                  <CircleMarker
                    center={coordinates}
                    radius={20}
                    pathOptions={{ color: 'var(--brand, #C47756)', weight: 2, fillColor: 'var(--brand, #C47756)', fillOpacity: 0.35 }}
                  />
                )}
                <MapUpdater center={coordinates} targetZoom={canSeeExactLocation ? 16 : 13} />
              </MapContainer>
            </div>

            {!isEditing && (() => {
              const lat = coordinates[0];
              const lng = coordinates[1];
              const fullAddr = property.address || property.local_area || '';
              if (!fullAddr) return null;

              // David: "replace the first two words of the address with ..."
              // -- drops the house number + street name for anyone who
              // hasn't booked, leaving only the general area (city/region).
              const obscureAddress = (addr: string) => {
                const words = addr.trim().split(/\s+/).filter(Boolean);
                if (words.length <= 2) return '...';
                return '... ' + words.slice(2).join(' ');
              };
              const shownAddress = canSeeExactLocation ? fullAddr : obscureAddress(fullAddr);

              const mapsUrl = canSeeExactLocation
                ? (lat && lng
                  ? `https://www.google.com/maps?q=${lat},${lng}`
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddr)}`)
                : (shownAddress !== '...'
                  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shownAddress.replace(/^\.\.\.\s*/, ''))}`
                  : null);

              return (
                <>
                  <div className="lm-address-row">
                    <p className="location-address-text lm-address-row-text">{shownAddress}</p>
                    {mapsUrl && (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lm-tiny-map-btn"
                        aria-label="Open in Google Maps"
                        title="Open in Google Maps"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  {!canSeeExactLocation && (
                    <p className="lm-general-area-note">General area shown — the exact address is shared once your booking is confirmed.</p>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}