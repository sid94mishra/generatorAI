import { describe, expect, it } from 'vitest';

import {
  isRestorePending,
  isStorageUnavailableError,
  nextRestorePhase,
  shouldRetryRestore,
} from '../auth/restoreState';

describe('restore phase', () => {
  it('a storage failure locks instead of settling as unpaired', () => {
    expect(nextRestorePhase('restoring', { type: 'storage-unavailable' })).toBe('locked');
    expect(isRestorePending('locked')).toBe(true);
  });

  it('retries only from locked', () => {
    expect(nextRestorePhase('locked', { type: 'retry' })).toBe('restoring');
    expect(nextRestorePhase('settled', { type: 'retry' })).toBe('settled');
    expect(nextRestorePhase('restoring', { type: 'retry' })).toBe('restoring');
  });

  it('settles from any phase', () => {
    expect(nextRestorePhase('restoring', { type: 'settled' })).toBe('settled');
    expect(nextRestorePhase('locked', { type: 'settled' })).toBe('settled');
    expect(isRestorePending('settled')).toBe(false);
  });

  it('retries when the app becomes active while locked', () => {
    expect(shouldRetryRestore('locked', 'active')).toBe(true);
    expect(shouldRetryRestore('locked', 'background')).toBe(false);
    expect(shouldRetryRestore('locked', 'inactive')).toBe(false);
    expect(shouldRetryRestore('settled', 'active')).toBe(false);
    expect(shouldRetryRestore('restoring', 'active')).toBe(false);
  });
});

describe('isStorageUnavailableError', () => {
  it('recognises keychain / keystore read failures', () => {
    expect(
      isStorageUnavailableError(
        new Error("Calling the 'getValueWithKeyAsync' function has failed → Caused by: User interaction is not allowed."),
      ),
    ).toBe(true);
    expect(isStorageUnavailableError(new Error('errSecInteractionNotAllowed (-25308)'))).toBe(true);
    expect(isStorageUnavailableError(new Error('Could not decrypt the value with the Android Keystore'))).toBe(true);
  });

  it('does not swallow network or credential errors', () => {
    expect(isStorageUnavailableError(new TypeError('Network request failed'))).toBe(false);
    expect(isStorageUnavailableError(new Error('Pairing failed: token expired'))).toBe(false);
    expect(isStorageUnavailableError(null)).toBe(false);
  });
});
