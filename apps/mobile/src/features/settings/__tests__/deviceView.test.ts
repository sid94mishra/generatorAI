import { describe, expect, it } from 'vitest';
import { keyProtection, platformView, uptimeLabel } from '../model/deviceView';

describe('device view (MSetSecurity, MSetDiagnostics)', () => {
  it('names key protection', () => {
    expect(keyProtection('secure-enclave')).toEqual({ value: 'Hardware', detail: 'Secure Enclave', hardware: true });
    expect(keyProtection('software').hardware).toBe(false);
    expect(keyProtection('web-preview').value).toBe('Not protected');
  });
  it('names platforms and passes unknown ones through', () => {
    expect(platformView('web')).toEqual({ label: 'Browser', icon: 'browser' });
    expect(platformView('toaster').label).toBe('toaster');
    expect(platformView(null).label).toBe('Device');
  });
  it('formats uptime', () => {
    expect(uptimeLabel(3 * 86400 + 4 * 3600)).toBe('3d 4h');
    expect(uptimeLabel(7500)).toBe('2h 5m');
    expect(uptimeLabel(720)).toBe('12m');
  });
});
