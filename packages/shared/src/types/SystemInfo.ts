// ────────────────────────────────────────────────────────────────
// System info (G-12, docs/redesign/05-gap-matrix.md §G-12).
//
// The Home "System" card (Server, Agents max, Database size, Disk
// usage, Uptime, Version) and Settings › Diagnostics. `GET /api/system/info`.
//
// React-free wire types only; web, desktop, CLI and mobile share them.
//
// D-36 / no fake data: `database.sizeBytes` and `disk` are omitted (not `0`)
// when the server could not read them (an unreadable data directory, or a
// platform where `fs.statfs` is not available) — never an invented value.
// ────────────────────────────────────────────────────────────────

export interface SystemInfo {
  /** Friendly host label (`serverDisplayName()`), same as `/api/auth/server-info`. */
  serverName: string;
  /** The server package's own version, read from its nearest `package.json`. `'unknown'` when it cannot be resolved. */
  serverVersion: string;
  /** `process.platform` of the server host — where terminals, editors and Computer Use actually run. */
  platform: string;
  uptimeSec: number;
  agents: {
    /**
     * The configured concurrency cap. How many are running is the attention
     * feed's `counts.running` (`GET /api/attention`), the number Home's
     * Running list shows — one definition, not a second count here.
     */
    max: number;
  };
  database: {
    kind: 'sqlite';
    /** The database file plus its `-wal` and `-shm` files. Absent when it could not be measured. */
    sizeBytes?: number;
  };
  /** Absent when `fs.statfs` failed or is unsupported on this host. */
  disk?: {
    usedBytes: number;
    totalBytes: number;
  };
}
