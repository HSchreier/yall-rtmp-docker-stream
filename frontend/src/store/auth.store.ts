import { create } from 'zustand';
import { eventBus } from '../infra/event-bus';

interface AuthState {
  token: string | null;
  userId: string | null;
  role: 'admin' | 'user' | null;
  email: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setToken: (token: string, userId: string, role: 'admin' | 'user', email: string) => void;
  clearToken: () => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;

  // Hydration from localStorage
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  userId: null,
  role: null,
  email: null,
  isLoading: false,
  error: null,

  setToken: (token, userId, role, email) => {
    localStorage.setItem('authToken', token);
    localStorage.setItem('userId', userId);
    localStorage.setItem('userRole', role);
    localStorage.setItem('userEmail', email);

    set({ token, userId, role, email, error: null });
    eventBus.emit('auth:login', { userId, role });
  },

  clearToken: () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userId');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userEmail');

    set({ token: null, userId: null, role: null, email: null });
    eventBus.emit('auth:logout', {});
  },

  setError: (error) => set({ error }),

  setLoading: (isLoading) => set({ isLoading }),

  hydrate: () => {
    const token = localStorage.getItem('authToken');
    const userId = localStorage.getItem('userId');
    const role = localStorage.getItem('userRole') as 'admin' | 'user' | null;
    const email = localStorage.getItem('userEmail');

    if (token && userId && role && email) {
      set({ token, userId, role, email });
    }
  },
}));

// Hydrate on app start
useAuthStore.getState().hydrate();
