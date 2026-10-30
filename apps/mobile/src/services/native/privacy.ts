// Privacy switches that reach outside the JS app (06 §6.2, §6.5; MD-33, MD-92, MD-185). The only caller of these
// native APIs; every one is optional, so a dev client built before M9 simply skips it.
//
//   • App switcher / Recents (`setAppSwitcherPrivacy`): iOS — expo-screen-capture's blur while the app is inactive
//     (`enableAppSwitcherProtection(0.6)`), under the JS privacy overlay (AppLock.tsx) as a second layer. Android 13+
//     — the device-key module's `Activity.setRecentsScreenshotEnabled(false)` (the stored Recents card) plus FLAG_SECURE
//     through expo-screen-capture (the live tile when Recents opens from the app; it also blocks screenshots).
//   • Secret reveals (`useSecretReveal`): no screenshots or recordings (FLAG_SECURE / iOS secure layer) and no
//     auto-lock while a one-time secret is on screen.
//   • Notification previews (iOS): the App Group flag the notification service extension reads.
//
// expo-screen-capture prevents capture per key; this file keeps its own key set over the native module so the
// app-switcher fallback and the reveals compose (capture is allowed again only when no key holds it).
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

import { setAppGroupInt } from './appGroup';

interface ScreenCaptureNative {
  preventScreenCapture?: () => Promise<void>;
  allowScreenCapture?: () => Promise<void>;
  enableAppSwitcherProtection?: (blurIntensity: number) => Promise<void>;
  disableAppSwitcherProtection?: () => Promise<void>;
}
interface KeepAwakeNative {
  activate?: (tag: string) => Promise<void>;
  deactivate?: (tag: string) => Promise<void>;
}
interface DeviceKeyPrivacyNative {
  setRecentsScreenshotEnabled?: (enabled: boolean) => boolean;
}

const screenCapture = requireOptionalNativeModule<ScreenCaptureNative>('ExpoScreenCapture');
const keepAwake = requireOptionalNativeModule<KeepAwakeNative>('ExpoKeepAwake');
const deviceKey = requireOptionalNativeModule<DeviceKeyPrivacyNative>('GeneratorAIDeviceKey');

export const REDACT_FLAG = 'privacy.redact';
/** The blur behind the app switcher (06 §6.2). */
export const APP_SWITCHER_BLUR = 0.6;

const ignore = (): void => undefined;

// ── Screen capture keys ─────────────────────────────────────────

const captureKeys = new Set<string>();

function preventCapture(key: string): void {
  if (captureKeys.has(key)) return;
  captureKeys.add(key);
  if (captureKeys.size === 1) void screenCapture?.preventScreenCapture?.().catch(ignore);
}

function allowCapture(key: string): void {
  if (!captureKeys.delete(key)) return;
  if (captureKeys.size === 0) void screenCapture?.allowScreenCapture?.().catch(ignore);
}

// ── App switcher / Recents ──────────────────────────────────────

const SWITCHER_KEY = 'app-switcher';

/** Hide content in the app switcher (iOS) / Recents (Android). The privacy overlay in AppLock.tsx stays on top. */
export function setAppSwitcherPrivacy(enabled: boolean): void {
  if (Platform.OS === 'ios') {
    const call = enabled ? screenCapture?.enableAppSwitcherProtection?.(APP_SWITCHER_BLUR) : screenCapture?.disableAppSwitcherProtection?.();
    void call?.catch(ignore);
    return;
  }
  if (Platform.OS !== 'android') return;
  try {
    deviceKey?.setRecentsScreenshotEnabled?.(!enabled);
  } catch {
    // Below API 33 or a dev client without the module: FLAG_SECURE alone covers it.
  }
  // FLAG_SECURE as well, on every version: setRecentsScreenshotEnabled(false) only blanks the stored snapshot, and
  // opening Recents straight from the app shows the launcher's live tile — the real screen (seen on the API 36
  // emulator). FLAG_SECURE blanks both, at the cost of blocking screenshots while the choice is on (MD-198).
  if (enabled) preventCapture(SWITCHER_KEY);
  else allowCapture(SWITCHER_KEY);
}

// ── Secret reveals ──────────────────────────────────────────────

let revealCount = 0;

/**
 * While `active`: no screenshots or recordings of the screen, and the device does not auto-lock (06 §6.2; the
 * webhook token reveal, the pairing code). Released on unmount.
 */
export function useSecretReveal(active: boolean): void {
  useEffect(() => {
    if (!active || Platform.OS === 'web') return;
    const key = `reveal-${++revealCount}`;
    preventCapture(key);
    void keepAwake?.activate?.(key).catch(ignore);
    return () => {
      allowCapture(key);
      void keepAwake?.deactivate?.(key).catch(ignore);
    };
  }, [active]);
}

// ── Notification previews (iOS) ─────────────────────────────────

/**
 * The notification service extension (targets/notification-service) reads the App Group flag `privacy.redact` and,
 * when it is set, replaces each push's title and body with its lock-screen-safe `data.redacted`. Written through
 * @bacons/apple-targets' `ExtensionStorage` module (UserDefaults of the group). Android needs no flag: every channel
 * is PRIVATE, so a secure lock screen shows the redacted public version.
 */
export function setNotificationPreviewRedaction(enabled: boolean): void {
  if (Platform.OS !== 'ios') return;
  // No App Group in this build: the system "Show Previews" setting still applies.
  setAppGroupInt(REDACT_FLAG, enabled ? 1 : 0);
}
