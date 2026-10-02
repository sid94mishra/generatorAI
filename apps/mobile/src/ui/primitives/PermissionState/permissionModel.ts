// PermissionState copy and action per kind / status (03 MP-35): platform nouns from ui/platform/nouns.
import { nouns } from '../../platform/nouns';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { PermissionKind, PermissionStatus } from './PermissionState.types';

export interface PermissionCopy {
  icon: MobileIconConcept;
  title: string;
  body: string;
  action: { label: string; kind: 'request' | 'settings' } | null;
}

const WHY: Record<PermissionKind, { icon: MobileIconConcept; subject: string; body: string }> = {
  camera: { icon: 'camera', subject: 'the camera', body: 'Scan the QR code on your computer to pair.' },
  microphone: { icon: 'mic', subject: 'the microphone', body: 'Dictate messages to your agents.' },
  notifications: { icon: 'bell', subject: 'notifications', body: 'Know when an agent needs you or a run finishes.' },
  biometrics: { icon: 'lock', subject: '', body: 'Lock GeneratorAI and approve risky actions.' },
  localNetwork: { icon: 'server', subject: 'the local network', body: 'Reach a GeneratorAI server on this network.' },
  scope: { icon: 'shield', subject: '', body: 'Ask an admin of this server for access.' },
  'app-lock': { icon: 'lock', subject: '', body: '' },
};

export function permissionCopy(kind: PermissionKind, status: PermissionStatus, scope?: string): PermissionCopy {
  const why = WHY[kind];
  if (kind === 'app-lock') {
    return { icon: 'lock', title: 'GeneratorAI is locked', body: `Unlock with ${nouns().biometric} to continue.`, action: { label: 'Unlock', kind: 'request' } };
  }
  if (kind === 'scope') {
    return { icon: why.icon, title: scope ? `Requires ${scope}` : 'Requires admin access', body: why.body, action: { label: 'Request access', kind: 'request' } };
  }
  const subject = kind === 'biometrics' ? nouns().biometric : why.subject;
  if (status === 'denied') return { icon: why.icon, title: `${capitalise(subject)} is off for GeneratorAI`, body: why.body, action: { label: 'Open Settings', kind: 'settings' } };
  if (status === 'restricted') return { icon: why.icon, title: `${capitalise(subject)} is restricted on this device`, body: why.body, action: null };
  return { icon: why.icon, title: kind === 'biometrics' ? `Use ${subject}` : `Allow ${subject}`, body: why.body, action: { label: 'Allow', kind: 'request' } };
}

function capitalise(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
