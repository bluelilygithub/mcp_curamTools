import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * toolStore — tool navigation and sidebar state.
 * key: mcp-curamtools-tool
 */
const useToolStore = create(
  persist(
    (set) => ({
      lastVisitedTool: null,
      sidebarCollapsed: false,

      setLastVisitedTool: (lastVisitedTool) => set({ lastVisitedTool }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    }),
    {
      name: 'mcp-curamtools-tool',
    }
  )
);

export default useToolStore;
