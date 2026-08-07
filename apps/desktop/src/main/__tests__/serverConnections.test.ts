// The shell must never end up pointing at a server the user cannot see or
// change — a bad state here means a window that loads nothing, with no UI to
// fix it. These tests pin the fail-toward-embedded behaviour.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONNECTION_STATE,
  activateConnection,
  activateEmbedded,
  activeConnection,
  addConnection,
  normalizeServerUrl,
  removeConnection,
  resolveTarget,
  sanitizeConnectionState,
} from '../serverConnections';

describe('normalizeServerUrl', () => {
  it('accepts a bare host:port, assuming http', () => {
    // This is the shape people copy off the Network access card.
    expect(normalizeServerUrl('192.168.0.107:3100')).toBe('http://192.168.0.107:3100');
  });

  it('preserves an explicit scheme and drops a trailing slash', () => {
    expect(normalizeServerUrl('https://studio.example:3100/')).toBe('https://studio.example:3100');
  });

  it('rejects anything carrying more than an origin', () => {
    // Loading a different URL than the one typed is how you pair with the
    // wrong server without noticing.
    expect(normalizeServerUrl('http://host:3100/some/path')).toBeNull();
    expect(normalizeServerUrl('http://user:pw@host:3100')).toBeNull();
    expect(normalizeServerUrl('http://host:3100?x=1')).toBeNull();
  });

  it('rejects junk', () => {
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('   ')).toBeNull();
    expect(normalizeServerUrl('ftp://host')).toBeNull();
  });
});

describe('sanitizeConnectionState', () => {
  it('defaults to embedded for absent or corrupt state', () => {
    for (const input of [undefined, null, {}, 'nonsense', 42, []]) {
      expect(sanitizeConnectionState(input).serverMode).toBe('embedded');
    }
  });

  it('refuses remote mode when the active connection is missing', () => {
    const state = sanitizeConnectionState({
      serverMode: 'remote',
      connections: [],
      activeConnectionId: 'gone',
    });
    expect(state.serverMode).toBe('embedded');
    expect(state.activeConnectionId).toBeNull();
  });

  it('drops malformed entries but keeps the good ones', () => {
    const state = sanitizeConnectionState({
      connections: [
        { id: 'a', url: 'http://good:3100', label: 'Good' },
        { id: 'b', url: 'not a url' },
        { id: '', url: 'http://x:1' },
        { url: 'http://no-id:1' },
        { id: 'a', url: 'http://duplicate:1' },
      ],
    });
    expect(state.connections.map((c) => c.id)).toEqual(['a']);
  });

  it('backfills a label from the hostname', () => {
    const state = sanitizeConnectionState({
      connections: [{ id: 'a', url: 'http://studio.local:3100' }],
    });
    expect(state.connections[0]!.label).toBe('studio.local');
  });
});

describe('addConnection', () => {
  it('adds and activates nothing by itself', () => {
    const { state, connection } = addConnection(DEFAULT_CONNECTION_STATE, {
      url: '192.168.0.50:3100',
    });
    expect(connection.url).toBe('http://192.168.0.50:3100');
    expect(state.serverMode).toBe('embedded');
    expect(state.activeConnectionId).toBeNull();
  });

  it('treats the same origin as the same server', () => {
    const first = addConnection(DEFAULT_CONNECTION_STATE, { url: 'http://a:1', label: 'One' });
    const second = addConnection(first.state, { url: 'http://a:1/', label: 'Renamed' });
    expect(second.state.connections).toHaveLength(1);
    expect(second.state.connections[0]!.label).toBe('Renamed');
  });

  it('throws on an unusable address rather than storing it', () => {
    expect(() => addConnection(DEFAULT_CONNECTION_STATE, { url: 'nope://x' })).toThrow();
  });
});

describe('activation', () => {
  const seeded = addConnection(DEFAULT_CONNECTION_STATE, { url: 'http://remote:3100', id: 'r1' }).state;

  it('switches to remote and back', () => {
    const remote = activateConnection(seeded, 'r1');
    expect(remote.serverMode).toBe('remote');
    expect(activeConnection(remote)?.url).toBe('http://remote:3100');

    const back = activateEmbedded(remote);
    expect(back.serverMode).toBe('embedded');
    expect(activeConnection(back)).toBeNull();
  });

  it('ignores an unknown id instead of stranding the window', () => {
    expect(activateConnection(seeded, 'does-not-exist')).toBe(seeded);
  });

  it('falls back to embedded when the active connection is removed', () => {
    const remote = activateConnection(seeded, 'r1');
    const removed = removeConnection(remote, 'r1');
    expect(removed.serverMode).toBe('embedded');
    expect(removed.activeConnectionId).toBeNull();
    expect(removed.connections).toHaveLength(0);
  });

  it('leaves the active selection alone when a different one is removed', () => {
    const two = addConnection(seeded, { url: 'http://other:3100', id: 'r2' }).state;
    const remote = activateConnection(two, 'r1');
    const removed = removeConnection(remote, 'r2');
    expect(removed.activeConnectionId).toBe('r1');
    expect(removed.serverMode).toBe('remote');
  });
});

describe('resolveTarget', () => {
  const remoteState = activateConnection(
    addConnection(DEFAULT_CONNECTION_STATE, { url: 'http://remote:3100', id: 'r1' }).state,
    'r1',
  );

  it('prefers the remote target and needs no local server', () => {
    const target = resolveTarget(remoteState, null);
    expect(target).toEqual({
      url: 'http://remote:3100',
      mode: 'remote',
      needsEmbeddedServer: false,
    });
  });

  it('uses the embedded server when not remote', () => {
    const target = resolveTarget(DEFAULT_CONNECTION_STATE, 'http://127.0.0.1:47821');
    expect(target).toEqual({
      url: 'http://127.0.0.1:47821',
      mode: 'embedded',
      needsEmbeddedServer: true,
    });
  });

  it('returns null when embedded is wanted but not yet up', () => {
    expect(resolveTarget(DEFAULT_CONNECTION_STATE, null)).toBeNull();
  });
});
