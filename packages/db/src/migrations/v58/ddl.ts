// ────────────────────────────────────────────────────────────────
// Frozen schema of migration v58 `invocation` (RV-33).
//
// The tables v58 creates or rebuilds, as the DDL it runs. Migration code
// never imports `schema.ts`: this file is the migration's own copy and is
// pinned by `migrations.lock.json` (one of v58's `lockFiles`). Never edit
// it; a later schema change is a new migration.
// ────────────────────────────────────────────────────────────────

/** Files staged for a run before it starts (`POST /workflow-invocations/uploads`, TTL 1 h). Timestamps in ms. */
export const INVOCATION_UPLOADS_DDL = `CREATE TABLE invocation_uploads (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('skills', 'agents', 'prompts')),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  principal_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_by_run_id TEXT
)`;

export const INVOCATION_UPLOADS_INDEXES = [
  `CREATE INDEX idx_invocation_uploads_expires ON invocation_uploads(expires_at)`,
] as const;

/** The idempotency claim remembers WHAT it was claimed for: a replay with another body is a 409. */
export const IDEMPOTENCY_REQUEST_HASH_SQL = `ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT`;

/** `auth_devices` with the `mcp` platform (PD-22: an MCP server pairs as a device). */
export const AUTH_DEVICES_V58_DDL = `CREATE TABLE auth_devices_v58 (
          device_id                       TEXT PRIMARY KEY,
          owner_id                        TEXT NOT NULL DEFAULT 'local',
          name                            TEXT NOT NULL,
          platform                        TEXT NOT NULL DEFAULT 'other'
            CHECK(platform IN ('web','desktop','cli','mobile','mcp','other')),
          public_jwk                      TEXT NOT NULL,
          jwk_thumbprint                  TEXT NOT NULL,
          scopes                          TEXT NOT NULL DEFAULT '[]',
          created_at                      INTEGER NOT NULL,
          last_seen_at                    INTEGER,
          last_seen_transport             TEXT,
          revoked_at                      INTEGER,
          revoked_reason                  TEXT,
          credential_version              INTEGER NOT NULL DEFAULT 1,
          previous_credential_grace_until INTEGER,
          connection_mode                 TEXT NOT NULL DEFAULT 'auto',
          relay_binding                   TEXT
        )`;

export const AUTH_DEVICES_V58_COLUMNS = [
  'device_id',
  'owner_id',
  'name',
  'platform',
  'public_jwk',
  'jwk_thumbprint',
  'scopes',
  'created_at',
  'last_seen_at',
  'last_seen_transport',
  'revoked_at',
  'revoked_reason',
  'credential_version',
  'previous_credential_grace_until',
  'connection_mode',
  'relay_binding',
] as const;

export const AUTH_DEVICES_V58_INDEXES = [
  `CREATE UNIQUE INDEX idx_auth_devices_thumbprint_active
           ON auth_devices(jwk_thumbprint) WHERE revoked_at IS NULL`,
  `CREATE INDEX idx_auth_devices_owner ON auth_devices(owner_id, created_at)`,
] as const;
