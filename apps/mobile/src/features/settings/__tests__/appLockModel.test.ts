import { describe, expect, it } from 'vitest';
import { unlockMethod } from '../model/appLockModel';

const info = (over: Partial<{ hardware: boolean; enrolled: boolean; types: Array<'face' | 'fingerprint' | 'iris'>; passcode: boolean }>) => ({ hardware: true, enrolled: true, types: [], passcode: true, ...over });

describe('unlock method (MDF-115)', () => {
  it('uses the OS noun', () => {
    expect(unlockMethod(info({ types: ['face'] }), 'ios').title).toBe('Require Face ID');
    expect(unlockMethod(info({ types: ['fingerprint'] }), 'ios').noun).toBe('Touch ID');
    expect(unlockMethod(info({ types: ['fingerprint', 'face'] }), 'android').noun).toBe('fingerprint');
    expect(unlockMethod(info({ types: ['face'] }), 'android').noun).toBe('face unlock');
  });
  it('falls back to the passcode, or says the lock cannot work', () => {
    expect(unlockMethod(info({ enrolled: false }), 'ios')).toMatchObject({ title: 'Require passcode', impossible: false });
    expect(unlockMethod(info({ enrolled: false, passcode: false }), 'android')).toMatchObject({ impossible: true });
    expect(unlockMethod(null, 'android').title).toBe('Require fingerprint');
  });
});
