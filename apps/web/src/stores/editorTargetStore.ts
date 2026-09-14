// ────────────────────────────────────────────────────────────────
// editorTargetStore — "what would 'Open in editor' open on this page?"
//
// The split button lives in the top bar, which knows nothing about chats,
// runs, projects or codebases. Rather than teach the Header to resolve a
// path four different ways (and refetch four different queries on every
// route), each page publishes its own answer here in an effect and clears
// it on unmount. The Header renders the button only while a target is set,
// so a page that has no path — or has not resolved one yet — simply has no
// button rather than a broken one.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

export interface EditorTarget {
  /** Absolute path on the SERVER host — that is where the editor launches. */
  path: string;
  /** What the button's tooltip calls it, e.g. the mount alias or chat name. */
  label: string;
}

interface EditorTargetState {
  target: EditorTarget | null;
  setEditorTarget: (target: EditorTarget | null) => void;
  clearEditorTarget: () => void;
}

const useEditorTargetStoreImpl = create<EditorTargetState>((set) => ({
  target: null,
  setEditorTarget: (target) => set({ target }),
  clearEditorTarget: () => set({ target: null }),
}));

// HMR-split-proof: every module instance shares the first-created store.
export const useEditorTargetStore = globalSingleton(
  'web.editorTargetStore',
  () => useEditorTargetStoreImpl,
);

/**
 * Publish this page's editor target for as long as it is mounted.
 *
 * Pass `null` (or a falsy path) while the path is still loading — the button
 * stays hidden instead of flashing a target the page cannot honour yet.
 */
export function useEditorTarget(path: string | undefined | null, label: string): void {
  useEffect(() => {
    const { setEditorTarget } = useEditorTargetStore.getState();
    if (!path) {
      setEditorTarget(null);
      return undefined;
    }
    setEditorTarget({ path, label });
    return () => {
      // Only clear if we are still the published target: a route change
      // mounts the next page's effect before this cleanup runs, and an
      // unconditional clear would wipe the new page's freshly set target.
      const current = useEditorTargetStore.getState().target;
      if (current?.path === path) setEditorTarget(null);
    };
  }, [path, label]);
}
