// ────────────────────────────────────────────────────────────────
// filesViewStore — how the Files dock reads on this device: the file tree
// shown beside a file, which side it sits on, and wrapped lines. One setting
// for every Files and file tab (a tab opened from the tree shows the tree too,
// so it is never re-opened tab by tab), persisted in browser storage.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { globalSingleton } from '../lib/globalSingleton.js';

export type FilesTreePosition = 'left' | 'right';

interface FilesViewState {
  showTree: boolean;
  treePosition: FilesTreePosition;
  wrapLines: boolean;
  toggleTree: () => void;
  /** Choosing a side is asking to see the tree there. */
  placeTree: (position: FilesTreePosition) => void;
  toggleWrapLines: () => void;
}

const useFilesViewStoreImpl = create<FilesViewState>()(
  persist(
    (set) => ({
      showTree: true,
      treePosition: 'left',
      wrapLines: false,
      toggleTree: () => set((s) => ({ showTree: !s.showTree })),
      placeTree: (treePosition) => set({ treePosition, showTree: true }),
      toggleWrapLines: () => set((s) => ({ wrapLines: !s.wrapLines })),
    }),
    { name: 'generatorai:filesView' },
  ),
);

export const useFilesViewStore = globalSingleton('web.filesViewStore', () => useFilesViewStoreImpl);
