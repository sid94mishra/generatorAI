// ────────────────────────────────────────────────────────────────
// Web-only "interactive browser" setting (03-component-inventory-domain.md
// §6.2). When false (the default) the SPA hides the browser's navigation
// controls and blocks mouse/keyboard input to the live view, except for
// element inspect and passive scroll. The desktop app ignores it: its native
// view is a real browser tab, so interactivity is always on there.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

export const INTERACTIVITY_STORAGE_KEY = 'generatorai:browser:webInteractivity';

/** Read the current interactivity setting. */
export function getWebBrowserInteractivity(): boolean {
  try {
    return window.localStorage.getItem(INTERACTIVITY_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist the interactivity setting. Emits a `storage` event so other
 * open tabs pick up the change and re-render. */
export function setWebBrowserInteractivity(v: boolean): void {
  try {
    const oldValue = window.localStorage.getItem(INTERACTIVITY_STORAGE_KEY);
    const newValue = String(v);
    window.localStorage.setItem(INTERACTIVITY_STORAGE_KEY, newValue);
    // `newValue`/`storageArea` are not optional in practice: third-party
    // storage-sync listeners read a null `newValue` as "key deleted" and
    // helpfully remove the entry we just wrote.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: INTERACTIVITY_STORAGE_KEY,
        oldValue,
        newValue,
        storageArea: window.localStorage,
        url: window.location.href,
      }),
    );
  } catch {
    /* ignore */
  }
}

/** React hook wrapping the interactivity setting; follows `storage` events. */
export function useWebBrowserInteractivity(): boolean {
  const [v, setV] = useState<boolean>(() => getWebBrowserInteractivity());
  useEffect(() => {
    const handler = (e: StorageEvent): void => {
      if (e.key === INTERACTIVITY_STORAGE_KEY || e.key == null) {
        setV(getWebBrowserInteractivity());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  return v;
}
