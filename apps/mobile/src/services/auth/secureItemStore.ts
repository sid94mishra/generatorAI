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
  //
  // Trade-off, decided deliberately (and why it differs from the Secure
  // Enclave key, which is AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY — see
  // modules/generatorai-device-key): the hardware key is useless without
  // this session item (it holds the resume secret), so the SESSION's class is
  // what actually gates "can this phone talk to the server". Keeping it
  // WHEN_UNLOCKED means nothing can act on the user's machine while the phone
  // is locked. The cost is that iOS may launch the app locked (a background
  // wake, a notification action) and the read then rejects. That is handled,
  // not avoided:
  //   * `AuthProvider` maps a failed read to a distinct `storageLocked`
  //     state (never `unpaired`) and retries when the app becomes active;
  //   * approval notification actions require device authentication
  //     (`notificationCategories.ts`), so they only ever run unlocked.
  // Loosening this to AFTER_FIRST_UNLOCK would allow background refresh
  // while locked, which nothing in the app needs.
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
