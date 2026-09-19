// ────────────────────────────────────────────────────────────────
// useAudioInputDevices — the microphones this machine can record from.
//
// Three things make this more than a call to `enumerateDevices()`:
//
//   1. LABELS ARE HIDDEN UNTIL PERMISSION IS GRANTED. Before the user has
//      ever allowed the microphone, every device comes back with an empty
//      `label` and a blanked `deviceId`, so a picker built naively on
//      `enumerateDevices` shows a list of nameless entries that cannot be
//      told apart. `requestLabels()` opens and immediately closes a stream
//      purely to earn the names, and is deliberately a USER ACTION rather
//      than something this hook does on mount — a settings screen must not
//      turn on somebody's microphone just because they opened it.
//
//   2. THE LIST CHANGES WHILE THE APP IS OPEN. Plugging in a headset, or
//      unplugging one mid-sentence, fires `devicechange`; without listening
//      for it the picker shows a device that is no longer there and hides
//      one that is.
//
//   3. DEFAULT-DEVICE ENTRIES ARE DUPLICATES. Chromium reports the system
//      default a second time under the reserved id `default` (and, on some
//      platforms, `communications`), which is the same physical microphone
//      listed twice under two names. They are dropped here: "System default"
//      is offered as its own explicit choice by the picker instead, so the
//      list reads as one row per actual microphone.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface UseAudioInputDevices {
  devices: AudioInputDevice[];
  /** True once labels are readable — i.e. mic permission has been granted. */
  labelsVisible: boolean;
  /** Set when enumeration itself failed (no mediaDevices, blocked by policy). */
  error: string | null;
  /** Ask for permission purely to reveal device names. User-initiated only. */
  requestLabels: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** Chromium's synthetic aliases for "whatever the OS default is". */
const ALIAS_IDS = new Set(['default', 'communications']);

export function useAudioInputDevices(): UseAudioInputDevices {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [labelsVisible, setLabelsVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setError('This browser cannot list audio devices.');
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === 'audioinput' && !ALIAS_IDS.has(d.deviceId) && d.deviceId);
      setDevices(inputs.map((d) => ({ deviceId: d.deviceId, label: d.label })));
      // One real device with a name is enough to know permission is granted.
      setLabelsVisible(inputs.some((d) => d.label !== ''));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const requestLabels = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Held open only long enough for the permission to be recorded.
      stream.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone permission was blocked, so device names cannot be shown.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : `Could not read the microphone list: ${(e as Error).message}`,
      );
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.addEventListener) return;
    const onChange = () => void refresh();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refresh]);

  return { devices, labelsVisible, error, requestLabels, refresh };
}
