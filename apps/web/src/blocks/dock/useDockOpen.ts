// ────────────────────────────────────────────────────────────────
// useDockOpen — the page's dock open state, persisted under
// `generatorai:dock:<scope>:open` ('1' | '0'; global to the page, D-27).
// ────────────────────────────────────────────────────────────────

import { useCallback, useState } from 'react';

export function useDockOpen(storageKey: string, initial = false): [boolean, (next: boolean) => void, () => void] {
  const [open, setOpenState] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw != null) return raw === '1';
    } catch {
      /* storage unavailable: fall back to `initial` */
    }
    return initial;
  });
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      try {
        window.localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* storage unavailable: open state is not remembered */
      }
    },
    [storageKey],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  return [open, setOpen, toggle];
}
