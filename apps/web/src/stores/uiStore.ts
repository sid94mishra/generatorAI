// ────────────────────────────────────────────────────────────────
// uiStore — global UI chrome state (sidebar, command palette).
// `sidebarOpen` persists to localStorage; `commandPaletteOpen` is
// session-only (excluded via partialize).
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { globalSingleton } from '../lib/globalSingleton.js';

interface UiState {
  /** Whether the app sidebar is expanded. Persisted. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  /** Whether the ⌘K command palette is open. NOT persisted. */
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

const useUiStoreImpl = create<UiState>()(
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


// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useUiStore = globalSingleton('web.uiStore', () => useUiStoreImpl);
