// ────────────────────────────────────────────────────────────────
// Node storage adapters (CLI, Electron main, headless clients).
//
// Node's WebCrypto cannot store a non-extractable key durably across process
// restarts, so the CLI must persist key material. It is therefore written
// through a `SecretSink` — the CLI supplies an OS-vault-backed implementation
// so the private key never lands in a plaintext config file.
// ────────────────────────────────────────────────────────────────

import {
  deviceKeyFromCryptoKeyPair,
  generateDeviceKeyPair,
  jwkThumbprint,
  base64url,
  utf8,
  type DeviceKey,
  type DeviceKeyStore,
  type PublicJwk,
} from './deviceKey.js';
import type { SessionStore, StoredSession } from './AuthenticatedClientRuntime.js';

/**
 * Minimal key/value sink the Node stores persist through. The CLI backs this
 * with `@generatorai/secrets`, so nothing here ever touches the filesystem
 * directly.
 */
export interface SecretSink {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

const DEVICE_KEY_NAME = 'device-private-key-jwk';
const SESSION_NAME = 'session';

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error('WebCrypto is unavailable in this Node runtime');
  return c.subtle;
}

export class SecretSinkDeviceKeyStore implements DeviceKeyStore {
  constructor(private readonly sink: SecretSink) {}

  async load(): Promise<DeviceKey | null> {
    const raw = await this.sink.get(DEVICE_KEY_NAME);
    if (!raw) return null;
    try {
      const jwk = JSON.parse(raw) as JsonWebKey;
      const privateKey = await subtle().importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      );
      const publicJwk: PublicJwk = {
        kty: 'EC',
        crv: 'P-256',
        x: String(jwk.x),
        y: String(jwk.y),
      };
      return {
        publicJwk,
        thumbprint: await jwkThumbprint(publicJwk),
        async sign(data: Uint8Array): Promise<Uint8Array> {
          const sig = await subtle().sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            privateKey,
            data as unknown as ArrayBuffer,
          );
          return new Uint8Array(sig);
        },
      };
    } catch {
      // Corrupt or unreadable key material — treat as "not paired" rather
      // than crashing the CLI on every command.
      return null;
    }
  }

  async create(): Promise<DeviceKey> {
    // Extractable here is unavoidable: the key must survive process exit and
    // Node cannot persist a CryptoKey handle. It is written straight into the
    // OS secret vault, never a config file.
    const pair = await generateDeviceKeyPair(true);
    const jwk = (await subtle().exportKey('jwk', pair.privateKey)) as JsonWebKey;
    await this.sink.set(DEVICE_KEY_NAME, JSON.stringify(jwk));
    return deviceKeyFromCryptoKeyPair(pair);
  }

  async clear(): Promise<void> {
    await this.sink.remove(DEVICE_KEY_NAME);
  }
}

export class SecretSinkSessionStore implements SessionStore {
  constructor(private readonly sink: SecretSink) {}

  async load(): Promise<StoredSession | null> {
    const raw = await this.sink.get(SESSION_NAME);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredSession;
      if (!parsed.deviceId || !parsed.resumeSecret || !parsed.endpoint) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async save(session: StoredSession): Promise<void> {
    await this.sink.set(SESSION_NAME, JSON.stringify(session));
  }

  async clear(): Promise<void> {
    await this.sink.remove(SESSION_NAME);
  }
}

/** In-memory stores — tests and ephemeral one-shot clients. */
export class MemoryDeviceKeyStore implements DeviceKeyStore {
  private key: DeviceKey | null = null;

  async load(): Promise<DeviceKey | null> {
    return this.key;
  }

  async create(): Promise<DeviceKey> {
    const pair = await generateDeviceKeyPair(false);
    this.key = await deviceKeyFromCryptoKeyPair(pair);
    return this.key;
  }

  async clear(): Promise<void> {
    this.key = null;
  }
}

export class MemorySessionStore implements SessionStore {
  private session: StoredSession | null = null;

  async load(): Promise<StoredSession | null> {
    return this.session;
  }

  async save(session: StoredSession): Promise<void> {
    this.session = session;
  }

  async clear(): Promise<void> {
    this.session = null;
  }
}

export { base64url, utf8 };
