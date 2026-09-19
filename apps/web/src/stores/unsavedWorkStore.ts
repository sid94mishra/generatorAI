// ────────────────────────────────────────────────────────────────
// unsavedWorkStore — which editors are holding changes that closing loses.
//
// In-app navigation is already guarded per page (react-router's `useBlocker`),
// but the window's close button, Cmd+W and Quit end the page from outside it,
// where no route change ever happens. The desktop shell asks before discarding,
// and this is how it knows there is something to discard.
//
// Keyed so two editors open at once cannot clear each other's flag.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

interface UnsavedWorkState {
  dirtyKeys: ReadonlySet<string>;
  setDirty: (key: string, dirty: boolean) => void;
}

export const useUnsavedWorkStore = globalSingleton('unsavedWorkStore', () =>
  create<UnsavedWorkState>((set) => ({
    dirtyKeys: new Set<string>(),
    setDirty: (key, dirty) =>
      set((state) => {
        const has = state.dirtyKeys.has(key);
        if (has === dirty) return state;
        const next = new Set(state.dirtyKeys);
        if (dirty) next.add(key);
        else next.delete(key);
        return { dirtyKeys: next };
      }),
  })),
);
