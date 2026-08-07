// ────────────────────────────────────────────────────────────────
// Browser storage adapters.
//
// Device key: a NON-EXTRACTABLE `CryptoKeyPair` in IndexedDB. Storing the
// `CryptoKey` object itself (structured-clone) rather than exported bytes is
// the whole point — an XSS can *use* the key while the page is compromised,
// but it can never exfiltrate it, so the attacker loses access the moment the
// device is revoked.
//
// Session: `localStorage` holds the resume credential. That is a deliberate,
// documented trade-off — it is readable by same-origin script, which is why
// the resume credential alone is useless without the non-extractable key.
// ────────────────────────────────────────────────────────────────

import {
  deviceKeyFromCryptoKeyPair,
  generateDeviceKeyPair,
  type DeviceKey,
  type DeviceKeyStore,
} from './deviceKey.js';
import type { SessionStore, StoredSession } from './AuthenticatedClientRuntime.js';

const DB_NAME = 'generatorai-auth';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const KEY_ID = 'device-key';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbDeviceKeyStore implements DeviceKeyStore {
  /**
   * One keypair per server. Sharing a single key across servers would mean a
   * device proving possession of the same key to every host it ever paired
   * with, so revoking it anywhere would break it everywhere — and switching
   * back to a server would silently present the wrong device's credential.
   */
  constructor(private readonly keyId = KEY_ID) {}

  async load(): Promise<DeviceKey | null> {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const pair = await idbRequest<CryptoKeyPair | undefined>(
        tx.objectStore(STORE_NAME).get(this.keyId) as IDBRequest<CryptoKeyPair | undefined>,
      );
      db.close();
      if (!pair?.privateKey || !pair.publicKey) return null;
      return await deviceKeyFromCryptoKeyPair(pair);
    } catch {
      return null;
    }
  }

  async create(): Promise<DeviceKey> {
    const pair = await generateDeviceKeyPair(false);
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await idbRequest(tx.objectStore(STORE_NAME).put(pair, this.keyId) as IDBRequest<IDBValidKey>);
    db.close();
    return deviceKeyFromCryptoKeyPair(pair);
  }

  async clear(): Promise<void> {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      await idbRequest(tx.objectStore(STORE_NAME).delete(this.keyId) as IDBRequest<undefined>);
      db.close();
    } catch {
      // Nothing to clear.
    }
  }
}

const SESSION_KEY = 'generatorai.auth.session';

export class LocalStorageSessionStore implements SessionStore {
  constructor(private readonly storageKey = SESSION_KEY) {}

  async load(): Promise<StoredSession | null> {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredSession;
      // Reject a structurally invalid blob rather than half-restoring it.
      if (!parsed.deviceId || !parsed.resumeSecret || !parsed.endpoint) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async save(session: StoredSession): Promise<void> {
    localStorage.setItem(this.storageKey, JSON.stringify(session));
  }

  async clear(): Promise<void> {
    localStorage.removeItem(this.storageKey);
  }
}
