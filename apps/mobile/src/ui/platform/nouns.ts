// Platform nouns (03 §1.1): copy that names an OS feature or the device uses the OS's own word — and the right
// device ("iPad", not "phone", on an iPad).
import { Dimensions, Platform } from 'react-native';

import { nativePlatform, type NativePlatform } from './geometry';

export type DeviceKind = 'iPhone' | 'iPad' | 'phone' | 'tablet';

export interface PlatformNouns {
  biometric: string;
  /** "iPhone", "iPad", "phone", "tablet" — for "Pair this iPad". */
  device: DeviceKind;
  /** "This iPhone" / "This iPad" / "This phone" / "This tablet". */
  thisDevice: string;
  liveActivities: string;
  quickControls: string;
  /** Where the OS lets a person allow LAN access for this app (MD-202). */
  localNetworkSetting: string;
}

/** The device noun from the platform and the SCREEN's smaller side (a tablet stays a tablet in a narrow window). */
export function deviceKindFor(platform: NativePlatform, isPad: boolean, screenShortSide: number): DeviceKind {
  if (platform === 'ios') return isPad ? 'iPad' : 'iPhone';
  return screenShortSide >= 600 ? 'tablet' : 'phone';
}

export function nounsFor(platform: NativePlatform, device: DeviceKind): PlatformNouns {
  const base = platform === 'ios'
    ? { biometric: 'Face ID', liveActivities: 'Live Activities', quickControls: 'Control Center', localNetworkSetting: 'Settings › Privacy & Security › Local Network' }
    : { biometric: 'fingerprint', liveActivities: 'Live Updates', quickControls: 'Quick Settings', localNetworkSetting: 'Settings › Apps › GeneratorAI › Permissions › Nearby devices' };
  return { ...base, device, thisDevice: `This ${device}` };
}

export function nouns(): PlatformNouns {
  const screen = Dimensions.get('screen');
  const isPad = Platform.OS === 'ios' && (Platform as { isPad?: boolean }).isPad === true;
  return nounsFor(nativePlatform, deviceKindFor(nativePlatform, isPad, Math.min(screen.width, screen.height)));
}
