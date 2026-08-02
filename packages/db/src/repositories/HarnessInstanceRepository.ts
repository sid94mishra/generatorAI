// ────────────────────────────────────────────────────────────────
// HarnessInstanceRepository — multiple isolated instances of the SAME
// provider (plan §13.1).
//
// A conversation is owned by an INSTANCE id, not a provider type, so
// `claude-personal` and `claude-work` can run side by side with completely
// separate credentials, config directories and project allow-lists.
//
// `credentialRefs` stores SecretStore pointers (`harness/<id>/oauth`), never
// secret values. `config` is driver-validated JSON and must not contain
// secrets — a check enforced by `scripts/check-secret-boundaries.mjs`.
// ────────────────────────────────────────────────────────────────

import type BetterSqlite3 from 'better-sqlite3';
import type { AppDatabase } from '../index.js';
import { sqliteHandle } from './AuthRepositories.js';

export type PermissionProfile = 'read-only' | 'workspace-write' | 'full-access';

export interface HarnessInstanceRecord {
  instanceId: string;
  driverType: string;
  displayName: string;
  config: Record<string, unknown>;
  /** field name → SecretStore reference string. */
  credentialRefs: Record<string, string>;
  homeDirectory: string | null;
  allowedProjectIds: string[];
  defaultModel: string | null;
  permissionProfile: PermissionProfile;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class SqliteHarnessInstanceRepository {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(db: AppDatabase) {
    this.sqlite = sqliteHandle(db);
  }

  async create(record: HarnessInstanceRecord): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO harness_instances (
           instance_id, driver_type, display_name, config, credential_refs, home_directory,
           allowed_project_ids, default_model, permission_profile, enabled, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        record.instanceId,
        record.driverType,
        record.displayName,
        JSON.stringify(record.config),
        JSON.stringify(record.credentialRefs),
        record.homeDirectory,
        JSON.stringify(record.allowedProjectIds),
        record.defaultModel,
        record.permissionProfile,
        record.enabled ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      );
  }

  async list(): Promise<HarnessInstanceRecord[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM harness_instances ORDER BY created_at ASC`)
      .all() as Array<Record<string, never>>;
    return rows.map((row) => this.toRecord(row));
  }

  async findById(instanceId: string): Promise<HarnessInstanceRecord | null> {
    const row = this.sqlite
      .prepare(`SELECT * FROM harness_instances WHERE instance_id = ?`)
      .get(instanceId) as Record<string, never> | undefined;
    return row ? this.toRecord(row) : null;
  }

  async update(
    instanceId: string,
    patch: Partial<Omit<HarnessInstanceRecord, 'instanceId' | 'createdAt'>>,
  ): Promise<void> {
    const columns: Record<string, string> = {
      driverType: 'driver_type',
      displayName: 'display_name',
      config: 'config',
      credentialRefs: 'credential_refs',
      homeDirectory: 'home_directory',
      allowedProjectIds: 'allowed_project_ids',
      defaultModel: 'default_model',
      permissionProfile: 'permission_profile',
      enabled: 'enabled',
      updatedAt: 'updated_at',
    };
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = columns[key];
      if (!column || value === undefined) continue;
      assignments.push(`${column} = ?`);
      if (key === 'config' || key === 'credentialRefs' || key === 'allowedProjectIds') {
        values.push(JSON.stringify(value));
      } else if (key === 'enabled') {
        values.push(value ? 1 : 0);
      } else {
        values.push(value as never);
      }
    }
    if (assignments.length === 0) return;
    assignments.push('updated_at = ?');
    values.push(Date.now(), instanceId);
    this.sqlite
      .prepare(`UPDATE harness_instances SET ${assignments.join(', ')} WHERE instance_id = ?`)
      .run(...(values as never[]));
  }

  async remove(instanceId: string): Promise<void> {
    this.sqlite.prepare(`DELETE FROM harness_instances WHERE instance_id = ?`).run(instanceId);
  }

  private toRecord(row: Record<string, never>): HarnessInstanceRecord {
    return {
      instanceId: row['instance_id'] as unknown as string,
      driverType: row['driver_type'] as unknown as string,
      displayName: row['display_name'] as unknown as string,
      config: safeJson<Record<string, unknown>>(row['config'] as unknown as string, {}),
      credentialRefs: safeJson<Record<string, string>>(row['credential_refs'] as unknown as string, {}),
      homeDirectory: (row['home_directory'] ?? null) as unknown as string | null,
      allowedProjectIds: safeJson<string[]>(row['allowed_project_ids'] as unknown as string, []),
      defaultModel: (row['default_model'] ?? null) as unknown as string | null,
      permissionProfile: (row['permission_profile'] ?? 'workspace-write') as unknown as PermissionProfile,
      enabled: (row['enabled'] as unknown as number) === 1,
      createdAt: row['created_at'] as unknown as number,
      updatedAt: row['updated_at'] as unknown as number,
    };
  }
}
