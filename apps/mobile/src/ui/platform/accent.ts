// The System (Material You) accent exists on Android 12+ only (MD-08): accent.android.ts reads it
// through Expo UI. Everywhere else (iOS, Jest, the web preview) it is unavailable, and Expo UI's
// Compose module is never bundled.
import type { SystemAccentSeeds } from './accent.types';

export type { SystemAccentSeeds } from './accent.types';

export const systemAccentAvailable = false;

export function readSystemAccentSeeds(): SystemAccentSeeds | null {
  return null;
}
