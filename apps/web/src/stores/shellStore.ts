// ────────────────────────────────────────────────────────────────
// shellStore — app-frame state (06 §2.2; replaces uiStore).
//
//   sidebarPref   'expanded' | 'rail' — the user's choice, persisted under
//                 `generatorai:shell`. Below 1200px (or on a route that forces
//                 the rail) the frame shows the rail regardless; the choice is
//                 kept for when the window grows again (app/shell/useSidebarMode).
//   flyoutOpen    the full sidebar opened over a forced rail. Session-only.
//   railForced    mirrored from the shell so `toggleSidebar` (the registry's
//                 `sidebar.toggle`) knows which of the two to flip.
//   commandPaletteOpen, shortcutsOpen  overlays. Session-only.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { globalSingleton } from '../lib/globalSingleton.js';

export type SidebarPref = 'expanded' | 'rail';

interface ShellState {
  /** The user's sidebar choice. Persisted. */
  sidebarPref: SidebarPref;
  setSidebarPref: (pref: SidebarPref) => void;
  /** The sidebar flyout over a forced rail. NOT persisted. */
  flyoutOpen: boolean;
  setFlyoutOpen: (open: boolean) => void;
  /**
   * The frame shows the rail whatever the preference (window < 1200px or a
   * `forceRail` route). Written by the shell (useSidebarMode); NOT persisted.
   */
  railForced: boolean;
  setRailForced: (forced: boolean) => void;
  /**
   * `sidebar.toggle` (Mod+B, the strip toggle, Collapse, Expand): the flyout
   * while the rail is forced, the preference otherwise (06 §2.5).
   */
  toggleSidebar: () => void;
  /** Whether the ⌘K command palette is open. NOT persisted. */
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  /** Whether the keyboard shortcuts sheet is open. NOT persisted. */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
}

const useShellStoreImpl = create<ShellState>()(
  persist(
    (set) => ({
      sidebarPref: 'expanded',
      setSidebarPref: (sidebarPref) => set({ sidebarPref }),
      flyoutOpen: false,
      setFlyoutOpen: (flyoutOpen) => set({ flyoutOpen }),
      railForced: false,
      setRailForced: (railForced) => set(railForced ? { railForced } : { railForced, flyoutOpen: false }),
      toggleSidebar: () =>
        set((s) =>
          s.railForced
            ? { flyoutOpen: !s.flyoutOpen }
            : { sidebarPref: s.sidebarPref === 'expanded' ? 'rail' : 'expanded' },
        ),
      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      shortcutsOpen: false,
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
    }),
    {
      name: 'generatorai:shell',
      partialize: (s) => ({ sidebarPref: s.sidebarPref }),
      // A stored value from another build is dropped, not trusted.
      merge: (persisted, current) => {
        const pref = (persisted as { sidebarPref?: unknown } | undefined)?.sidebarPref;
        return pref === 'expanded' || pref === 'rail' ? { ...current, sidebarPref: pref } : current;
      },
    },
  ),
);

// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useShellStore = globalSingleton('web.shellStore', () => useShellStoreImpl);
