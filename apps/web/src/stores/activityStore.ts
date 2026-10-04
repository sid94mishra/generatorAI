// ────────────────────────────────────────────────────────────────
// activityStore — the Activity column's state (D-92).
//
//   open        the column is shown (persisted). Docked beside the sidebar or
//               rail while the main card keeps SHELL.activityColumn.minMain px,
//               else an overlay over the card (app/shell decides).
//   width       px, persisted, clamped to SHELL.activityColumn min/max
//   kind        the kind tab (persisted)
//   showRecent  the filter menu's "Show finished" (persisted)
//   dismissed   failures dismissed on this device (`ActivityEntry.dismissKey`,
//               newest last, capped): a newer failure of the same entity shows
//               again (persisted; per device by design — D-92)
//   preview     the card whose popover is open (session; one at a time)
//   focusRequest  bumped when the person opens the column (session)
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ACTIVITY_KINDS, type ActivityKind } from '@generatorai/shared/ui-contract';
import { SHELL } from '@generatorai/design-tokens';
import { globalSingleton } from '../lib/globalSingleton.js';

export type ActivityKindFilter = ActivityKind | 'all';

const GEOMETRY = SHELL.activityColumn;
/** Dismissals kept; older ones are long gone from a day's feed. */
const MAX_DISMISSED = 200;

export function clampActivityWidth(width: number): number {
  if (!Number.isFinite(width)) return GEOMETRY.width;
  return Math.round(Math.min(GEOMETRY.max, Math.max(GEOMETRY.min, width)));
}

interface ActivityState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  width: number;
  setWidth: (width: number) => void;
  kind: ActivityKindFilter;
  setKind: (kind: ActivityKindFilter) => void;
  showRecent: boolean;
  setShowRecent: (show: boolean) => void;
  dismissed: string[];
  dismiss: (key: string) => void;
  preview: string | null;
  setPreview: (key: string | null) => void;
  /**
   * Bumped when the person opens the column (toggle, command): the column then
   * moves focus to the open page's card. A column restored open at launch does
   * not take focus. Session-only.
   */
  focusRequest: number;
}

const useActivityStoreImpl = create<ActivityState>()(
  persist(
    (set) => ({
      open: false,
      setOpen: (open) => set((s) => (open ? { open, focusRequest: s.open ? s.focusRequest : s.focusRequest + 1 } : { open, preview: null })),
      toggle: () => set((s) => ({ open: !s.open, preview: null, focusRequest: s.open ? s.focusRequest : s.focusRequest + 1 })),
      focusRequest: 0,
      width: GEOMETRY.width,
      setWidth: (width) => set({ width: clampActivityWidth(width) }),
      kind: 'all',
      setKind: (kind) => set({ kind }),
      showRecent: true,
      setShowRecent: (showRecent) => set({ showRecent }),
      dismissed: [],
      dismiss: (key) =>
        set((s) => (s.dismissed.includes(key) ? s : { dismissed: [...s.dismissed, key].slice(-MAX_DISMISSED) })),
      preview: null,
      setPreview: (preview) => set({ preview }),
    }),
    {
      name: 'generatorai:activity',
      partialize: (s) => ({ open: s.open, width: s.width, kind: s.kind, showRecent: s.showRecent, dismissed: s.dismissed }),
      // A stored value from another build is checked field by field, never trusted.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Record<keyof ActivityState, unknown>>;
        return {
          ...current,
          ...(typeof p.open === 'boolean' ? { open: p.open } : {}),
          ...(typeof p.width === 'number' ? { width: clampActivityWidth(p.width) } : {}),
          ...(p.kind === 'all' || ACTIVITY_KINDS.includes(p.kind as ActivityKind) ? { kind: p.kind as ActivityKindFilter } : {}),
          ...(typeof p.showRecent === 'boolean' ? { showRecent: p.showRecent } : {}),
          ...(Array.isArray(p.dismissed)
            ? { dismissed: p.dismissed.filter((k): k is string => typeof k === 'string').slice(-MAX_DISMISSED) }
            : {}),
        };
      },
    },
  ),
);

// HMR-split-proof: every module instance shares the first-created store (lib/globalSingleton.ts).
export const useActivityStore = globalSingleton('web.activityStore', () => useActivityStoreImpl);
