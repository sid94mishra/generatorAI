// ────────────────────────────────────────────────────────────────
// Android "System (Material You)" accent source (accent.ts: every other platform) (MD-08, MD-77; mobile 02 §2.5).
//
// The seed is the Material dynamic scheme's `primary` for each appearance,
// read through Expo UI (`getMaterialColors({ scheme })`). Android 12+ only,
// and only when the client carries Expo UI's native module and the device
// reports dynamic colour — a dev client built before M3-08 has no ExpoUI
// module, so the System swatch simply stays hidden (no red box).
// ────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

import type { SystemAccentSeeds } from './accent.types';

export type { SystemAccentSeeds } from './accent.types';

interface MaterialColorsApi {
  isDynamicColorAvailable: boolean;
  getMaterialColors(options: { scheme: 'light' | 'dark' }): { primary: string };
}

function loadMaterialColors(): MaterialColorsApi | null {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return null;
  if (!requireOptionalNativeModule('ExpoUI')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@expo/ui/jetpack-compose') as MaterialColorsApi;
  } catch {
    return null;
  }
}

const material = loadMaterialColors();

/** Whether the Appearance screen offers the System swatch on this device and client. */
export const systemAccentAvailable: boolean = material?.isDynamicColorAvailable === true;

/** `#RRGGBBAA` (Expo UI) → `#rrggbb` (resolveAccentFromSeed takes 3/6 digits; the seed is opaque). */
const opaque = (hex: string): string => hex.slice(0, 7).toLowerCase();

/** The device's current Material You primaries, or null when unavailable. Synchronous. */
export function readSystemAccentSeeds(): SystemAccentSeeds | null {
  if (!material || !systemAccentAvailable) return null;
  try {
    return {
      dark: opaque(material.getMaterialColors({ scheme: 'dark' }).primary),
      light: opaque(material.getMaterialColors({ scheme: 'light' }).primary),
    };
  } catch {
    return null;
  }
}
