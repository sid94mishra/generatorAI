// Drawer open state. A store rather than context: the menu button lives in screen headers, the drawer at the
// app root, and neither should re-render the tree between them.
import { create } from 'zustand';

interface ShellState {
  drawerOpen: boolean;
  openDrawer(): void;
  closeDrawer(): void;
  setDrawerOpen(open: boolean): void;
}

export const useShellStore = create<ShellState>((set) => ({
  drawerOpen: false,
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
}));
