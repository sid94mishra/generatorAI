// What this device can unlock with (Settings › App lock, MDF-115): the sensor types, whether one is enrolled and
// whether a passcode exists. The screen turns the types into the OS's own noun (Face ID / Touch ID / fingerprint /
// face unlock) with the platform from ui/platform; this module only asks expo-local-authentication.
import { useEffect, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export interface BiometricInfo {
  /** A biometric sensor exists. */
  hardware: boolean;
  /** At least one biometric is enrolled. */
  enrolled: boolean;
  types: ReadonlyArray<'face' | 'fingerprint' | 'iris'>;
  /** A passcode / PIN / pattern is set (security level ≥ secret). */
  passcode: boolean;
}

const UNKNOWN: BiometricInfo = { hardware: false, enrolled: false, types: [], passcode: false };

export async function probeBiometrics(): Promise<BiometricInfo> {
  try {
    const [hardware, enrolled, types, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
    ]);
    const map: Record<number, 'face' | 'fingerprint' | 'iris'> = {
      [LocalAuthentication.AuthenticationType.FINGERPRINT]: 'fingerprint',
      [LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION]: 'face',
      [LocalAuthentication.AuthenticationType.IRIS]: 'iris',
    };
    return { hardware, enrolled, types: types.map((t) => map[t]).filter((t): t is 'face' | 'fingerprint' | 'iris' => Boolean(t)), passcode: level !== LocalAuthentication.SecurityLevel.NONE };
  } catch {
    return UNKNOWN;
  }
}

export function useBiometricInfo(): BiometricInfo | null {
  const [info, setInfo] = useState<BiometricInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void probeBiometrics().then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, []);
  return info;
}
