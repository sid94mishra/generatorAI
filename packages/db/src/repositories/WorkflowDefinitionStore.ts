// ────────────────────────────────────────────────────────────────
// SqliteWorkflowDefinitionStore — definitions as v2 documents (P01 WP-1.7).
//
// A definition is stored as rows (migration v55): the workflow spec on
// `workflow_definitions.spec` (name, description and project id are
// columns), one `stage_definitions` row per stage (key, name, ordinal and
// position are columns, the rest of the StageSpec is `spec`) and one
// `stage_edges` row per edge, keyed by stage key. `getGraph` reassembles
// the `WorkflowGraph` and parses it; `replaceGraph` writes it back in ONE
// synchronous better-sqlite3 transaction (A-34: no async transaction
// helper around awaits).
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import {
  canonicalGraph,
  type DefinitionListFilter,
  type DefinitionListPage,
  type IWorkflowDefinitionStore,
  type NewDefinition,
  type NewVersion,
  type ReplaceGraphResult,
} from '@generatorai/core';
import { NotFoundError, StorageError, generateId } from '@generatorai/shared';
import {
  WorkflowGraphSchema,
  type DefinitionStatus,
  type VersionKind,
  type WorkflowDefinitionRecord,
  type DefinitionAuthor,
  type WorkflowDefinitionSummary,
  type WorkflowDefinitionVersionRecord,
  type WorkflowDefinitionVersionSummary,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import type { AppDatabase } from '../index.js';

interface DefinitionRow {
  id: string;
  name: string;
  description: string | null;
  project_id: string | null;
  status: DefinitionStatus;
  revision: number;
  current_version_id: string | null;
  archived_at: number | null;
  needs_attention: string | null;
  authored_by: string | null;
  spec: string;
  created_at: number;
  updated_at: number;
}

interface StageRow {
  id: string;
  key: string;
  name: string;
  ordinal: number;
  position_x: number | null;
  position_y: number | null;
  spec: string;
}

interface EdgeRow {
  from_key: string;
  to_key: string;
  edge_on: 'success' | 'failure' | 'completion' | 'always';
  when_expr: string | null;
  handles_failure: number | null;
}

interface VersionRow {
  id: string;
  workflow_definition_id: string;
  version: number;
  content_hash: string;
  kind: VersionKind;
  spec: string;
  created_at: number;
}

/** drizzle `timestamp` columns hold unix seconds. */
const toIso = (sec: number | null): string | null => (sec === null ? null : new Date(sec * 1000).toISOString());
const nowSec = (): number => Math.floor(Date.now() / 1000);

function rawClient(db: AppDatabase): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

function encodeCursor(updatedAt: number, id: string): string {
  return Buffer.from(`${updatedAt}:${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { updatedAt: number; id: string } | undefined {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const at = text.indexOf(':');
  if (at < 1) return undefined;
  const updatedAt = Number(text.slice(0, at));
  return Number.isFinite(updatedAt) ? { updatedAt, id: text.slice(at + 1) } : undefined;
}

export class SqliteWorkflowDefinitionStore implements IWorkflowDefinitionStore {
  private readonly sqlite: Database.Database;

  constructor(db: AppDatabase) {
    this.sqlite = rawClient(db);
  }

  // ── Reads ──

  async list(filter: DefinitionListFilter = {}): Promise<DefinitionListPage> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId === null) where.push('d.project_id IS NULL');
    else if (filter.projectId !== undefined) {
      where.push('d.project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.status) {
      where.push('d.status = ?');
      params.push(filter.status);
    }
    if (!filter.includeArchived) where.push('d.archived_at IS NULL');
    if (filter.q) {
      where.push(`d.name LIKE ? ESCAPE '\\'`);
      params.push(`%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    const cursor = filter.cursor ? decodeCursor(filter.cursor) : undefined;
    if (cursor) {
      where.push('(d.updated_at < ? OR (d.updated_at = ? AND d.id > ?))');
      params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
    const rows = this.sqlite
      .prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM stage_definitions s WHERE s.workflow_definition_id = d.id) AS stage_count
           FROM workflow_definitions d
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY d.updated_at DESC, d.id ASC
          LIMIT ?`,
      )
      .all(...params, limit + 1) as Array<DefinitionRow & { stage_count: number }>;
    const page = rows.slice(0, limit);
    const items: WorkflowDefinitionSummary[] = page.map((r) => {
      let tags: string[] = [];
      try {
        const spec = JSON.parse(r.spec) as { tags?: unknown };
        if (Array.isArray(spec.tags)) tags = spec.tags.filter((t): t is string => typeof t === 'string');
      } catch {
        /* unparseable spec surfaces on GET */
      }
      return {
        id: r.id,
        name: r.name,
        ...(r.description ? { description: r.description } : {}),
        projectId: r.project_id,
        status: r.status,
        revision: r.revision,
        currentVersionId: r.current_version_id,
        tags,
        stageCount: r.stage_count,
        needsAttention: r.needs_attention !== null,
        agentAuthored: r.authored_by !== null,
        archivedAt: toIso(r.archived_at),
        createdAt: toIso(r.created_at)!,
        updatedAt: toIso(r.updated_at)!,
      };
    });
    const last = page.at(-1);
    return rows.length > limit && last ? { items, nextCursor: encodeCursor(last.updated_at, last.id) } : { items };
  }

  async getGraph(id: string): Promise<WorkflowDefinitionRecord> {
    return this.readRecord(id);
  }

  // ── Writes ──

  async insert(def: NewDefinition): Promise<WorkflowDefinitionRecord> {
    const graph = WorkflowGraphSchema.parse(def.graph);
    const now = nowSec();
    this.run(() => {
      const { name, description, projectId, ...rest } = graph.workflow;
      this.sqlite
        .prepare(
          `INSERT INTO workflow_definitions (id, name, description, project_id, status, revision, current_version_id, archived_at, needs_attention, authored_by, spec, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, NULL, ?, ?, ?, ?)`,
        )
        .run(def.id, name, description ?? null, projectId ?? null, def.status, def.authoredBy ? JSON.stringify(def.authoredBy) : null, JSON.stringify(rest), now, now);
      this.writeStagesAndEdges(def.id, graph, now);
    });
    return this.readRecord(def.id);
  }

  async replaceGraph(id: string, input: WorkflowGraph, expectedRevision: number): Promise<ReplaceGraphResult> {
    const graph = WorkflowGraphSchema.parse(input);
    const now = nowSec();
    const ok = this.run(() => {
      const row = this.sqlite.prepare(`SELECT revision FROM workflow_definitions WHERE id = ?`).get(id) as { revision: number } | undefined;
      if (!row) throw new NotFoundError('Workflow definition', id);
      if (row.revision !== expectedRevision) return false;
      const { name, description, projectId, ...rest } = graph.workflow;
      this.sqlite
        .prepare(
          `UPDATE workflow_definitions
              SET name = ?, description = ?, project_id = ?, spec = ?, revision = revision + 1,
                  needs_attention = NULL, updated_at = ?
            WHERE id = ?`,
        )
        .run(name, description ?? null, projectId ?? null, JSON.stringify(rest), now, id);
      this.writeStagesAndEdges(id, graph, now);
      return true;
    });
    const record = this.readRecord(id);
    return ok ? { ok: true, record } : { ok: false, current: record };
  }

  async insertVersion(v: NewVersion): Promise<WorkflowDefinitionVersionRecord> {
    const id = generateId();
    const now = nowSec();
    this.run(() => {
      const { next } = this.sqlite
        .prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM workflow_definition_versions WHERE workflow_definition_id = ?`)
        .get(v.workflowDefinitionId) as { next: number };
      this.sqlite
        .prepare(
          `INSERT INTO workflow_definition_versions (id, workflow_definition_id, version, content_hash, kind, spec, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, v.workflowDefinitionId, next, v.contentHash, v.kind, v.canonical, now);
    });
    return this.getVersion(id);
  }

  async findVersionByHash(
    workflowDefinitionId: string,
    kind: VersionKind,
    contentHash: string,
  ): Promise<WorkflowDefinitionVersionSummary | undefined> {
    const row = this.sqlite
      .prepare(
        `SELECT * FROM workflow_definition_versions
          WHERE workflow_definition_id = ? AND kind = ? AND content_hash = ?
          ORDER BY version DESC LIMIT 1`,
      )
      .get(workflowDefinitionId, kind, contentHash) as VersionRow | undefined;
    return row ? this.versionSummary(row) : undefined;
  }

  async getVersion(versionId: string): Promise<WorkflowDefinitionVersionRecord> {
    const row = this.sqlite.prepare(`SELECT * FROM workflow_definition_versions WHERE id = ?`).get(versionId) as VersionRow | undefined;
    if (!row) throw new NotFoundError('Workflow definition version', versionId);
    return { ...this.versionSummary(row), graph: this.parse(JSON.parse(row.spec), `version ${versionId}`) };
  }

  async listVersions(workflowDefinitionId: string): Promise<WorkflowDefinitionVersionSummary[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM workflow_definition_versions WHERE workflow_definition_id = ? ORDER BY version DESC`)
      .all(workflowDefinitionId) as VersionRow[];
    return rows.map((r) => this.versionSummary(r));
  }

  async markPublished(workflowDefinitionId: string, versionId: string): Promise<WorkflowDefinitionRecord> {
    const changed = this.sqlite
      .prepare(`UPDATE workflow_definitions SET status = 'published', current_version_id = ?, updated_at = ? WHERE id = ?`)
      .run(versionId, nowSec(), workflowDefinitionId).changes;
    if (changed === 0) throw new NotFoundError('Workflow definition', workflowDefinitionId);
    return this.readRecord(workflowDefinitionId);
  }

  async setArchived(workflowDefinitionId: string, archived: boolean): Promise<WorkflowDefinitionRecord> {
    const now = nowSec();
    const changed = this.sqlite
      .prepare(`UPDATE workflow_definitions SET archived_at = ?, updated_at = ? WHERE id = ?`)
      .run(archived ? now : null, now, workflowDefinitionId).changes;
    if (changed === 0) throw new NotFoundError('Workflow definition', workflowDefinitionId);
    return this.readRecord(workflowDefinitionId);
  }

  async delete(workflowDefinitionId: string): Promise<void> {
    this.run(() => {
      // Explicit child deletes: the FKs cascade, but a store must not depend
      // on `PRAGMA foreign_keys` being on for its own consistency.
      this.sqlite.prepare(`DELETE FROM stage_edges WHERE workflow_definition_id = ?`).run(workflowDefinitionId);
      this.sqlite.prepare(`DELETE FROM stage_definitions WHERE workflow_definition_id = ?`).run(workflowDefinitionId);
      this.sqlite.prepare(`DELETE FROM workflow_definition_versions WHERE workflow_definition_id = ?`).run(workflowDefinitionId);
      this.sqlite.prepare(`DELETE FROM workflow_definitions WHERE id = ?`).run(workflowDefinitionId);
    });
  }

  async countRuns(workflowDefinitionId: string): Promise<number> {
    return (this.sqlite.prepare(`SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_definition_id = ?`).get(workflowDefinitionId) as { n: number }).n;
  }

  // ── Internals ──

  /** Run `fn` in one IMMEDIATE transaction (or inside the caller's). */
  private run<T>(fn: () => T): T {
    if (this.sqlite.inTransaction) return fn();
    return this.sqlite.transaction(fn).immediate();
  }

  /** Upsert stages by key (a kept key keeps its row id), delete the rest, replace the edges. */
  private writeStagesAndEdges(id: string, graph: WorkflowGraph, now: number): void {
    const existing = new Map(
      (this.sqlite.prepare(`SELECT id, key FROM stage_definitions WHERE workflow_definition_id = ?`).all(id) as Array<{ id: string; key: string }>).map(
        (r) => [r.key, r.id],
      ),
    );
    this.sqlite.prepare(`DELETE FROM stage_edges WHERE workflow_definition_id = ?`).run(id);
    const keep = new Set(graph.stages.map((s) => s.key));
    for (const [key, stageId] of existing) {
      if (!keep.has(key)) this.sqlite.prepare(`DELETE FROM stage_definitions WHERE id = ?`).run(stageId);
    }
    const update = this.sqlite.prepare(
      `UPDATE stage_definitions SET name = ?, ordinal = ?, position_x = ?, position_y = ?, spec = ?, parent_key = ?, kind = ?, updated_at = ? WHERE id = ?`,
    );
    const insert = this.sqlite.prepare(
      `INSERT INTO stage_definitions (id, workflow_definition_id, key, name, ordinal, position_x, position_y, spec, parent_key, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    graph.stages.forEach((stage, ordinal) => {
      const { key, name, position, ...rest } = stage;
      const spec = JSON.stringify(rest);
      const stageId = existing.get(key);
      const parentKey = stage.parentKey ?? null;
      if (stageId) update.run(name, ordinal, position?.x ?? null, position?.y ?? null, spec, parentKey, stage.kind, now, stageId);
      else insert.run(generateId(), id, key, name, ordinal, position?.x ?? null, position?.y ?? null, spec, parentKey, stage.kind, now, now);
    });
    const insertEdge = this.sqlite.prepare(
      `INSERT INTO stage_edges (id, workflow_definition_id, from_key, to_key, edge_on, when_expr, handles_failure, ordinal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    graph.edges.forEach((e, ordinal) => {
      insertEdge.run(
        generateId(),
        id,
        e.from,
        e.to,
        e.on,
        e.when ?? null,
        e.handlesFailure === undefined ? null : e.handlesFailure ? 1 : 0,
        ordinal,
      );
    });
  }

  private readRecord(id: string): WorkflowDefinitionRecord {
    const row = this.sqlite.prepare(`SELECT * FROM workflow_definitions WHERE id = ?`).get(id) as DefinitionRow | undefined;
    if (!row) throw new NotFoundError('Workflow definition', id);
    const stages = this.sqlite
      .prepare(`SELECT id, key, name, ordinal, position_x, position_y, spec FROM stage_definitions WHERE workflow_definition_id = ? ORDER BY ordinal, key`)
      .all(id) as StageRow[];
    const edges = this.sqlite
      .prepare(`SELECT from_key, to_key, edge_on, when_expr, handles_failure FROM stage_edges WHERE workflow_definition_id = ? ORDER BY ordinal, from_key, to_key`)
      .all(id) as EdgeRow[];
    const workflow = {
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      ...JSON.parse(row.spec),
      ...(row.project_id ? { projectId: row.project_id } : {}),
    };
    const graph = this.parse(
      {
        formatVersion: 2,
        workflow,
        stages: stages.map((s) => ({
          ...JSON.parse(s.spec),
          key: s.key,
          name: s.name,
          ...(s.position_x !== null && s.position_y !== null ? { position: { x: s.position_x, y: s.position_y } } : {}),
        })),
        edges: edges.map((e) => ({
          from: e.from_key,
          to: e.to_key,
          on: e.edge_on,
          ...(e.when_expr ? { when: e.when_expr } : {}),
          ...(e.handles_failure !== null ? { handlesFailure: e.handles_failure === 1 } : {}),
        })),
      },
      `definition ${id}`,
    );
    let hasUnpublishedChanges = row.status === 'draft';
    if (row.current_version_id) {
      const current = this.sqlite
        .prepare(`SELECT content_hash FROM workflow_definition_versions WHERE id = ?`)
        .get(row.current_version_id) as { content_hash: string } | undefined;
      hasUnpublishedChanges = current?.content_hash !== canonicalGraph(graph).hash;
    }
    let needsAttention: string[] = [];
    if (row.needs_attention) {
      try {
        const notes = JSON.parse(row.needs_attention) as unknown;
        if (Array.isArray(notes)) needsAttention = notes.map(String);
      } catch {
        needsAttention = [row.needs_attention];
      }
    }
    let authoredBy: DefinitionAuthor | null = null;
    if (row.authored_by) {
      try {
        authoredBy = JSON.parse(row.authored_by) as DefinitionAuthor;
      } catch {
        /* an unreadable author reads as a person's */
      }
    }
    return {
      id: row.id,
      status: row.status,
      revision: row.revision,
      currentVersionId: row.current_version_id,
      hasUnpublishedChanges,
      archivedAt: toIso(row.archived_at),
      needsAttention,
      authoredBy,
      createdAt: toIso(row.created_at)!,
      updatedAt: toIso(row.updated_at)!,
      graph,
    };
  }

  private parse(doc: unknown, what: string): WorkflowGraph {
    const r = WorkflowGraphSchema.safeParse(doc);
    if (!r.success) {
      throw new StorageError(
        `Stored ${what} does not parse as a workflow graph: ${r.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    return r.data;
  }

  private versionSummary(row: VersionRow): WorkflowDefinitionVersionSummary {
    return {
      id: row.id,
      workflowDefinitionId: row.workflow_definition_id,
      version: row.version,
      kind: row.kind,
      contentHash: row.content_hash,
      createdAt: toIso(row.created_at)!,
    };
  }
}
