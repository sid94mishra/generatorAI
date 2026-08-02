// ────────────────────────────────────────────────────────────────
// In-memory replay + nonce stores.
//
// Correct for a single server process. A horizontally scaled deployment must
// swap these for the SQLite/Redis-backed implementations in
// `@generatorai/db` (unique index) so the duplicate barrier is shared.
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import type { INonceStore, IReplayStore } from './ports.js';

/** Bounded LRU-ish replay store. Entries expire; the map is capped. */
export class MemoryReplayStore implements IReplayStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly maxEntries = 50_000) {}

  async register(jtiHash: string, expiresAt: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.seen.get(jtiHash);
    if (existing != null && existing > now) return false;
    if (this.seen.size >= this.maxEntries) await this.purge(now);
    if (this.seen.size >= this.maxEntries) {
      // Nothing expired — drop the oldest insertions rather than growing.
      const keys = [...this.seen.keys()].slice(0, Math.floor(this.maxEntries / 10));
      for (const key of keys) this.seen.delete(key);
    }
    this.seen.set(jtiHash, expiresAt);
    return true;
  }

  async purge(before: number): Promise<number> {
    let removed = 0;
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= before) {
        this.seen.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

export class MemoryNonceStore implements INonceStore {
  private readonly nonces = new Map<string, number>();

  constructor(private readonly maxEntries = 20_000) {}

  async issue(expiresAt: number): Promise<string> {
    if (this.nonces.size >= this.maxEntries) await this.purge(Date.now());
    const nonce = crypto.randomBytes(24).toString('base64url');
    this.nonces.set(nonce, expiresAt);
    return nonce;
  }

  async verify(nonce: string, now: number): Promise<boolean> {
    const expiresAt = this.nonces.get(nonce);
    if (expiresAt == null || expiresAt <= now) return false;
    // Nonces are single-use: consuming prevents an observer from reusing one.
    this.nonces.delete(nonce);
    return true;
  }

  async purge(before: number): Promise<number> {
    let removed = 0;
    for (const [nonce, expiresAt] of this.nonces) {
      if (expiresAt <= before) {
        this.nonces.delete(nonce);
        removed += 1;
      }
    }
    return removed;
  }
}
