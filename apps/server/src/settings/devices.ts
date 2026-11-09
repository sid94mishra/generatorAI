// ────────────────────────────────────────────────────────────────
// Settings › Mobile devices (docs/devices DV-9): "may agents and the Devices
// tab use the mobile devices on this computer?", plus the Android SDK path
// when it is not in a standard place.
//
// Modelled on `computerUse.ts`, but ON by default: the devices are test
// devices the user installed for mobile work (simulators, emulators), a phone
// is never driven without its own per-chat switch (DV-8), and nothing runs
// until a device is opened.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const STATE_FILE = 'mobile-devices.json';

export interface DevicePreferences {
  enabled: boolean;
  /** Android SDK root; empty = auto-detect. */
  androidSdkPath: string;
}

export const DEFAULT_DEVICE_PREFERENCES: DevicePreferences = { enabled: true, androidSdkPath: '' };

function stateFilePath(dataDir: string): string {
  return path.join(dataDir, STATE_FILE);
}

/** Unreadable or malformed state resolves to the defaults. */
export async function readDevicePreferences(dataDir: string): Promise<DevicePreferences> {
  try {
    const parsed = JSON.parse(await fs.readFile(stateFilePath(dataDir), 'utf8')) as Partial<DevicePreferences> | null;
    return {
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : DEFAULT_DEVICE_PREFERENCES.enabled,
      androidSdkPath: typeof parsed?.androidSdkPath === 'string' ? parsed.androidSdkPath : '',
    };
  } catch {
    return { ...DEFAULT_DEVICE_PREFERENCES };
  }
}

export async function writeDevicePreferences(dataDir: string, prefs: DevicePreferences): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(stateFilePath(dataDir), `${JSON.stringify({ ...prefs, updatedAt: Date.now() }, null, 2)}\n`, { mode: 0o600 });
}
