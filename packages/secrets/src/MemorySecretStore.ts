// ────────────────────────────────────────────────────────────────
// MemorySecretStore — non-persistent backend for tests and for the
// `--no-persist` diagnostics mode. Reports `secure: false`.
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import { SecretStoreError, type SecretBackendInfo, type SecretStore } from './SecretStore.js';

export class MemorySecretStore implements SecretStore {
  private readonly entries = new Map<string, Uint8Array>();

  async get(namespace: string, name: string): Promise<Uint8Array | null> {
    const value = this.entries.get(`${namespace}/${name}`);
    return value ? new Uint8Array(value) : null;
  }

  async set(namespace: string, name: string, value: Uint8Array): Promise<void> {
    this.entries.set(`${namespace}/${name}`, new Uint8Array(value));
  }

  async create(namespace: string, name: string, value: Uint8Array): Promise<void> {
    if (this.entries.has(`${namespace}/${name}`)) {
      throw new SecretStoreError(`Secret ${namespace}/${name} already exists`, 'ALREADY_EXISTS');
    }
    await this.set(namespace, name, value);
  }

  async remove(namespace: string, name: string): Promise<void> {
    this.entries.delete(`${namespace}/${name}`);
  }

  async removeNamespace(namespace: string): Promise<void> {
    const prefix = `${namespace}/`;
    for (const k of [...this.entries.keys()]) {
      if (k.startsWith(prefix)) this.entries.delete(k);
    }
  }

  async list(namespace: string): Promise<string[]> {
    const prefix = `${namespace}/`;
    return [...this.entries.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
      .sort();
  }

  async getOrCreateRandom(namespace: string, name: string, bytes: number): Promise<Uint8Array> {
    const existing = await this.get(namespace, name);
    if (existing) return existing;
    const fresh = new Uint8Array(crypto.randomBytes(bytes));
    await this.set(namespace, name, fresh);
    return fresh;
  }

  async backendInfo(): Promise<SecretBackendInfo> {
    return {
      kind: 'memory',
      secure: false,
      reason: 'In-memory secret store — nothing is persisted and nothing is encrypted at rest.',
      supportsRotation: false,
    };
  }
}
