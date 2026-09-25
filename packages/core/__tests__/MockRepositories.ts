// ────────────────────────────────────────────────────────────────
// MockRepositories — in-memory implementations of the chat, definition
// store, run and stage-run ports for service-level tests
// ────────────────────────────────────────────────────────────────

import type {
  Chat, ChatStatus, BackgroundTaskStatus,
  WorkflowRun, WorkflowRunStatus,
  StageRun, StageRunStatus,
} from '@generatorai/shared';
import { NotFoundError } from '@generatorai/shared';
import {
  validateWorkflow,
  type VersionKind,
  type WorkflowDefinitionRecord,
  type WorkflowDefinitionSummary,
  type WorkflowDefinitionVersionRecord,
  type WorkflowDefinitionVersionSummary,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import type { IChatRepository } from '../src/domain/ports/IChatRepository.js';
import type {
  DefinitionListFilter,
  DefinitionListPage,
  IWorkflowDefinitionStore,
  NewDefinition,
  NewVersion,
  ReplaceGraphResult,
} from '../src/domain/ports/IWorkflowDefinitionStore.js';
import type { IWorkflowRunRepository } from '../src/domain/ports/IWorkflowRunRepository.js';
import type { IStageRunRepository } from '../src/domain/ports/IStageRunRepository.js';

// ── MockChatRepository ──

export class MockChatRepository implements IChatRepository {
  private store = new Map<string, Chat>();

  async create(chat: Chat): Promise<Chat> {
    this.store.set(chat.id, { ...chat });
    return { ...chat };
  }

  async getById(id: string): Promise<Chat> {
    const chat = this.store.get(id);
    if (!chat) throw new Error(`Chat ${id} not found`);
    return { ...chat };
  }

  async getAll(): Promise<Chat[]> {
    return [...this.store.values()].map((c) => ({ ...c }));
  }

  async getByStatus(status: ChatStatus): Promise<Chat[]> {
    return [...this.store.values()]
      .filter((c) => c.status === status)
      .map((c) => ({ ...c }));
  }
  async countByStatus(status: ChatStatus): Promise<number> {
    return (await this.getByStatus(status)).length;
  }

  async update(id: string, updates: Partial<Chat>): Promise<Chat> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Chat ${id} not found`);
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.store.set(id, updated);
    return { ...updated };
  }

  async updateStatus(id: string, status: ChatStatus): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Chat ${id} not found`);
    existing.status = status;
    existing.updatedAt = new Date();
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  clear(): void {
    this.store.clear();
  }

  async getByProjectId(projectId: string): Promise<Chat[]> {
    return [...this.store.values()].filter((c) => c.projectId === projectId).map((c) => ({ ...c }));
  }

  async listBackgroundTasks(parentChatId: string): Promise<Chat[]> {
    return [...this.store.values()].filter((c) => c.parentChatId === parentChatId).map((c) => ({ ...c }));
  }

  async updateBackgroundTaskStatus(id: string, status: BackgroundTaskStatus): Promise<void> {
    const existing = this.store.get(id);
    if (existing) {
      existing.backgroundTask = { ...(existing.backgroundTask ?? { orchestratorChatId: existing.parentChatId ?? '', taskName: existing.name }), status };
    }
  }

  // ── W24 — orchestrator wave-state persistence (added alongside OrchestratorService tests) ──
  private waveState = new Map<string, { waveCount: number; startedAt: number }>();

  async getOrchestratorWaveState(chatId: string): Promise<{ waveCount: number; startedAt: number } | null> {
    return this.waveState.get(chatId) ?? null;
  }

  async setOrchestratorWaveState(chatId: string, state: { waveCount: number; startedAt: number }): Promise<void> {
    this.waveState.set(chatId, { ...state });
  }

  async clearOrchestratorWaveState(chatId: string): Promise<void> {
    this.waveState.delete(chatId);
  }
}

// ── MockWorkflowDefinitionStore ──
//
// In-memory `IWorkflowDefinitionStore` (P01 WP-1.7): definitions are whole
// v2 graphs, versions are immutable copies. `seedDefinition` is the quick
// way for a service test to get a definition plus a pinned version.

export class MockWorkflowDefinitionStore implements IWorkflowDefinitionStore {
  private readonly defs = new Map<string, WorkflowDefinitionRecord>();
  private readonly versions = new Map<string, WorkflowDefinitionVersionRecord>();
  /** Run counts by definition, for `countRuns` (tests set it directly). */
  readonly runCounts = new Map<string, number>();
  private seq = 0;

  private now(): string {
    return new Date(Date.now() + this.seq++).toISOString();
  }

  private copy(r: WorkflowDefinitionRecord): WorkflowDefinitionRecord {
    return structuredClone(r);
  }

  private must(id: string): WorkflowDefinitionRecord {
    const r = this.defs.get(id);
    if (!r) throw new NotFoundError('Workflow definition', id);
    return r;
  }

  async list(filter: DefinitionListFilter = {}): Promise<DefinitionListPage> {
    const items: WorkflowDefinitionSummary[] = [...this.defs.values()]
      .filter((r) => filter.includeArchived || !r.archivedAt)
      .filter((r) => !filter.status || r.status === filter.status)
      .filter((r) => filter.projectId === undefined || (r.graph.workflow.projectId ?? null) === filter.projectId)
      .filter((r) => !filter.q || r.graph.workflow.name.toLowerCase().includes(filter.q.toLowerCase()))
      .map((r) => ({
        id: r.id,
        name: r.graph.workflow.name,
        ...(r.graph.workflow.description ? { description: r.graph.workflow.description } : {}),
        projectId: r.graph.workflow.projectId ?? null,
        status: r.status,
        revision: r.revision,
        currentVersionId: r.currentVersionId,
        tags: r.graph.workflow.tags,
        stageCount: r.graph.stages.length,
        needsAttention: r.needsAttention.length > 0,
        archivedAt: r.archivedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    return { items };
  }

  async getGraph(id: string): Promise<WorkflowDefinitionRecord> {
    return this.copy(this.must(id));
  }

  async insert(def: NewDefinition): Promise<WorkflowDefinitionRecord> {
    const at = this.now();
    const record: WorkflowDefinitionRecord = {
      id: def.id,
      status: def.status,
      revision: 1,
      currentVersionId: null,
      hasUnpublishedChanges: true,
      archivedAt: null,
      needsAttention: [],
      createdAt: at,
      updatedAt: at,
      graph: structuredClone(def.graph),
    };
    this.defs.set(def.id, record);
    return this.copy(record);
  }

  async replaceGraph(id: string, graph: WorkflowGraph, expectedRevision: number): Promise<ReplaceGraphResult> {
    const r = this.must(id);
    if (r.revision !== expectedRevision) return { ok: false, current: this.copy(r) };
    r.graph = structuredClone(graph);
    r.revision += 1;
    r.needsAttention = [];
    r.updatedAt = this.now();
    r.hasUnpublishedChanges = true;
    return { ok: true, record: this.copy(r) };
  }

  async insertVersion(v: NewVersion): Promise<WorkflowDefinitionVersionRecord> {
    const version = [...this.versions.values()].filter((x) => x.workflowDefinitionId === v.workflowDefinitionId).length + 1;
    const record: WorkflowDefinitionVersionRecord = {
      id: `ver-${v.workflowDefinitionId}-${version}`,
      workflowDefinitionId: v.workflowDefinitionId,
      version,
      kind: v.kind,
      contentHash: v.contentHash,
      createdAt: this.now(),
      graph: structuredClone(v.graph),
    };
    this.versions.set(record.id, record);
    return structuredClone(record);
  }

  async findVersionByHash(workflowDefinitionId: string, kind: VersionKind, contentHash: string) {
    const hit = [...this.versions.values()].find(
      (v) => v.workflowDefinitionId === workflowDefinitionId && v.kind === kind && v.contentHash === contentHash,
    );
    if (!hit) return undefined;
    const { graph: _graph, ...summary } = hit;
    return summary;
  }

  async getVersion(versionId: string): Promise<WorkflowDefinitionVersionRecord> {
    const v = this.versions.get(versionId);
    if (!v) throw new NotFoundError('Definition version', versionId);
    return structuredClone(v);
  }

  async listVersions(workflowDefinitionId: string): Promise<WorkflowDefinitionVersionSummary[]> {
    return [...this.versions.values()]
      .filter((v) => v.workflowDefinitionId === workflowDefinitionId)
      .map(({ graph: _graph, ...summary }) => summary)
      .reverse();
  }

  async markPublished(workflowDefinitionId: string, versionId: string): Promise<WorkflowDefinitionRecord> {
    const r = this.must(workflowDefinitionId);
    r.status = 'published';
    r.currentVersionId = versionId;
    r.hasUnpublishedChanges = false;
    r.updatedAt = this.now();
    return this.copy(r);
  }

  async setArchived(workflowDefinitionId: string, archived: boolean): Promise<WorkflowDefinitionRecord> {
    const r = this.must(workflowDefinitionId);
    r.archivedAt = archived ? this.now() : null;
    return this.copy(r);
  }

  async delete(workflowDefinitionId: string): Promise<void> {
    this.defs.delete(workflowDefinitionId);
    for (const [id, v] of this.versions) if (v.workflowDefinitionId === workflowDefinitionId) this.versions.delete(id);
  }

  async countRuns(workflowDefinitionId: string): Promise<number> {
    return this.runCounts.get(workflowDefinitionId) ?? 0;
  }

  clear(): void {
    this.defs.clear();
    this.versions.clear();
    this.runCounts.clear();
  }
}

/** A shorthand stage for `seedDefinition`: `[key, extra?]` or a full stage input. */
export type SeedStage = string | ({ key: string } & Record<string, unknown>);
export type SeedEdge = [from: string, to: string, on?: 'success' | 'failure' | 'completion' | 'always', when?: string];

/** Build a valid v2 graph from shorthand stages and edges. */
export function testGraph(
  stages: SeedStage[],
  edges: SeedEdge[] = [],
  workflow: Record<string, unknown> = {},
): WorkflowGraph {
  const result = validateWorkflow({
    formatVersion: 2,
    workflow: { name: 'test workflow', ...workflow },
    stages: stages.map((s) => {
      const base = typeof s === 'string' ? { key: s } : s;
      return { kind: 'agent', name: base.key, prompts: [{ label: base.key, text: `Do ${base.key}` }], ...base };
    }),
    edges: edges.map(([from, to, on = 'success', when]) => ({ from, to, on, ...(when ? { when } : {}) })),
  });
  if (!result.valid || !result.graph) {
    throw new Error(`testGraph is invalid: ${result.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  }
  return result.graph;
}

/** Insert a published definition and its version 1. */
export async function seedDefinition(
  store: MockWorkflowDefinitionStore,
  graph: WorkflowGraph,
  id = `def-${Math.random().toString(36).slice(2, 10)}`,
): Promise<{ definitionId: string; versionId: string; graph: WorkflowGraph }> {
  await store.insert({ id, status: 'draft', graph });
  const version = await store.insertVersion({ workflowDefinitionId: id, kind: 'published', graph, contentHash: `hash-${id}`, canonical: '' });
  await store.markPublished(id, version.id);
  return { definitionId: id, versionId: version.id, graph };
}

// ── MockWorkflowRunRepository ──

export class MockWorkflowRunRepository implements IWorkflowRunRepository {
  private store = new Map<string, WorkflowRun>();

  /** `createWithStages` writes its stage rows here. */
  constructor(private readonly stageRuns?: IStageRunRepository) {}

  async createWithStages(run: WorkflowRun, stageRuns: StageRun[]): Promise<void> {
    if (!this.stageRuns) throw new Error('MockWorkflowRunRepository: pass the stage-run repository to the constructor');
    this.store.set(run.id, { ...run });
    for (const sr of stageRuns) await this.stageRuns.create(sr);
  }

  async create(run: WorkflowRun): Promise<WorkflowRun> {
    this.store.set(run.id, { ...run });
    return { ...run };
  }

  async getById(id: string): Promise<WorkflowRun> {
    const run = this.store.get(id);
    if (!run) throw new Error(`WorkflowRun ${id} not found`);
    return { ...run };
  }

  async getAll(): Promise<WorkflowRun[]> {
    return [...this.store.values()].map((r) => ({ ...r }));
  }

  async getByDefinitionId(definitionId: string): Promise<WorkflowRun[]> {
    return [...this.store.values()]
      .filter((r) => r.workflowDefinitionId === definitionId)
      .map((r) => ({ ...r }));
  }

  async getByStatus(statuses: WorkflowRunStatus[]): Promise<WorkflowRun[]> {
    return [...this.store.values()]
      .filter((r) => statuses.includes(r.status))
      .map((r) => ({ ...r }));
  }
  async countByStatus(statuses: WorkflowRunStatus[]): Promise<number> {
    return (await this.getByStatus(statuses)).length;
  }

  async update(id: string, updates: Partial<WorkflowRun>): Promise<WorkflowRun> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`WorkflowRun ${id} not found`);
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.store.set(id, updated);
    return { ...updated };
  }

  async updateStatus(id: string, status: WorkflowRunStatus): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`WorkflowRun ${id} not found`);
    existing.status = status;
    existing.updatedAt = new Date();
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  clear(): void {
    this.store.clear();
  }
}

// ── MockStageRunRepository ──

export class MockStageRunRepository implements IStageRunRepository {
  private store = new Map<string, StageRun>();

  async create(stageRun: StageRun): Promise<StageRun> {
    this.store.set(stageRun.id, { ...stageRun });
    return { ...stageRun };
  }

  async getById(id: string): Promise<StageRun> {
    const sr = this.store.get(id);
    if (!sr) throw new Error(`StageRun ${id} not found`);
    return { ...sr };
  }

  async getByRunId(workflowRunId: string): Promise<StageRun[]> {
    return [...this.store.values()]
      .filter((sr) => sr.workflowRunId === workflowRunId)
      .map((sr) => ({ ...sr }));
  }

  async getByStatus(workflowRunId: string, statuses: StageRunStatus[]): Promise<StageRun[]> {
    return [...this.store.values()]
      .filter((sr) => sr.workflowRunId === workflowRunId && statuses.includes(sr.status))
      .map((sr) => ({ ...sr }));
  }

  async update(id: string, updates: Partial<StageRun>): Promise<StageRun> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`StageRun ${id} not found`);
    const updated = { ...existing, ...updates };
    this.store.set(id, updated);
    return { ...updated };
  }

  async updateStatus(id: string, status: StageRunStatus): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`StageRun ${id} not found`);
    existing.status = status;
  }

  async incrementRetryCount(id: string): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`StageRun ${id} not found`);
    existing.retryCount += 1;
  }

  async resetForRetry(id: string): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`StageRun ${id} not found`);
    existing.status = 'pending';
    existing.error = undefined;
    existing.startedAt = undefined;
    existing.completedAt = undefined;
  }

  async claimForExecution(id: string): Promise<boolean> {
    const existing = this.store.get(id);
    if (!existing || existing.status !== 'pending') return false;
    existing.status = 'queued';
    existing.version = (existing.version ?? 0) + 1;
    return true;
  }

  async batchUpdateStatus(ids: string[], status: StageRunStatus): Promise<void> {
    for (const id of ids) {
      const existing = this.store.get(id);
      if (existing) {
        existing.status = status;
      }
    }
  }

  /**
   * WS-D1 — liveness beat, mirroring `DrizzleStageRunRepository.heartbeat`:
   * only writes while the row is `queued`/`running`, returns whether it did.
   * Exists on the mock so `StageExecutionService`'s heartbeat timer (task 4)
   * has something real to assert against in tests instead of silently
   * hitting a missing method.
   */
  async heartbeat(id: string): Promise<boolean> {
    const existing = this.store.get(id);
    if (!existing || (existing.status !== 'queued' && existing.status !== 'running')) return false;
    existing.heartbeatAt = new Date();
    return true;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async deleteByRunId(workflowRunId: string): Promise<void> {
    for (const [id, sr] of this.store) {
      if (sr.workflowRunId === workflowRunId) {
        this.store.delete(id);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

// ── Fake WorkspaceManager ──
//
// Every run gets an execution workspace (P01 WP-1.3 — the workspace manager
// is a required dependency). Service-level tests only need the four calls the
// run and stage services make; nothing is written to disk.

import { SessionComposer } from '../src/services/session/SessionComposer.js';
import { TurnContextRegistry } from '../src/services/session/gates.js';
import type { SessionComposerDeps } from '../src/services/session/types.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { WorkspaceManager } from '../src/services/WorkspaceManager.js';

export function createFakeWorkspaceManager(root = '/tmp/gai-fake-ws'): WorkspaceManager {
  // Every run has a workspace (created at start); the fake answers for any owner.
  const workspaceOf = (ownerId: string) => ({ id: `ws-${ownerId}`, ownerId, rootPath: `${root}/${ownerId}` });
  return {
    createWorkspace: async (opts: { ownerId: string }) => workspaceOf(opts.ownerId),
    getWorkingDirectory: (ws: { rootPath: string }) => `${ws.rootPath}/source`,
    completeWorkspace: async () => undefined,
    findWorkspaceByOwner: async (ownerId: string) => workspaceOf(ownerId),
    getExecutionWorkspace: async (id: string) => workspaceOf(id.replace(/^ws-/, '')),
    getExposure: async (ws: { rootPath: string }) => ({
      rootPath: ws.rootPath,
      scratchDir: `${ws.rootPath}/scratch`,
      workingDirectory: `${ws.rootPath}/source`,
      additionalDirectories: [ws.rootPath],
      mounts: [],
      env: { GENERATORAI_WORKSPACE_ROOT: ws.rootPath },
      hint: `

[Workspace] ${ws.rootPath}/source`,
    }),
    trackArtifact: async () => undefined,
  } as unknown as WorkspaceManager;
}

/** A session composer over `harness` with the given platform services (test helper). */
export function createTestComposer(harness: IAgentHarness, deps: SessionComposerDeps = {}): SessionComposer {
  return new SessionComposer(deps, harness, new TurnContextRegistry());
}
