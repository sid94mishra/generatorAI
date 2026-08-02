// ────────────────────────────────────────────────────────────────
// Human descriptions of connection and key state.
//
// `TransportStatus` is a discriminated union whose members do NOT share a
// field — `{ state: 'idle' }` has no `kind`, and `{ state: 'offline' }` has
// no endpoint. Reading `.kind` off the union directly does not compile, and
// worse, casting past that is how a screen ends up rendering "undefined".
//
// Pure functions, no React, so every branch is testable.
// ────────────────────────────────────────────────────────────────

import type { TransportStatus } from '@generatorai/client-transport';

import type { KeyBacking } from './stores';

export interface TransportDescription {
  /** One or two words for a badge. */
  label: string;
  /** A sentence explaining what it means for the user. */
  detail: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}

export function describeTransport(status: TransportStatus): TransportDescription {
  switch (status.state) {
    case 'connected':
      return {
        label: status.kind === 'relay' ? 'Relay' : 'Direct',
        detail:
          status.kind === 'relay'
            ? `Through the relay — used when the host is not directly reachable. ${status.endpoint}`
            : `Direct to the host at ${status.endpoint}.`,
        tone: status.kind === 'relay' ? 'warning' : 'success',
      };

    case 'connecting':
      return {
        label: 'Connecting',
        detail: `Trying ${status.kind} (attempt ${status.attempt}).`,
        tone: 'neutral',
      };

    case 'reconnecting':
      return {
        label: 'Reconnecting',
        detail: `Lost the ${status.kind} connection. Retrying (attempt ${status.attempt}).`,
        tone: 'warning',
      };

    case 'offline':
      return { label: 'Offline', detail: status.reason, tone: 'danger' };

    case 'host-mismatch':
      return {
        label: 'Blocked',
        detail:
          'The host presented a different identity key than the one pinned when this device was paired. The connection was refused rather than retried — pair again only if you know why the host changed.',
        tone: 'danger',
      };

    case 'idle':
    default:
      return { label: 'Idle', detail: 'Not connected yet.', tone: 'neutral' };
  }
}

export interface KeyBackingDescription {
  label: string;
  detail: string;
  hardware: boolean;
}

export function describeKeyBacking(backing: KeyBacking): KeyBackingDescription {
  switch (backing) {
    case 'secure-enclave':
      return {
        label: 'Secure Enclave',
        detail: 'The private key never leaves dedicated hardware and cannot be exported.',
        hardware: true,
      };
    case 'strongbox':
      return {
        label: 'StrongBox',
        detail: 'The private key is held in a dedicated tamper-resistant chip.',
        hardware: true,
      };
    case 'keystore':
      return {
        label: 'Hardware keystore',
        detail: 'The private key is held by the OS keystore, backed by hardware.',
        hardware: true,
      };
    case 'software':
      return {
        label: 'Software',
        detail:
          'No hardware keystore is available, so the key is encrypted at rest by the OS instead. Weaker, but still not readable by other apps.',
        hardware: false,
      };
    case 'web-preview':
    default:
      return {
        label: 'Browser storage',
        detail:
          'Development preview only. The key is readable by any script on this origin — do not pair a real host from a browser.',
        hardware: false,
      };
  }
}
