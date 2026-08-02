// ────────────────────────────────────────────────────────────────
// Push token registry.
//
// Stores one push token per paired device. The token is credential-adjacent:
// anyone holding it can put text on the user's lock screen, so it is treated
// like the rest of the device record — never logged, deleted on revoke.
// ────────────────────────────────────────────────────────────────

import type BetterSqlite3 from 'better-sqlite3';

import type { AppDatabase } from '../index.js';

export type PushProvider = 'expo' | 'apns' | 'fcm';

export interface PushTokenRecord {
  deviceId: string;
  provider: PushProvider;
  token: string;
  platform: string;
  createdAt: number;
  updatedAt: number;
  failureCount: number;
  lastError: string | null;
  mutedUntil: number | null;
}

interface Row {
  device_id: string;
  provider: PushProvider;
  token: string;
  platform: string;
  created_at: number;
  updated_at: number;
  failure_count: number;
  last_error: string | null;
  muted_until: number | null;
}

function toRecord(row: Row): PushTokenRecord {
  return {
    deviceId: row.device_id,
    provider: row.provider,
    token: row.token,
    platform: row.platform,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    failureCount: row.failure_count,
    lastError: row.last_error,
    mutedUntil: row.muted_until,
  };
}

/** Consecutive failures after which a token is considered dead and removed. */
export const MAX_PUSH_FAILURES = 5;

export class PushTokenRepository {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase) {
    this.sqlite = (db as unknown as { session: { client: BetterSqlite3.Database } }).session.client;
  }

  /**
   * Register or replace a device's token.
   *
   * Upsert rather than insert: the OS rotates push tokens without warning,
   * and a device re-registering must not accumulate stale rows that then
   * deliver duplicate notifications.
   */
  upsert(input: {
    deviceId: string;
    provider: PushProvider;
    token: string;
    platform: string;
    now: number;
  }): void {
    this.sqlite
      .prepare(
        `INSERT INTO device_push_tokens
           (device_id, provider, token, platform, created_at, updated_at, failure_count, last_error, muted_until)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL)
         ON CONFLICT(device_id) DO UPDATE SET
           provider      = excluded.provider,
           token         = excluded.token,
           platform      = excluded.platform,
           updated_at    = excluded.updated_at,
           -- A fresh registration clears the failure history: the old token
           -- being dead says nothing about the new one.
           failure_count = 0,
           last_error    = NULL`,
      )
      .run(input.deviceId, input.provider, input.token, input.platform, input.now, input.now);
  }

  get(deviceId: string): PushTokenRecord | null {
    const row = this.sqlite
      .prepare(`SELECT * FROM device_push_tokens WHERE device_id = ?`)
      .get(deviceId) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  /** Every registered token — the dispatcher's fan-out set. */
  listAll(): PushTokenRecord[] {
    const rows = this.sqlite
      .prepare(`SELECT * FROM device_push_tokens`)
      .all() as Row[];
    return rows.map(toRecord);
  }

  remove(deviceId: string): void {
    this.sqlite.prepare(`DELETE FROM device_push_tokens WHERE device_id = ?`).run(deviceId);
  }

  /**
   * Record a delivery failure, deleting the token once it is clearly dead.
   *
   * Retrying a rejected token forever wastes quota and can get the whole
   * sender throttled, which would take down notifications for every device.
   */
  recordFailure(deviceId: string, error: string): void {
    this.sqlite
      .prepare(
        `UPDATE device_push_tokens
            SET failure_count = failure_count + 1,
                last_error    = ?
          WHERE device_id = ?`,
      )
      .run(error.slice(0, 500), deviceId);

    this.sqlite
      .prepare(`DELETE FROM device_push_tokens WHERE device_id = ? AND failure_count >= ?`)
      .run(deviceId, MAX_PUSH_FAILURES);
  }

  recordSuccess(deviceId: string): void {
    this.sqlite
      .prepare(
        `UPDATE device_push_tokens
            SET failure_count = 0, last_error = NULL
          WHERE device_id = ? AND failure_count > 0`,
      )
      .run(deviceId);
  }

  setMutedUntil(deviceId: string, mutedUntil: number | null): void {
    this.sqlite
      .prepare(`UPDATE device_push_tokens SET muted_until = ? WHERE device_id = ?`)
      .run(mutedUntil, deviceId);
  }
}
