import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * settingsStore — UI appearance settings.
 * key: mcp-curamtools-settings
 */
const useSettingsStore = create(
  persist(
    (set) => ({
      bodyFont: 'Inter',
      headingFont: 'Playfair Display',
      monoFont: 'DM Mono',
      theme: 'warm-sand',

      setBodyFont: (bodyFont) => set({ bodyFont }),
      setHeadingFont: (headingFont) => set({ headingFont }),
      setMonoFont: (monoFont) => set({ monoFont }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'mcp-curamtools-settings',
    }
  )
);

export default useSettingsStore;
