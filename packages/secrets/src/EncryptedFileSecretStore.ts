// ────────────────────────────────────────────────────────────────
// EncryptedFileSecretStore — AEAD-protected vault on the local filesystem
//
// Format (single JSON file, atomically rewritten):
//
//   {
//     "v": 1,
//     "kekVersion": 1,
//     "entries": {
//       "<namespace>/<name>": {
//         "v": 1,
//         "kv": 1,
//         "iv": "<base64 12 bytes>",
//         "ct": "<base64 ciphertext>",
//         "tag": "<base64 16 bytes>"
//       }
//     }
//   }
//
// - Each entry is sealed with AES-256-GCM under a per-entry data key derived
//   from the KEK via HKDF-SHA-256 (`info = v|kekVersion|namespace|name`), so a
//   single (key, iv) pair is never reused across entries.
// - The AAD binds namespace + name + versions, so an attacker with write
//   access to the vault cannot move a ciphertext from one slot to another.
// - Namespaces and names are NOT secrets and remain in plaintext so `list()`
//   is cheap; values never appear outside the AEAD envelope.
// - Integrity failures throw `SecretStoreError('INTEGRITY')` — fail closed.
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SecretStoreError,
  type SecretBackendInfo,
  type SecretStore,
} from './SecretStore.js';
import { writeFileAtomicRestricted, type KeyProvider } from './KeyProvider.js';

const VAULT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

interface SealedEntry {
  v: number;
  kv: number;
  iv: string;
  ct: string;
  tag: string;
}

interface VaultFile {
  v: number;
  kekVersion: number;
  entries: Record<string, SealedEntry>;
}

export interface EncryptedFileSecretStoreOptions {
  /** Absolute path to the vault JSON file. */
  vaultPath: string;
  keyProvider: KeyProvider;
}

export class EncryptedFileSecretStore implements SecretStore {
  private readonly vaultPath: string;
  private readonly keyProvider: KeyProvider;
  private vault: VaultFile | null = null;
  /** Serializes read-modify-write cycles so concurrent `set()` calls cannot lose entries. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(options: EncryptedFileSecretStoreOptions) {
    this.vaultPath = options.vaultPath;
    this.keyProvider = options.keyProvider;
  }

  async get(namespace: string, name: string): Promise<Uint8Array | null> {
    const vault = this.load();
    const entry = vault.entries[key(namespace, name)];
    if (!entry) return null;
    const kek = await this.keyProvider.getKey();
    return open(entry, kek, namespace, name);
  }

  async set(namespace: string, name: string, value: Uint8Array): Promise<void> {
    await this.mutate((vault, kek) => {
      vault.entries[key(namespace, name)] = seal(value, kek, vault.kekVersion, namespace, name);
    });
  }

  async create(namespace: string, name: string, value: Uint8Array): Promise<void> {
    await this.mutate((vault, kek) => {
      if (vault.entries[key(namespace, name)]) {
        throw new SecretStoreError(`Secret ${namespace}/${name} already exists`, 'ALREADY_EXISTS');
      }
      vault.entries[key(namespace, name)] = seal(value, kek, vault.kekVersion, namespace, name);
    });
  }

  async remove(namespace: string, name: string): Promise<void> {
    await this.mutate((vault) => {
      delete vault.entries[key(namespace, name)];
    });
  }

  async removeNamespace(namespace: string): Promise<void> {
    const prefix = `${namespace}/`;
    await this.mutate((vault) => {
      for (const k of Object.keys(vault.entries)) {
        if (k.startsWith(prefix)) delete vault.entries[k];
      }
    });
  }

  async list(namespace: string): Promise<string[]> {
    const prefix = `${namespace}/`;
    return Object.keys(this.load().entries)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
      .sort();
  }

  async getOrCreateRandom(namespace: string, name: string, bytes: number): Promise<Uint8Array> {
    let result: Uint8Array | null = null;
    await this.mutate((vault, kek) => {
      const existing = vault.entries[key(namespace, name)];
      if (existing) {
        result = open(existing, kek, namespace, name);
        return;
      }
      const fresh = crypto.randomBytes(bytes);
      vault.entries[key(namespace, name)] = seal(fresh, kek, vault.kekVersion, namespace, name);
      result = new Uint8Array(fresh);
    });
    /* c8 ignore next */
    if (!result) throw new SecretStoreError('getOrCreateRandom produced no value', 'IO');
    return result;
  }

  async backendInfo(): Promise<SecretBackendInfo> {
    const info = this.keyProvider.info();
    return {
      kind: `encrypted-file/${info.kind}`,
      secure: info.secure,
      ...(info.reason ? { reason: info.reason } : {}),
      supportsRotation: typeof this.keyProvider.rotateKey === 'function',
      location: this.vaultPath,
    };
  }

  /**
   * Re-encrypts every entry under a fresh KEK. The vault is rewritten
   * atomically, so an interrupted rotation leaves the previous generation
   * fully intact rather than a half-rotated file.
   */
  async rotate(): Promise<void> {
    if (!this.keyProvider.rotateKey) {
      throw new SecretStoreError('Key provider does not support rotation', 'BACKEND_UNAVAILABLE');
    }
    await this.enqueue(async () => {
      const vault = this.load();
      const oldKek = await this.keyProvider.getKey();
      const plaintext = new Map<string, { ns: string; name: string; value: Uint8Array }>();
      for (const [entryKey, entry] of Object.entries(vault.entries)) {
        const { ns, name } = splitKey(entryKey);
        plaintext.set(entryKey, { ns, name, value: open(entry, oldKek, ns, name) });
      }
      const newKek = await this.keyProvider.rotateKey!();
      const next: VaultFile = { v: VAULT_VERSION, kekVersion: vault.kekVersion + 1, entries: {} };
      for (const [entryKey, { ns, name, value }] of plaintext) {
        next.entries[entryKey] = seal(value, newKek, next.kekVersion, ns, name);
      }
      this.persist(next);
    });
  }

  // ── internals ────────────────────────────────────────────────

  private load(): VaultFile {
    if (this.vault) return this.vault;
    if (!fs.existsSync(this.vaultPath)) {
      this.vault = { v: VAULT_VERSION, kekVersion: 1, entries: {} };
      return this.vault;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.vaultPath, 'utf8'));
    } catch (err) {
      throw new SecretStoreError(
        `Secret vault at ${this.vaultPath} is unreadable or corrupt`,
        'INTEGRITY',
        { cause: err },
      );
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as VaultFile).v !== VAULT_VERSION ||
      typeof (parsed as VaultFile).entries !== 'object'
    ) {
      throw new SecretStoreError(
        `Secret vault at ${this.vaultPath} has an unsupported format`,
        'INTEGRITY',
      );
    }
    const vault = parsed as VaultFile;
    vault.kekVersion = typeof vault.kekVersion === 'number' ? vault.kekVersion : 1;
    this.vault = vault;
    return vault;
  }

  private persist(vault: VaultFile): void {
    fs.mkdirSync(path.dirname(this.vaultPath), { recursive: true });
    writeFileAtomicRestricted(this.vaultPath, JSON.stringify(vault, null, 2));
    this.vault = vault;
  }

  private async mutate(fn: (vault: VaultFile, kek: Buffer) => void): Promise<void> {
    await this.enqueue(async () => {
      const kek = await this.keyProvider.getKey();
      // Re-read from disk each cycle: another process (desktop shell + server)
      // may own the same vault.
      this.vault = null;
      const vault = this.load();
      const next: VaultFile = {
        v: vault.v,
        kekVersion: vault.kekVersion,
        entries: { ...vault.entries },
      };
      fn(next, kek);
      this.persist(next);
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    // Keep the chain alive even when a caller's promise rejects.
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function key(namespace: string, name: string): string {
  if (namespace.includes('\u0000') || name.includes('\u0000') || name.includes('/')) {
    throw new SecretStoreError('Invalid secret namespace/name', 'IO');
  }
  return `${namespace}/${name}`;
}

function splitKey(entryKey: string): { ns: string; name: string } {
  const idx = entryKey.lastIndexOf('/');
  return { ns: entryKey.slice(0, idx), name: entryKey.slice(idx + 1) };
}

/** HKDF-SHA-256 derivation so each entry gets an independent AES key. */
function deriveEntryKey(kek: Buffer, kekVersion: number, namespace: string, name: string): Buffer {
  const info = Buffer.from(`generatorai/secret/v${VAULT_VERSION}/k${kekVersion}/${namespace}/${name}`, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', kek, Buffer.alloc(0), info, 32));
}

function aad(kekVersion: number, namespace: string, name: string): Buffer {
  return Buffer.from(`${VAULT_VERSION}|${kekVersion}|${namespace}|${name}`, 'utf8');
}

function seal(
  value: Uint8Array,
  kek: Buffer,
  kekVersion: number,
  namespace: string,
  name: string,
): SealedEntry {
  const dek = deriveEntryKey(kek, kekVersion, namespace, name);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(kekVersion, namespace, name));
  const ct = Buffer.concat([cipher.update(Buffer.from(value)), cipher.final()]);
  return {
    v: VAULT_VERSION,
    kv: kekVersion,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function open(entry: SealedEntry, kek: Buffer, namespace: string, name: string): Uint8Array {
  try {
    const dek = deriveEntryKey(kek, entry.kv, namespace, name);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      dek,
      Buffer.from(entry.iv, 'base64'),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(aad(entry.kv, namespace, name));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(entry.ct, 'base64')),
      decipher.final(),
    ]);
    return new Uint8Array(plain);
  } catch (err) {
    // Never include ciphertext or key material in the message.
    throw new SecretStoreError(
      `Secret ${namespace}/${name} failed integrity verification. The vault may have been ` +
        'tampered with, or the key-encryption key changed.',
      'INTEGRITY',
      { cause: err },
    );
  }
}
