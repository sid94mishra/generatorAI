// ────────────────────────────────────────────────────────────────
// In-memory replay + nonce stores.
//
// Correct for a single server process. A horizontally scaled deployment must
// swap these for the SQLite/Redis-backed implementations in
// `@generatorai/db` (unique index) so the duplicate barrier is shared.
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import type {
  DeviceScopeRequestRecord,
  IDeviceScopeRequestRepository,
  INonceStore,
  IReplayStore,
} from './ports.js';

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

/**
 * In-memory scope-request store for tests and the embedded SDK. Mirrors the
 * SQLite implementation's two invariants: one pending request per device,
 * and `resolve` is a compare-and-set on `status === 'pending'`.
 */
export class MemoryDeviceScopeRequestRepository implements IDeviceScopeRequestRepository {
  private readonly rows = new Map<string, DeviceScopeRequestRecord>();

  async create(record: DeviceScopeRequestRecord): Promise<void> {
    if (record.status === 'pending' && (await this.findPendingByDevice(record.deviceId))) {
      throw new Error('UNIQUE constraint failed: device_scope_requests.device_id (pending)');
    }
    this.rows.set(record.requestId, { ...record, requestedScopes: [...record.requestedScopes] });
  }

  async get(requestId: string): Promise<DeviceScopeRequestRecord | null> {
    const row = this.rows.get(requestId);
    return row ? { ...row } : null;
  }

  async findPendingByDevice(deviceId: string): Promise<DeviceScopeRequestRecord | null> {
    for (const row of this.rows.values()) {
      if (row.deviceId === deviceId && row.status === 'pending') return { ...row };
    }
    return null;
  }

  async listPending(): Promise<DeviceScopeRequestRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({ ...row }));
  }

  async listByDevice(deviceId: string, limit = 20): Promise<DeviceScopeRequestRecord[]> {
    // Newest first; same-millisecond rows fall back to reverse insertion
    // order, the way the SQLite store falls back to rowid.
    return [...this.rows.values()]
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.deviceId === deviceId)
      .sort((a, b) => b.row.createdAt - a.row.createdAt || b.index - a.index)
      .slice(0, limit)
      .map(({ row }) => ({ ...row }));
  }

  async resolve(
    requestId: string,
    patch: Parameters<IDeviceScopeRequestRepository['resolve']>[1],
  ): Promise<boolean> {
    const row = this.rows.get(requestId);
    if (!row || row.status !== 'pending') return false;
    this.rows.set(requestId, { ...row, ...patch });
    return true;
  }
}
