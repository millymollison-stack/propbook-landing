import { create } from 'zustand';
import type { Property } from '../types';

interface PropertyState {
  title: string | null;
  setTitle: (title: string) => void;
  // The property currently being viewed in CustomerSite / the URL slug
  activeProperty: Property | null;
  setActiveProperty: (prop: Property | null) => void;
}

export const useProperty = create<PropertyState>((set) => ({
  title: null,
  setTitle: (title) => set({ title }),
  activeProperty: null,
  setActiveProperty: (prop) => set({ activeProperty: prop }),
}));
