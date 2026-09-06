import React, { useState } from 'react';
import { User } from 'lucide-react';
import { useAuth } from '../store/auth';
import { AdminSidebar } from '../components/AdminSidebar';

export function AdminSidebarPreview() {
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="text-center space-y-4">
        <p className="text-gray-500 text-sm uppercase tracking-wide font-medium">
          New Sidebar Preview
        </p>
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow text-gray-700 font-medium"
        >
          <User className="h-5 w-5" />
          Open New Sidebar
        </button>
        {!user && (
          <p className="text-xs text-amber-600">Sign in as admin to see live data</p>
        )}
      </div>

      <AdminSidebar isOpen={isOpen} onClose={() => setIsOpen(false)} mockMode />
    </div>
  );
}
