// Onboarding Flow Component
// src/pages/Onboarding.tsx

import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

export function Onboarding() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Form data
  const [formData, setFormData] = useState({
    // Step 1: Account
    email: '',
    password: '',
    name: '',
    // Step 2: Property
    propertyName: '',
    tagline: '',
    description: '',
    // Step 3: Details
    pricePerNight: 150,
    bedrooms: 1,
    bathrooms: 1,
    maxGuests: 2,
    address: '',
    city: '',
    country: '',
    // Step 4: Images
    images: [] as string[]
  });

  async function handleSignUp() {
    setLoading(true);
    setError('');
    
    try {
      // Sign up user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            name: formData.name
          }
        }
      });
      
      if (authError) throw authError;
      if (!authData.user) throw new Error('No user created');
      
      // Create property
      const { data: property, error: propertyError } = await supabase
        .from('properties')
        .insert({
          title: formData.propertyName,
          description: formData.description,
          price_per_night: formData.pricePerNight,
          bedrooms: formData.bedrooms,
          bathrooms: formData.bathrooms,
          max_guests: formData.maxGuests,
          owner_id: authData.user.id,
          // Store additional info in JSON fields
          property_details: JSON.stringify({
            address: formData.address,
            city: formData.city,
            country: formData.country,
            tagline: formData.tagline
          })
        })
        .select()
        .single();
      
      if (propertyError) throw propertyError;
      
      // Go to success step
      setStep(5);
      
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {[1, 2, 3, 4].map(s => (
              <div
                key={s}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                  step >= s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                }`}
              >
                {s}
              </div>
            ))}
          </div>
          <div className="h-2 bg-gray-200 rounded">
            <div
              className="h-2 bg-blue-600 rounded transition-all"
              style={{ width: `${(step / 4) * 100}%` }}
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Step 1: Account */}
        {step === 1 && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Create Your Account</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="John Smith"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="you@example.com"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={e => setFormData({...formData, password: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="••••••••"
                />
              </div>
            </div>
            
            <button
              onClick={() => setStep(2)}
              disabled={!formData.email || !formData.password || !formData.name}
              className="w-full mt-6 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 2: Property Info */}
        {step === 2 && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Tell Us About Your Property</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Property Name
                </label>
                <input
                  type="text"
                  value={formData.propertyName}
                  onChange={e => setFormData({...formData, propertyName: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Beach House Paradise"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tagline
                </label>
                <input
                  type="text"
                  value={formData.tagline}
                  onChange={e => setFormData({...formData, tagline: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Your perfect beach getaway"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  rows={4}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Describe your property..."
                />
              </div>
            </div>
            
            <div className="flex gap-4 mt-6">
              <button
                onClick={() => setStep(1)}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!formData.propertyName}
                className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Details */}
        {step === 3 && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Property Details</h2>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price per Night ($)
                </label>
                <input
                  type="number"
                  value={formData.pricePerNight}
                  onChange={e => setFormData({...formData, pricePerNight: parseInt(e.target.value)})}
                  className="w-full px-4 py-2 border rounded-lg"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Guests
                </label>
                <input
                  type="number"
                  value={formData.maxGuests}
                  onChange={e => setFormData({...formData, maxGuests: parseInt(e.target.value)})}
                  className="w-full px-4 py-2 border rounded-lg"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bedrooms
                </label>
                <input
                  type="number"
                  value={formData.bedrooms}
                  onChange={e => setFormData({...formData, bedrooms: parseInt(e.target.value)})}
                  className="w-full px-4 py-2 border rounded-lg"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bathrooms
                </label>
                <input
                  type="number"
                  value={formData.bathrooms}
                  onChange={e => setFormData({...formData, bathrooms: parseInt(e.target.value)})}
                  className="w-full px-4 py-2 border rounded-lg"
                />
              </div>
            </div>
            
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Address
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={e => setFormData({...formData, address: e.target.value})}
                className="w-full px-4 py-2 border rounded-lg"
                placeholder="123 Beach Street"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  City
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={e => setFormData({...formData, city: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Country
                </label>
                <input
                  type="text"
                  value={formData.country}
                  onChange={e => setFormData({...formData, country: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg"
                />
              </div>
            </div>
            
            <div className="flex gap-4 mt-6">
              <button
                onClick={() => setStep(2)}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200"
              >
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Review & Submit */}
        {step === 4 && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Review & Launch</h2>
            
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <h3 className="font-medium text-gray-700">Account</h3>
                <p className="text-gray-600">{formData.name} ({formData.email})</p>
              </div>
              
              <div className="p-4 bg-gray-50 rounded-lg">
                <h3 className="font-medium text-gray-700">Property</h3>
                <p className="text-gray-600">{formData.propertyName}</p>
                <p className="text-sm text-gray-500">{formData.tagline}</p>
                <p className="text-sm text-gray-500">${formData.pricePerNight}/night • {formData.bedrooms} bed • {formData.bathrooms} bath</p>
              </div>
              
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="font-medium text-blue-800">Pricing</h3>
                <p className="text-blue-600">4% transaction fee on all bookings</p>
                <p className="text-sm text-blue-500">No setup fee • No monthly fee</p>
              </div>
            </div>
            
            <div className="flex gap-4 mt-6">
              <button
                onClick={() => setStep(3)}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200"
              >
                Back
              </button>
              <button
                onClick={handleSignUp}
                disabled={loading}
                className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Launch My Site!'}
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Success */}
        {step === 5 && (
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🎉</span>
            </div>
            
            <h2 className="text-2xl font-bold mb-4">Your Site is Live!</h2>
            
            <p className="text-gray-600 mb-6">
              Your vacation rental website is now live! You can now:
            </p>
            
            <ul className="text-left space-y-3 mb-6">
              <li className="flex items-center gap-2">
                <span>✓</span> Add more property photos
              </li>
              <li className="flex items-center gap-2">
                <span>✓</span> Set up your booking calendar
              </li>
              <li className="flex items-center gap-2">
                <span>✓</span> Connect your Stripe account to receive payments
              </li>
              <li className="flex items-center gap-2">
                <span>✓</span> Share your site with guests
              </li>
            </ul>
            
            <a
              href="/property-admin"
              className="block w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700"
            >
              Go to My Dashboard
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
