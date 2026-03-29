import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * authStore — authentication state.
 * key: mcp-curamtools-auth
 *
 * user shape: { id, email, firstName, lastName, phone, orgId, orgName, roles: [{ name, scope_type }] }
 */
const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      user: null,

      setAuth: (token, user) => set({ token, user }),

      clearAuth: () => set({ token: null, user: null }),

      logout: async () => {
        const { token } = get();
        if (token) {
          // Fire and forget — clear local state regardless of API response
          fetch('/api/auth/logout', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
        set({ token: null, user: null });
        window.location.href = '/login';
      },
    }),
    {
      name: 'mcp-curamtools-auth',
    }
  )
);

export default useAuthStore;
