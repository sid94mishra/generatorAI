// ────────────────────────────────────────────────────────────────
// Secure item storage (web preview ONLY).
//
// `expo-secure-store` is Keychain/Keystore and has no web implementation —
// calling it throws "ExpoSecureStore.default.getValueWithKeyAsync is not a
// function". The browser has no equivalent: there is no OS-protected,
// app-scoped store reachable from JS.
//
// This shim exists so `expo start --web` can be used to review layout,
// navigation and theming on a desktop. It is backed by `localStorage`, which
// means the DPoP private key is readable by any script running on the origin.
// That is an acceptable trade for a local design preview and NOT acceptable
// for anything else, so:
//
//   * `IS_OS_PROTECTED` is false, which makes `MobileDeviceKeyStore` report a
//     `web-preview` backing. The Security screen shows that verbatim, exactly
//     like the desktop reports a non-OS-protected secret backend.
//   * A console warning is emitted once per session so the degradation is
//     never silent.
//
// The shipping targets are iOS and Android; web is a development affordance.
// ────────────────────────────────────────────────────────────────

export interface SecureItemOptions {
  keychainService?: string;
  keychainAccessible?: unknown;
}

export const IS_OS_PROTECTED = false;

export const KEYCHAIN_OPTIONS: SecureItemOptions = {};

const PREFIX = 'generatorai.insecure-web-preview:';

let warned = false;
function warnOnce(): void {
  if (warned) return;
  warned = true;
  console.warn(
    '[auth] Web preview: credentials are stored in localStorage, NOT in an ' +
      'OS-protected keystore. Any script on this origin can read the device ' +
      'private key. Use the iOS/Android build for anything real.',
  );
}

// `localStorage` throws (not returns null) when a browser blocks storage —
// private-mode Safari and third-party-cookie-blocked iframes both do this.
// Treating that as "no stored session" is right: the app then shows the
// pairing screen instead of crashing on boot.
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  warnOnce();
  try {
    return storage()?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  warnOnce();
  try {
    storage()?.setItem(PREFIX + key, value);
  } catch {
    // Quota or blocked storage. The caller cannot recover either, and losing
    // a preview session is harmless.
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    // Nothing to do — the item is unreachable, which is the desired end state.
  }
}
