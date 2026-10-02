// Platform nouns (03 §1.1): copy that names an OS feature uses the OS's own word.
import { nativePlatform, type NativePlatform } from './geometry';

export interface PlatformNouns {
  biometric: string;
  thisDevice: string;
  liveActivities: string;
  quickControls: string;
}

export const NOUNS: Record<NativePlatform, PlatformNouns> = {
  ios: { biometric: 'Face ID', thisDevice: 'This iPhone', liveActivities: 'Live Activities', quickControls: 'Control Center' },
  android: { biometric: 'fingerprint', thisDevice: 'This phone', liveActivities: 'Live Updates', quickControls: 'Quick Settings' },
};

export function nouns(): PlatformNouns {
  return NOUNS[nativePlatform];
}
