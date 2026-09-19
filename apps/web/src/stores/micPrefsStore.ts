// ────────────────────────────────────────────────────────────────
// micPrefsStore — which microphone dictation records from.
//
// WHY THIS IS A CLIENT PREFERENCE AND NOT A SERVER SETTING
// --------------------------------------------------------
// Every other voice preference lives on the server (see
// apps/server/src/settings/audio.ts) because every one of them decides how
// the SERVER builds a session. This one does not: the microphone is opened
// by the browser, on this machine, and a `deviceId` from one machine is
// meaningless — and in Chromium, not even stable — on another. Storing it
// server-side would mean the desktop app and a phone on the same account
// fought over one value that could only ever be right for one of them.
//
// WHY AN ID AND A LABEL ARE BOTH KEPT
// -----------------------------------
// `deviceId` is the identifier `getUserMedia` needs, but it is re-randomised
// when site data is cleared and is not guaranteed to survive a reboot or a
// re-plug. The label is what the user actually chose ("Jabra Evolve2 65"), so
// when the stored id no longer matches any device the label is used to find
// the same microphone again — the case that matters is unplugging a headset
// and plugging it back in, where a user reasonably expects their choice to
// still be in force.
//
// An empty `deviceId` means "whatever the operating system calls the default
// input", which is the correct default: it follows the OS when the user
// switches headsets there, which is what most people expect to happen.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { globalSingleton } from '../lib/globalSingleton.js';

interface MicPrefsState {
  /** `''` = follow the system default input. */
  deviceId: string;
  /** Human label of the chosen device, for re-matching after a re-plug. */
  deviceLabel: string;
  setDevice: (deviceId: string, deviceLabel: string) => void;
}

const useMicPrefsStoreImpl = create<MicPrefsState>()(
  persist(
    (set) => ({
      deviceId: '',
      deviceLabel: '',
      setDevice: (deviceId, deviceLabel) => set({ deviceId, deviceLabel }),
    }),
    { name: 'generatorai:micPrefs' },
  ),
);

/**
 * Resolve the stored choice against the devices actually attached right now.
 *
 * Returns the id to hand to `getUserMedia`, or `null` for "use the system
 * default". Falls back to the default rather than failing when the chosen
 * device is gone, because a missing headset must not mean no dictation.
 */
export function resolveMicDeviceId(
  // Structurally typed rather than `MediaDeviceInfo[]`, so this is testable
  // without a DOM and callable with the trimmed shape `useAudioInputDevices`
  // exposes.
  devices: readonly { deviceId: string; label: string }[],
  pref: { deviceId: string; deviceLabel: string },
): string | null {
  if (!pref.deviceId) return null;
  if (devices.some((d) => d.deviceId === pref.deviceId)) return pref.deviceId;
  // The id changed but the device is still here under the same name — the
  // usual outcome of unplugging and re-plugging a USB headset.
  if (pref.deviceLabel) {
    const byLabel = devices.find((d) => d.label === pref.deviceLabel);
    if (byLabel) return byLabel.deviceId;
  }
  return null;
}

/** Non-reactive read, for callers outside the React tree. */
export function getMicPref(): { deviceId: string; deviceLabel: string } {
  const { deviceId, deviceLabel } = useMicPrefsStore.getState();
  return { deviceId, deviceLabel };
}

// HMR-split-proof: every module instance shares the first-created store.
export const useMicPrefsStore = globalSingleton('web.micPrefsStore', () => useMicPrefsStoreImpl);
