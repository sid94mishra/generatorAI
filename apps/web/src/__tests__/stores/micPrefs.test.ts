// Resolving a stored microphone choice against what is actually plugged in.
//
// The cases that matter are the ones a user creates by walking away from
// their desk: the headset is gone, or it is back but the browser has minted a
// new id for it. Both must end with dictation recording from SOMETHING.

import { describe, it, expect } from 'vitest';
import { resolveMicDeviceId } from '@/stores/micPrefsStore.js';

const devices = [
  { deviceId: 'built-in-id', label: 'MacBook Pro Microphone' },
  { deviceId: 'headset-id', label: 'Jabra Evolve2 65' },
];

describe('resolveMicDeviceId', () => {
  it('uses the system default when nothing is chosen', () => {
    expect(resolveMicDeviceId(devices, { deviceId: '', deviceLabel: '' })).toBeNull();
  });

  it('uses the chosen device when it is still attached', () => {
    expect(resolveMicDeviceId(devices, { deviceId: 'headset-id', deviceLabel: 'Jabra Evolve2 65' })).toBe(
      'headset-id',
    );
  });

  it('re-finds the same microphone by name after its id changed', () => {
    // Unplug and re-plug a USB headset and Chromium can mint a new deviceId
    // for it. The user's choice is still meaningful, so it is honoured.
    const afterReplug = [devices[0]!, { deviceId: 'headset-id-2', label: 'Jabra Evolve2 65' }];
    expect(resolveMicDeviceId(afterReplug, { deviceId: 'headset-id', deviceLabel: 'Jabra Evolve2 65' })).toBe(
      'headset-id-2',
    );
  });

  it('falls back to the system default when the chosen device is gone', () => {
    // A missing headset must never mean no dictation.
    expect(resolveMicDeviceId([devices[0]!], { deviceId: 'headset-id', deviceLabel: 'Jabra Evolve2 65' })).toBeNull();
  });

  it('does not match a different device that happens to have no label', () => {
    const unlabelled = [{ deviceId: 'other-id', label: '' }];
    expect(resolveMicDeviceId(unlabelled, { deviceId: 'headset-id', deviceLabel: '' })).toBeNull();
  });
});
