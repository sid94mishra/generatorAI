// ────────────────────────────────────────────────────────────────
// pushStatus — why push notifications are (or are not) working.
//
// `usePushNotifications` used to bail silently when registration could not
// proceed, so a build without an EAS project id looked identical to one whose
// user had simply not been notified yet. The hook now reports each outcome
// here and Settings › Notifications renders it, so "nothing arrives" always
// has a visible reason.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';

export type PushStatus =
  /** The hook has not run yet (or the session is not authenticated). */
  | { kind: 'idle' }
  /** Registration cannot proceed at all on this build/device. */
  | { kind: 'disabled'; reason: 'eas-project-id-missing' | 'web' }
  /** The user has not granted the OS permission (or the token could not be minted). */
  | { kind: 'no-permission' }
  /** The server has push turned off (501). */
  | { kind: 'server-disabled' }
  /** Registration could not reach the server; retried on next foreground. */
  | { kind: 'offline' }
  /** The server rejected the registration. */
  | { kind: 'rejected'; httpStatus: number }
  /** Token registered with the paired server. */
  | { kind: 'registered' };

interface PushStatusStore {
  status: PushStatus;
  /**
   * Bumped whenever a notification preference changes so the hook re-syncs
   * anything derived from the preferences (server mute state).
   */
  preferencesVersion: number;
  setStatus(status: PushStatus): void;
  bumpPreferences(): void;
}

export const usePushStatusStore = create<PushStatusStore>((set) => ({
  status: { kind: 'idle' },
  preferencesVersion: 0,
  setStatus: (status) => set({ status }),
  bumpPreferences: () => set((s) => ({ preferencesVersion: s.preferencesVersion + 1 })),
}));

/** Human-readable explanation for the settings screen. Null when nothing is wrong. */
export function describePushStatus(status: PushStatus): {
  title: string;
  detail: string;
  tone: 'warning' | 'danger' | 'success' | 'neutral';
} | null {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'registered':
      return {
        title: 'Push is registered',
        detail: 'This device can be woken by the server.',
        tone: 'success',
      };
    case 'disabled':
      if (status.reason === 'web') {
        return {
          title: 'Push is unavailable in the web preview',
          detail: 'Install the app on a phone to receive notifications.',
          tone: 'neutral',
        };
      }
      return {
        title: 'Push disabled: EAS project id not configured',
        detail:
          'This build was made without EAS_PROJECT_ID, so it cannot request a push token. ' +
          'Rebuild with EAS_PROJECT_ID set (see apps/mobile/eas.json).',
        tone: 'danger',
      };
    case 'no-permission':
      return {
        title: 'Push token not issued',
        detail: 'The OS permission was declined or the token request failed. Allow notifications above.',
        tone: 'warning',
      };
    case 'server-disabled':
      return {
        title: 'Push is disabled on the server',
        detail: 'The paired server has notifications turned off. Enable them there to be woken.',
        tone: 'warning',
      };
    case 'offline':
      return {
        title: 'Push registration pending',
        detail: 'The server could not be reached. Registration retries the next time the app is opened.',
        tone: 'warning',
      };
    case 'rejected':
      return {
        title: `Push registration rejected (${status.httpStatus})`,
        detail: 'The server refused this device’s token. Check the device’s permissions.',
        tone: 'danger',
      };
  }
}
