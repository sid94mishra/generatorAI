// Privacy switches that reach outside the JS app (06 §6.2, §6.5; MD-33, MD-92). The only caller of these native APIs.
//
// Notification previews (iOS): the notification service extension (targets/notification-service) reads the App
// Group flag `privacy.redact` and, when it is set, replaces each push's title and body with its lock-screen-safe
// `data.redacted`. The flag is written through @bacons/apple-targets' native `ExtensionStorage` module (UserDefaults
// of the group: `setInt(key, value, suiteName)`); a build without it (Expo Go, an old dev client) makes this a no-op.
// Android needs no flag: every channel is PRIVATE, so a secure lock screen shows the redacted public version.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

interface ExtensionStorageNative {
  setInt?: (key: string, value: number, suiteName: string) => void;
}

const extensionStorage = requireOptionalNativeModule<ExtensionStorageNative>('ExtensionStorage');

/** Shared with the extension targets and the widgets (06 §7.9). */
export const APP_GROUP = 'group.dev.generatorai.app';
export const REDACT_FLAG = 'privacy.redact';

export function setNotificationPreviewRedaction(enabled: boolean): void {
  if (Platform.OS !== 'ios') return;
  try {
    extensionStorage?.setInt?.(REDACT_FLAG, enabled ? 1 : 0, APP_GROUP);
  } catch {
    // No App Group in this build: the system "Show Previews" setting still applies.
  }
}
