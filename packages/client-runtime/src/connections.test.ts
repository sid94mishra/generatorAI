// The catalog decides which credential is presented to which server, so a bug
// here is either a silent lockout (session stored where nothing looks for it)
// or a credential mix-up between servers. Both are covered below.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeConnection,
  clearConnectionCredentials,
  deviceKeyId,
  hostLabel,
  loadCatalog,
  removeConnection,
  saveCatalog,
  sessionStorageKey,
  upsertConnection,
  type ServerConnection,
} from './connections.js';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

let storage: MemoryStorage;

const SERVER_A = 'aaaaAAAAbbbbBBBBccccCCCCddddDDDDeeeeEEEEfff';
const SERVER_B = 'zzzzZZZZyyyyYYYYxxxxXXXXwwwwWWWWvvvvVVVVuuu';

function connection(overrides: Partial<ServerConnection> = {}): ServerConnection {
  return {
    serverId: SERVER_A,
    label: 'Desk',
    endpoint: 'https://192.168.0.107:5173',
    endpoints: ['https://192.168.0.107:5173'],
    kind: 'remote',
    managed: false,
    lastConnectedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  storage = new MemoryStorage();
});

describe('credential scoping', () => {
  it('gives each server its own storage keys', () => {
    expect(sessionStorageKey(SERVER_A)).not.toBe(sessionStorageKey(SERVER_B));
    expect(deviceKeyId(SERVER_A)).not.toBe(deviceKeyId(SERVER_B));
  });

  it('derives keys deterministically so a session is never stranded', () => {
    expect(sessionStorageKey(SERVER_A)).toBe(sessionStorageKey(SERVER_A));
    expect(deviceKeyId(SERVER_A)).toBe(deviceKeyId(SERVER_A));
  });
});

describe('catalog persistence', () => {
  it('starts empty', () => {
    expect(loadCatalog(storage)).toEqual({ connections: [], activeServerId: null });
  });

  it('round-trips', () => {
    saveCatalog(storage, upsertConnection(loadCatalog(storage), connection()));
    const loaded = loadCatalog(storage);
    expect(loaded.connections).toHaveLength(1);
    expect(loaded.activeServerId).toBe(SERVER_A);
  });

  it('recovers from corrupt storage rather than throwing', () => {
    storage.setItem('generatorai.connections', 'not json');
    expect(loadCatalog(storage).connections).toEqual([]);
  });

  it('drops structurally invalid entries', () => {
    storage.setItem(
      'generatorai.connections',
      JSON.stringify({ connections: [{ label: 'broken' }], activeServerId: 'x' }),
    );
    expect(loadCatalog(storage).connections).toEqual([]);
  });

  it('never leaves the active pointer dangling', () => {
    // Pointing at a server that is not in the list would authenticate the app
    // against nothing while looking connected.
    storage.setItem(
      'generatorai.connections',
      JSON.stringify({ connections: [connection()], activeServerId: 'someone-else' }),
    );
    expect(loadCatalog(storage).activeServerId).toBe(SERVER_A);
  });
});

describe('upsert', () => {
  it('merges a second address into the same server instead of duplicating it', () => {
    let catalog = upsertConnection(loadCatalog(storage), connection());
    catalog = upsertConnection(
      catalog,
      connection({ endpoint: 'http://127.0.0.1:3100', endpoints: ['http://127.0.0.1:3100'] }),
    );

    // Same host reached by a new route — one entry, both routes, no re-pair.
    expect(catalog.connections).toHaveLength(1);
    expect(catalog.connections[0]!.endpoints).toEqual([
      'http://127.0.0.1:3100',
      'https://192.168.0.107:5173',
    ]);
  });

  it('keeps distinct servers separate', () => {
    let catalog = upsertConnection(loadCatalog(storage), connection());
    catalog = upsertConnection(catalog, connection({ serverId: SERVER_B, label: 'Laptop' }));
    expect(catalog.connections).toHaveLength(2);
    expect(catalog.activeServerId).toBe(SERVER_B);
  });

  it('puts the most recently paired server first', () => {
    let catalog = upsertConnection(loadCatalog(storage), connection());
    catalog = upsertConnection(catalog, connection({ serverId: SERVER_B }));
    expect(catalog.connections[0]!.serverId).toBe(SERVER_B);
  });
});

describe('removal', () => {
  it('falls back to another server when the active one is removed', () => {
    let catalog = upsertConnection(loadCatalog(storage), connection());
    catalog = upsertConnection(catalog, connection({ serverId: SERVER_B }));
    const after = removeConnection(catalog, SERVER_B);
    expect(after.activeServerId).toBe(SERVER_A);
  });

  it('goes to null when the last server is removed', () => {
    const catalog = upsertConnection(loadCatalog(storage), connection());
    expect(removeConnection(catalog, SERVER_A).activeServerId).toBeNull();
  });

  it('clears only the removed server credentials', () => {
    storage.setItem(sessionStorageKey(SERVER_A), '{"a":1}');
    storage.setItem(sessionStorageKey(SERVER_B), '{"b":1}');
    clearConnectionCredentials(storage, SERVER_A);
    expect(storage.getItem(sessionStorageKey(SERVER_A))).toBeNull();
    expect(storage.getItem(sessionStorageKey(SERVER_B))).toBe('{"b":1}');
  });
});

describe('legacy migration', () => {
  it('adopts a pre-catalog session instead of logging the user out', () => {
    // Upgrading must not strand an already-paired client on a pairing screen
    // whose code it can no longer mint.
    storage.setItem(
      'generatorai.auth.session',
      JSON.stringify({
        serverId: SERVER_A,
        endpoint: 'https://192.168.0.107:5173',
        endpoints: ['https://192.168.0.107:5173'],
        deviceId: 'd1',
        resumeSecret: 's',
      }),
    );

    const catalog = loadCatalog(storage);
    expect(catalog.activeServerId).toBe(SERVER_A);
    expect(catalog.connections[0]!.label).toBe('192.168.0.107');
    // The session must now also live where the scoped store will look for it.
    expect(storage.getItem(sessionStorageKey(SERVER_A))).toBeTruthy();
  });

  it('leaves the original session in place so a rollback still works', () => {
    const raw = JSON.stringify({
      serverId: SERVER_A,
      endpoint: 'https://host',
      deviceId: 'd1',
      resumeSecret: 's',
    });
    storage.setItem('generatorai.auth.session', raw);
    loadCatalog(storage);
    expect(storage.getItem('generatorai.auth.session')).toBe(raw);
  });

  it('ignores a legacy session with no server identity', () => {
    storage.setItem('generatorai.auth.session', JSON.stringify({ deviceId: 'd1' }));
    expect(loadCatalog(storage).connections).toEqual([]);
  });

  it('does not run once a catalog exists', () => {
    saveCatalog(storage, upsertConnection(loadCatalog(storage), connection({ serverId: SERVER_B })));
    storage.setItem(
      'generatorai.auth.session',
      JSON.stringify({ serverId: SERVER_A, endpoint: 'https://old', deviceId: 'd', resumeSecret: 's' }),
    );
    expect(loadCatalog(storage).connections.map((c) => c.serverId)).toEqual([SERVER_B]);
  });
});

describe('helpers', () => {
  it('labels a connection by hostname', () => {
    expect(hostLabel('https://192.168.0.107:5173')).toBe('192.168.0.107');
    expect(hostLabel('not a url')).toBe('not a url');
  });

  it('resolves the active connection', () => {
    const catalog = upsertConnection(loadCatalog(storage), connection());
    expect(activeConnection(catalog)?.serverId).toBe(SERVER_A);
    expect(activeConnection({ connections: [], activeServerId: null })).toBeNull();
  });
});
