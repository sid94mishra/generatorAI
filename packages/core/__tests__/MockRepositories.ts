// ────────────────────────────────────────────────────────────────
// MockRepositories — In-memory mock implementations of all 6 new
// repository interfaces for service-level testing
// ────────────────────────────────────────────────────────────────

import type {
  Chat, ChatStatus, BackgroundTaskStatus,
  WorkflowDefinition,
  StageDefinition,
  StageEdge,
  WorkflowRun, WorkflowRunStatus,
  StageRun, StageRunStatus,
} from '@generatorai/shared';
import type { IChatRepository } from '../src/domain/ports/IChatRepository.js';
import type { IWorkflowDefinitionRepository } from '../src/domain/ports/IWorkflowDefinitionRepository.js';
import type { IStageDefinitionRepository } from '../src/domain/ports/IStageDefinitionRepository.js';
import type { IStageEdgeRepository } from '../src/domain/ports/IStageEdgeRepository.js';
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

// ── MockWorkflowDefinitionRepository ──

export class MockWorkflowDefinitionRepository implements IWorkflowDefinitionRepository {
  private store = new Map<string, WorkflowDefinition>();

  async create(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    this.store.set(definition.id, { ...definition });
    return { ...definition };
  }

  async getById(id: string): Promise<WorkflowDefinition> {
    const def = this.store.get(id);
    if (!def) throw new Error(`WorkflowDefinition ${id} not found`);
    return { ...def };
  }

  async getAll(): Promise<WorkflowDefinition[]> {
    return [...this.store.values()].map((d) => ({ ...d }));
  }

  async update(id: string, updates: Partial<WorkflowDefinition>): Promise<WorkflowDefinition> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`WorkflowDefinition ${id} not found`);
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.store.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  clear(): void {
    this.store.clear();
  }
}

// ── MockStageDefinitionRepository ──

export class MockStageDefinitionRepository implements IStageDefinitionRepository {
  private store = new Map<string, StageDefinition>();

  async create(stage: StageDefinition): Promise<StageDefinition> {
    this.store.set(stage.id, { ...stage });
    return { ...stage };
  }

  async getById(id: string): Promise<StageDefinition> {
    const stage = this.store.get(id);
    if (!stage) throw new Error(`StageDefinition ${id} not found`);
    return { ...stage };
  }

  async getByDefinitionId(workflowDefinitionId: string): Promise<StageDefinition[]> {
    return [...this.store.values()]
      .filter((s) => s.workflowDefinitionId === workflowDefinitionId)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ ...s }));
  }

  async update(id: string, updates: Partial<StageDefinition>): Promise<StageDefinition> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`StageDefinition ${id} not found`);
    const updated = { ...existing, ...updates };
    this.store.set(id, updated);
    return { ...updated };
  }

  async reorder(workflowDefinitionId: string, orderedIds: string[]): Promise<void> {
    orderedIds.forEach((id, index) => {
      const stage = this.store.get(id);
      if (stage && stage.workflowDefinitionId === workflowDefinitionId) {
        stage.order = index;
      }
    });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async deleteByDefinitionId(workflowDefinitionId: string): Promise<void> {
    for (const [id, stage] of this.store) {
      if (stage.workflowDefinitionId === workflowDefinitionId) {
        this.store.delete(id);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

// ── MockStageEdgeRepository ──

export class MockStageEdgeRepository implements IStageEdgeRepository {
  private store = new Map<string, StageEdge>();

  async create(edge: StageEdge): Promise<StageEdge> {
    this.store.set(edge.id, { ...edge });
    return { ...edge };
  }

  async getById(id: string): Promise<StageEdge> {
    const edge = this.store.get(id);
    if (!edge) throw new Error(`StageEdge ${id} not found`);
    return { ...edge };
  }

  async getByDefinitionId(workflowDefinitionId: string): Promise<StageEdge[]> {
    return [...this.store.values()]
      .filter((e) => e.workflowDefinitionId === workflowDefinitionId)
      .map((e) => ({ ...e }));
  }

  async getByStageId(stageId: string): Promise<StageEdge[]> {
    return [...this.store.values()]
      .filter((e) => e.fromStageId === stageId || e.toStageId === stageId)
      .map((e) => ({ ...e }));
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async deleteByDefinitionId(workflowDefinitionId: string): Promise<void> {
    for (const [id, edge] of this.store) {
      if (edge.workflowDefinitionId === workflowDefinitionId) {
        this.store.delete(id);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

// ── MockWorkflowRunRepository ──

export class MockWorkflowRunRepository implements IWorkflowRunRepository {
  private store = new Map<string, WorkflowRun>();

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
  async heartbeat(id: string, leaseOwner?: string): Promise<boolean> {
    const existing = this.store.get(id);
    if (!existing || (existing.status !== 'queued' && existing.status !== 'running')) return false;
    existing.heartbeatAt = new Date();
    if (leaseOwner !== undefined) existing.leaseOwner = leaseOwner;
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
