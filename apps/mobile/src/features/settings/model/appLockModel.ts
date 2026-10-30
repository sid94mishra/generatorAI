// Settings › App lock & privacy (MSetAppLock, MDF-115): the OS's own word for the unlock method — Face ID / Touch ID /
// Optic ID on iOS, fingerprint / face unlock on Android, the passcode when nothing is enrolled — and what the screen
// says about it. Pure.
import type { BiometricInfo } from '../../../services/auth/biometrics';

export interface UnlockMethod {
  /** "Face ID", "fingerprint", "passcode". */
  noun: string;
  /** The row title: "Require Face ID". */
  title: string;
  /** The fallback line under it. */
  fallback: string;
  /** Neither biometrics nor a passcode: the lock cannot work. */
  impossible: boolean;
}

export function unlockMethod(info: BiometricInfo | null, platform: 'ios' | 'android'): UnlockMethod {
  const ios = platform === 'ios';
  const pass = ios ? 'passcode' : 'PIN, pattern or password';
  if (!info) return { noun: ios ? 'Face ID' : 'fingerprint', title: ios ? 'Require Face ID' : 'Require fingerprint', fallback: `${ios ? 'Passcode' : 'PIN or pattern'} as a fallback`, impossible: false };
  if (!info.enrolled) {
    return info.passcode
      ? { noun: pass, title: `Require ${ios ? 'passcode' : 'screen lock'}`, fallback: `No biometrics enrolled: the ${pass} unlocks it`, impossible: false }
      : { noun: pass, title: 'Require unlock', fallback: `Set a ${ios ? 'passcode' : 'screen lock'} on this device to use App lock`, impossible: true };
  }
  const face = info.types.includes('face');
  const finger = info.types.includes('fingerprint');
  const iris = info.types.includes('iris');
  const noun = ios ? (face ? 'Face ID' : finger ? 'Touch ID' : iris ? 'Optic ID' : 'Face ID') : finger ? 'fingerprint' : face ? 'face unlock' : iris ? 'iris' : 'fingerprint';
  return { noun, title: `Require ${noun}`, fallback: `${ios ? 'Passcode' : 'PIN or pattern'} as a fallback`, impossible: false };
}
