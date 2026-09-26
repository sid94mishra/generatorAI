// ────────────────────────────────────────────────────────────────
// The desktop shell's native browser bridge (`window.generatoraiDesktop.
// browser`, preload IPC). Absent in the web build and in a desktop build
// without the native-browser flag; every caller checks before use. Read at
// call time, never cached, because the bridge can be installed after load.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

export type NativeBrowserBridge = NonNullable<NonNullable<Window['generatoraiDesktop']>['browser']>;

export function nativeBrowserBridge(): NativeBrowserBridge | undefined {
  return window.generatoraiDesktop?.browser;
}

/** True once the desktop shell confirms it can host native browser views. */
export function useNativeBrowserAvailable(): boolean {
  const [nativeAvailable, setNativeAvailable] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ok = await window.generatoraiDesktop?.browser?.available?.();
        if (!cancelled) setNativeAvailable(!!ok);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);
  return nativeAvailable;
}

/** Open the native tab's DevTools, optionally on one panel. */
export function openNativeDevtools(tabId: string, panel?: 'network' | 'console' | 'elements'): void {
  const nb = window.generatoraiDesktop?.browser;
  void (panel ? nb?.openDevtools?.(tabId, panel) : nb?.openDevtools?.(tabId));
}
