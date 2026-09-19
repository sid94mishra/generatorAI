// The window's origin contains the server port, so the port is what decides
// whether the app's localStorage, IndexedDB and paired credential survive a
// restart. These pin the preference order that keeps it stable.

import { describe, expect, it } from 'vitest';
import { preferredPort } from '../ports';

describe('preferredPort', () => {
  it('honours an explicitly configured port above everything', () => {
    expect(preferredPort(3100, 51904)).toBe(3100);
  });

  it('reuses the port from the previous launch when none is configured', () => {
    // Without this the shell asked for port 0 every time, the origin changed,
    // and every per-origin store — the paired device credential included —
    // started empty again.
    expect(preferredPort(0, 51904)).toBe(51904);
  });

  it('falls back to "any free port" on a first run', () => {
    expect(preferredPort(0, null)).toBe(0);
  });

  it('ignores a nonsense configured port and uses the remembered one', () => {
    expect(preferredPort(-1, 51904)).toBe(51904);
    expect(preferredPort(70_000, 51904)).toBe(51904);
  });
});
