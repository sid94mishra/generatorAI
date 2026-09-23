// Drawer open state and the segments the shared tab roots are showing.
// A store rather than context: the menu button lives in screen headers, the
// drawer at the app root, and neither should re-render the tree between them.

import { create } from 'zustand';

import type { ProjectsTabSegment, ShellSegments, WorkTabSegment } from './sections';

interface ShellState extends ShellSegments {
  drawerOpen: boolean;
  openDrawer(): void;
  closeDrawer(): void;
  setDrawerOpen(open: boolean): void;
  setWorkSegment(segment: WorkTabSegment): void;
  setProjectsSegment(segment: ProjectsTabSegment): void;
}

export const useShellStore = create<ShellState>((set) => ({
  drawerOpen: false,
  work: 'workflows',
  projects: 'projects',
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setWorkSegment: (work) => set((s) => (s.work === work ? s : { work })),
  setProjectsSegment: (projects) => set((s) => (s.projects === projects ? s : { projects })),
}));
