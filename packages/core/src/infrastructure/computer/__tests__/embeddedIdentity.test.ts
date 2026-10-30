import { describe, expect, it } from 'vitest';
import { embeddedIdentity } from '../CuaDriverBridge.js';

describe('embeddedIdentity (U-68)', () => {
  const fail = { name: 'bundle_identity', status: 'fail' as const, message: 'Process has no CFBundleIdentifier.' };

  it('reports the embedded driver missing its own bundle id as informational on macOS', () => {
    expect(embeddedIdentity(fail, 'darwin')).toMatchObject({ name: 'bundle_identity', status: 'skip' });
  });

  it('leaves every other check, and other platforms, alone', () => {
    const ax = { name: 'tcc_accessibility', status: 'fail' as const, message: 'Accessibility is NOT granted.' };
    expect(embeddedIdentity(ax, 'darwin')).toBe(ax);
    expect(embeddedIdentity(fail, 'linux')).toBe(fail);
  });
});
