// ────────────────────────────────────────────────────────────────
// Secure item storage (native).
//
// A thin re-export so the auth stores can depend on one module that Metro
// resolves per platform. On iOS/Android this is the real Keychain / Keystore.
// See the `.web.ts` sibling for why the web build cannot use this.
// ────────────────────────────────────────────────────────────────

import * as SecureStore from 'expo-secure-store';

export type SecureItemOptions = SecureStore.SecureStoreOptions;

/**
 * `false` only on the web preview build, where no OS-protected store exists.
 * Callers use this to report the real posture instead of implying hardware
 * protection they are not getting.
 */
export const IS_OS_PROTECTED = true;

export const KEYCHAIN_OPTIONS: SecureItemOptions = {
  // `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is deliberate on both counts:
  //   * WHEN_UNLOCKED — a locked, stolen phone cannot be made to talk to the
  //     user's server from the lock screen.
  //   * THIS_DEVICE_ONLY — the credential must not ride an iCloud backup onto
  //     a different handset, which would silently clone an authorized device.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'dev.generatorai.app',
};

export function getItemAsync(key: string, options?: SecureItemOptions): Promise<string | null> {
  return SecureStore.getItemAsync(key, options);
}

export function setItemAsync(
  key: string,
  value: string,
  options?: SecureItemOptions,
): Promise<void> {
  return SecureStore.setItemAsync(key, value, options);
}

export function deleteItemAsync(key: string, options?: SecureItemOptions): Promise<void> {
  return SecureStore.deleteItemAsync(key, options);
}
