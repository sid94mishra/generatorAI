// Shell state (06 §1.4 rule 3): the drawer's open flag, the tablet sidebar's hidden flag (per device, MMKV
// `shell.sidebarHidden`) and who owns gestures (a focused terminal / WebView suspends the panel gestures and the
// hardware shortcuts, MD-19). A store, not context: the header toggles, the panels and the key-command host read it
// without re-rendering the tree between them.
import { create } from 'zustand';
import { prefs } from '../../services/storage/prefs';

const SIDEBAR_HIDDEN_KEY = 'shell.sidebarHidden';

export type GestureOwner = 'shell' | 'surface';

interface ShellState {
  drawerOpen: boolean;
  sidebarHidden: boolean;
  gestureOwner: GestureOwner;
  setDrawerOpen(open: boolean): void;
  toggleDrawer(): void;
  setSidebarHidden(hidden: boolean): void;
  setGestureOwner(owner: GestureOwner): void;
}

function readHidden(): boolean {
  try {
    return prefs.getString(SIDEBAR_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export const useShellStore = create<ShellState>((set) => ({
  drawerOpen: false,
  sidebarHidden: readHidden(),
  gestureOwner: 'shell',
  setDrawerOpen: (drawerOpen) => set((s) => (s.drawerOpen === drawerOpen ? s : { drawerOpen })),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  setSidebarHidden: (sidebarHidden) => {
    try {
      prefs.setString(SIDEBAR_HIDDEN_KEY, sidebarHidden ? '1' : '0');
    } catch {
      // A preference write never blocks the toggle.
    }
    set({ sidebarHidden });
  },
  setGestureOwner: (gestureOwner) => set((s) => (s.gestureOwner === gestureOwner ? s : { gestureOwner })),
}));
