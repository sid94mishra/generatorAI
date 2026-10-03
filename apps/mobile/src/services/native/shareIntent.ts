// Share to agent — the intake (MX-09, 06 §7.7; MD-190). The OS share sheet hands content to expo-share-intent: the
// iOS share extension stores it in the App Group and opens `generatorai://dataUrl=<key>` (routed to `/share`), the
// Android ACTION_SEND / SEND_MULTIPLE intent reaches the main activity. This file asks the native module for the
// payload, keeps it in a small store for the `/share` sheet, and opens that sheet. Nothing is sent from here: the
// sheet sends only on Send, through the authenticated app (the extension holds no credentials).
// A client built without the module never receives a share.
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { ShareIntentModule, getShareExtensionKey, parseShareIntent } from 'expo-share-intent';

import { isShareHandoff, toSharePayload, type SharePayload } from './sharePayload';

export type { SharedFile, SharePayload } from './sharePayload';

// ── Store ───────────────────────────────────────────────────────

let pending: SharePayload | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

export const shareStore = {
  get: (): SharePayload | null => pending,
  set(payload: SharePayload | null): void {
    pending = payload;
    emit();
  },
  /** Sent or cancelled: forget it here and in the native module. */
  clear(): void {
    pending = null;
    emit();
    try {
      void ShareIntentModule?.clearShareIntent(getShareExtensionKey());
    } catch {
      // Nothing stored natively.
    }
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useSharePayload(): SharePayload | null {
  return useSyncExternalStore(shareStore.subscribe, shareStore.get, shareStore.get);
}

// ── Intake ──────────────────────────────────────────────────────

/**
 * Mounted once at the root: listens for shares and calls `open()` when one arrives (the caller navigates to
 * `/share`; on iOS the hand-off link already routed there).
 */
export function useShareIntake(open: () => void): void {
  useEffect(() => {
    const module = ShareIntentModule;
    if (!module || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
    const ask = (url: string): void => {
      void Promise.resolve(module.getShareIntent(url)).catch(() => undefined);
    };
    const change = module.addListener('onChange', (event) => {
      let payload: SharePayload | null = null;
      try {
        payload = toSharePayload(parseShareIntent(event.value, {}), Date.now());
      } catch {
        payload = null;
      }
      if (!payload) return;
      shareStore.set(payload);
      open();
    });
    const askFor = (url: string | null): void => {
      if (Platform.OS === 'ios') {
        if (isShareHandoff(url)) ask(url!);
      } else {
        ask('');
      }
    };
    void Linking.getInitialURL().then(askFor, () => undefined);
    const link = Linking.addEventListener('url', ({ url }) => askFor(url));
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active' && Platform.OS === 'android') ask('');
    });
    return () => {
      change.remove();
      link.remove();
      app.remove();
    };
  }, [open]);
}
