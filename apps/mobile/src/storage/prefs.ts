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
  delete(key: string): void {
    storage.remove(key);
  },
};

export const PREF_KEYS = {
  biometricLock: 'generatorai.biometric-lock',
  localOnly: 'generatorai.local-only',
  lastRoute: 'generatorai.last-route',
  motion: 'generatorai.motion',
  haptics: 'generatorai.haptics',
  /** Locally disabled skills — mirrors the web's `catalogPrefsStore`. */
  disabledSkills: 'generatorai.disabled-skills',
} as const;
