// The App Group shared by the app and its extensions (06 §7.9): the notification service extension, the expo-widgets
// target (widgets + Live Activities), the controls target and the share extension. Flags and snapshots only, never
// credentials. Written through @bacons/apple-targets' `ExtensionStorage` module (UserDefaults of the group), looked
// up as an optional native module so a client built without it simply skips the write.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export const APP_GROUP = 'group.dev.generatorai.app';

interface ExtensionStorageNative {
  setInt?: (key: string, value: number, suiteName: string) => void;
  setString?: (key: string, value: string, suiteName: string) => void;
  reloadControls?: (kind?: string) => void;
}

const extensionStorage = Platform.OS === 'ios' ? requireOptionalNativeModule<ExtensionStorageNative>('ExtensionStorage') : null;

/** Write an integer flag to the group (iOS); false when this build has no App Group storage. */
export function setAppGroupInt(key: string, value: number): boolean {
  try {
    if (!extensionStorage?.setInt) return false;
    extensionStorage.setInt(key, value, APP_GROUP);
    return true;
  } catch {
    return false;
  }
}

/** Write a string (JSON) value to the group (iOS); false when this build has no App Group storage. */
export function setAppGroupString(key: string, value: string): boolean {
  try {
    if (!extensionStorage?.setString) return false;
    extensionStorage.setString(key, value, APP_GROUP);
    return true;
  } catch {
    return false;
  }
}

/** Ask Control Center to re-read a control (iOS 18+); a no-op elsewhere. */
export function reloadControls(kind?: string): void {
  try {
    extensionStorage?.reloadControls?.(kind);
  } catch {
    // Older iOS or no module: the control re-reads on its own schedule.
  }
}
