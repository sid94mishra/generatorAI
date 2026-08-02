// ────────────────────────────────────────────────────────────────
// uiStore — global UI chrome state (sidebar, command palette).
// `sidebarOpen` persists to localStorage; `commandPaletteOpen` is
// session-only (excluded via partialize).
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  /** Whether the app sidebar is expanded. Persisted. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  /** Whether the ⌘K command palette is open. NOT persisted. */
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    }),
    {
      name: 'generatorai:ui',
      partialize: (s) => ({ sidebarOpen: s.sidebarOpen }),
    },
  ),
);
