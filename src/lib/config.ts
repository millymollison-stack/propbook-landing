import { useState, useEffect } from 'react';

// Default configuration - used if no custom config is provided
export const defaultConfig = {
  property: {
    name: 'My Vacation Rental',
    tagline: 'Your perfect getaway',
    description: 'Beautiful property with amazing views',
    pricePerNight: 150,
    currency: 'USD',
    timezone: 'America/Los_Angeles'
  },
  features: {
    bookingEnabled: true,
    reviewsEnabled: true,
    mapEnabled: true,
    paymentEnabled: true
  },
  contact: {
    email: 'hello@example.com',
    phone: '',
    whatsapp: ''
  },
  social: {
    instagram: '',
    facebook: '',
    twitter: ''
  },
  appearance: {
    primaryColor: '#006699',
    accentColor: '#ff6600',
    fontFamily: 'default'
  },
  content: {
    amenities: [],
    houseRules: ['No smoking', 'No pets'],
    cancellationPolicy: 'Free cancellation up to 7 days before check-in'
  }
};

export type Config = typeof defaultConfig;

// Load config from JSON file or use default
export function useConfig() {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadConfig() {
      try {
        // In production, this would fetch from a property-specific config endpoint
        // For now, we'll dynamically import the config
        const configModule = await import('../config.json');
        setConfig({ ...defaultConfig, ...configModule.default });
      } catch (error) {
        console.log('Using default config');
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  return { config, loading };
}

// Helper functions for common config values
export function formatPrice(config: Config, price: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: config.property.currency
  }).format(price);
}

export function getAmenityIcon(amenity: string): string {
  const icons: Record<string, string> = {
    'WiFi': '📶',
    'Kitchen': '🍳',
    'Parking': '🚗',
    'Pool': '🏊',
    'Beach Access': '🏖️',
    'Ocean View': '🌊',
    'Air Conditioning': '❄️',
    'Heating': '🔥',
    'Washer/Dryer': '🧺',
    'TV': '📺',
    'Pet Friendly': '🐕',
    'Smoking Allowed': '🚬'
  };
  return icons[amenity] || '✓';
}
