// "Restart Server" used to brick the window: the child came back on a new
// random port and nothing reloaded the page. These pin (a) when a status
// change must repoint the window and (b) that a restart asks for the SAME
// port first, so the common case needs no repoint at all.

import { describe, expect, it } from 'vitest';
import { repointTarget } from '../repoint';
import { preferredPort } from '../ports';

describe('repointTarget', () => {
  it('repoints when the embedded server is ready on a new origin', () => {
    expect(repointTarget({ state: 'ready', url: 'http://127.0.0.1:4200' }, 'http://127.0.0.1:3100', 'embedded')).toBe(
      'http://127.0.0.1:4200',
    );
  });

  it('does nothing when the origin is unchanged', () => {
    expect(repointTarget({ state: 'ready', url: 'http://127.0.0.1:3100' }, 'http://127.0.0.1:3100/chats', 'embedded')).toBeNull();
  });

  it('ignores non-ready states (starting, restarting, crashed, stopped)', () => {
    for (const state of ['idle', 'starting', 'restarting', 'crashed', 'stopped'] as const) {
      expect(repointTarget({ state, url: 'http://127.0.0.1:4200' }, 'http://127.0.0.1:3100', 'embedded')).toBeNull();
    }
  });

  it('never touches the window while a remote backend is shown', () => {
    expect(repointTarget({ state: 'ready', url: 'http://127.0.0.1:4200' }, 'https://studio.example', 'remote')).toBeNull();
  });

  it('repoints when the window had no URL yet', () => {
    expect(repointTarget({ state: 'ready', url: 'http://127.0.0.1:4200' }, null, 'embedded')).toBe('http://127.0.0.1:4200');
  });
});

describe('preferredPort', () => {
  it('uses the configured port when valid', () => {
    expect(preferredPort(3100, 4200)).toBe(3100);
  });

  it('reuses the last port across a restart when no port is configured', () => {
    expect(preferredPort(0, 4200)).toBe(4200);
  });

  it('asks for any port on first start', () => {
    expect(preferredPort(0, null)).toBe(0);
  });

  it('treats an invalid configured port as unset instead of passing it on', () => {
    expect(preferredPort(70000, 4200)).toBe(4200);
    expect(preferredPort(-1, null)).toBe(0);
    expect(preferredPort(Number.NaN, null)).toBe(0);
  });
});
