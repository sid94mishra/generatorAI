// ────────────────────────────────────────────────────────────────
// Non-sensitive preferences.
//
// MMKV, not SecureStore: this is read synchronously during the first render
// (theme, before the splash screen lifts) and an async read would guarantee
// the white flash we are trying to avoid.
//
// NOTHING sensitive goes here. Tokens, resume secrets and key material live
// in SecureStore — see src/auth/stores.ts.
// ────────────────────────────────────────────────────────────────

import { createMMKV } from 'react-native-mmkv';

const storage = createMMKV({ id: 'generatorai.prefs' });

export const prefs = {
  getString(key: string): string | undefined {
    return storage.getString(key);
  },
  setString(key: string, value: string): void {
    storage.set(key, value);
  },
  getBoolean(key: string, fallback = false): boolean {
    return storage.getBoolean(key) ?? fallback;
  },
  setBoolean(key: string, value: boolean): void {
    storage.set(key, value);
  },
  getNumber(key: string, fallback: number): number {
    const value = storage.getNumber(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  },
  setNumber(key: string, value: number): void {
    storage.set(key, value);
  },
  delete(key: string): void {
    storage.remove(key);
  },
};

export const PREF_KEYS = {
  /** App lock: require biometrics / passcode on cold start and after `lockGraceSeconds`. */
  biometricLock: 'generatorai.biometric-lock',
  /** Seconds in the background before the app lock re-arms. `0` = immediately. */
  lockGraceSeconds: 'generatorai.lock-grace-seconds',
  localOnly: 'generatorai.local-only',
  /** Last visited route, restored on a cold start within `LAST_ROUTE_TTL_MS`. */
  lastRoute: 'generatorai.last-route',
  /** Epoch ms of the `lastRoute` write — the TTL is measured from here. */
  lastRouteAt: 'generatorai.last-route-at',
  motion: 'generatorai.motion',
  haptics: 'generatorai.haptics',
  /** Whether `<Screen>`'s large title collapses on scroll. */
  largeTitleCollapse: 'generatorai.large-title-collapse',
  /** Locally disabled skills — mirrors the web's `catalogPrefsStore`. */
  disabledSkills: 'generatorai.disabled-skills',
} as const;
