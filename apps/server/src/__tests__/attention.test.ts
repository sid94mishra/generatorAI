// ────────────────────────────────────────────────────────────────
// G-01 — the attention feed, end to end below the HTTP layer and through it.
//
// Real temp SQLite database, real Drizzle repositories, the real
// `AgentInteractionService` and `EventBus`, and the real route. Only the two
// in-process sources that have no table behind them are stand-ins: the
// streaming-chat registry (the real `StreamingChatRegistry` class, driven by
// hand) and the pending computer-consent list.
//
// What must hold:
//   - boot rebuild picks up gates, streaming chats, live runs (incl. a stage
//     awaiting approval and a paused run) and running automation executions;
//   - every change is one `attention.upsert|remove` with the next `seq`, then
//     one `attention.counts`;
//   - an entity with an ask leaves Running;
//   - GET /api/attention filters by project and strips `ask.detail` /
//     `progress.label` for principals that may not read the entity.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentInteractionService,
  AttentionService,
  EventBus,
  StreamingChatRegistry,
  type AttentionConsentEntry,
} from '@generatorai/core';
import {
  createDB,
  migrateDB,
  sessions,
  DrizzleAgentInteractionRepository,
  DrizzleAutomationExecutionRepository,
  DrizzleAutomationRepository,
  DrizzleChatRepository,
  DrizzleProjectRepository,
  DrizzleStageRunRepository,
  DrizzleWorkflowRunRepository,
  SqliteWorkflowDefinitionStore,
  listAutomationExecutionIdsByStatus,
  sqliteHandle,
  type AppDatabase,
} from '@generatorai/db';
import type {
  AgentEvent,
  AttentionSnapshot,
  Automation,
  AutomationExecution,
  Chat,
  PersistedEvent,
  StageRun,
  WorkflowRun,
} from '@generatorai/shared';
import type { WorkflowGraph } from '@generatorai/workflow-spec';
import type { Principal } from '@generatorai/auth';

import { createAttentionRoutes } from '../routes/attention.js';

let dir: string;
let db: AppDatabase;
let bus: EventBus;
let streaming: StreamingChatRegistry;
let consents: AttentionConsentEntry[];
let interactions: AgentInteractionService;
let service: AttentionService;
let emitted: Array<{ kind: string; data: Record<string, unknown> }>;

const repos = () => ({
  chats: new DrizzleChatRepository(db),
  projects: new DrizzleProjectRepository(db),
  runs: new DrizzleWorkflowRunRepository(db),
  stageRuns: new DrizzleStageRunRepository(db),
  definitions: new SqliteWorkflowDefinitionStore(db),
  automations: new DrizzleAutomationRepository(db),
  executions: new DrizzleAutomationExecutionRepository(db),
});

const T0 = new Date('2026-09-26T09:00:00.000Z');
/** A workflow graph's `projectId` must be a UUID, so the shared project is one. */
const P1 = '00000000-0000-4000-8000-000000000001';

async function makeProject(id: string, name: string): Promise<void> {
  await repos().projects.create({
    id,
    name,
    settings: {},
    rootPath: join(dir, id),
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
  });
}

async function makeChat(id: string, over: Partial<Chat> = {}): Promise<Chat> {
  const sessionId = `sess-${id}`;
  await db.insert(sessions).values({ id: sessionId, name: id, status: 'active', createdAt: T0, updatedAt: T0 });
  return repos().chats.create({
    id,
    name: `Chat ${id}`,
    sessionId,
    tags: [],
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
    ...over,
  } as Chat);
}

/**
 * A published definition, the way the definition service stores one: the
 * working graph (whose `workflow` carries the name and project) plus the
 * immutable version a run pins.
 */
async function makeDefinition(id: string, over: { name?: string; projectId?: string; stageKeys?: string[] } = {}): Promise<void> {
  const store = repos().definitions;
  const graph = {
    formatVersion: 2,
    workflow: { name: over.name ?? 'Dependency upgrade', ...(over.projectId ? { projectId: over.projectId } : {}) },
    stages: (over.stageKeys ?? []).map((key) => ({ key, name: key, kind: 'agent', prompts: [{ label: 'P', text: 'x' }] })),
    edges: [],
  } as unknown as WorkflowGraph;
  await store.insert({ id, status: 'published', graph });
  const version = await store.insertVersion({
    workflowDefinitionId: id,
    kind: 'published',
    graph,
    contentHash: `hash-${id}`,
    canonical: JSON.stringify(graph),
  });
  await store.markPublished(id, version.id);
}

/** The engine's run-state path from `created` to each state these tests need (CAS transitions). */
const RUN_PATH: Partial<Record<WorkflowRun['status'], Array<WorkflowRun['status']>>> = {
  created: [],
  starting: ['starting'],
  running: ['starting', 'running'],
  waiting: ['starting', 'running', 'waiting'],
  paused: ['starting', 'running', 'paused'],
  completed: ['starting', 'running', 'finalizing', 'completed'],
};

/** Moves a run through the engine's legal transitions; the outcome is fixed on entering `finalizing`. */
function advanceRun(id: string, to: WorkflowRun['status']): void {
  const runs = repos().runs;
  const path = RUN_PATH[to]!;
  const from = runs.getRunRow(id)!.status as WorkflowRun['status'];
  for (const next of path.slice(path.indexOf(from) + 1)) {
    const current = runs.getRunRow(id)!.status as WorkflowRun['status'];
    const result = runs.transition(id, [current], next, next === 'finalizing' ? { patch: { outcome: 'completed' } } : {});
    if (!result.ok) throw new Error(`run ${id}: ${current} -> ${next} refused`);
  }
}

async function makeRun(id: string, definitionId: string, status: WorkflowRun['status']): Promise<void> {
  const definition = await repos().definitions.getGraph(definitionId);
  await repos().runs.create({
    id,
    workflowDefinitionId: definitionId,
    definitionVersionId: definition.currentVersionId!,
    name: `Dependency upgrade - Run 1790000000000`,
    status: 'created',
    variables: {},
    createdAt: T0,
    updatedAt: T0,
  });
  advanceRun(id, status);
}

/**
 * One top-level stage instance (a `stage_runs` row). The engine's scheduler
 * creates these and no repository method inserts one, so the row is written
 * directly, the way the engine store tests seed instances.
 */
function makeStage(
  id: string,
  runId: string,
  name: string,
  status: StageRun['status'],
  interruptData?: unknown,
): void {
  sqliteHandle(db)
    .prepare(
      `INSERT INTO stage_runs (id, workflow_run_id, stage_key, kind, name, instance_path, status, interrupt_data, created_at, updated_at)
       VALUES (?, ?, ?, 'agent', ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, runId, id, name, id, status, interruptData === undefined ? null : JSON.stringify(interruptData), T0.getTime(), T0.getTime());
}

async function makeAutomation(id: string, projectId?: string): Promise<void> {
  await repos().automations.create({
    id,
    name: 'Nightly audit',
    enabled: true,
    triggerType: 'manual',
    workflowIds: [],
    inputMode: 'single',
    variables: {},
    maxConcurrency: 1,
    onError: 'continue',
    ...(projectId ? { projectId } : {}),
    createdAt: T0,
    updatedAt: T0,
  } as unknown as Automation);
}

async function makeExecution(id: string, automationId: string, status: AutomationExecution['status']): Promise<void> {
  await repos().executions.createExecution({
    id,
    automationId,
    status,
    triggeredBy: 'manual',
    totalIterations: 4,
    completedIterations: 1,
    failedIterations: 0,
    startedAt: T0,
    createdAt: T0,
  });
}

/** Opens a chat gate the way ChatManagementService does, without blocking the test. */
function openGate(chatId: string, kind: 'tool_permission' | 'question', payload: unknown): void {
  void interactions.open({ kind: 'chat', chatId, sessionId: `sess-${chatId}`, turnId: 't1' }, kind, payload);
}

function startService(): AttentionService {
  const r = repos();
  service = new AttentionService({
    eventBus: bus,
    chats: r.chats,
    projects: r.projects,
    interactions,
    streaming: {
      getStreamingSince: () => streaming.since(),
      onStreamingChange: (listener) => streaming.onChange(listener),
    },
    runs: r.runs,
    stageRuns: r.stageRuns,
    definitions: r.definitions,
    automations: r.automations,
    executions: {
      getExecutionById: (id) => r.executions.getExecutionById(id),
      // The boot rebuild asks for live ids in one query; walking every
      // automation's history is what P2-R16 removed.
      getExecutionsByAutomationId: () => Promise.reject(new Error('the rebuild must not read execution history')),
      listIdsByStatus: (statuses) => listAutomationExecutionIdsByStatus(db, statuses),
    },
    consent: { listAllPending: () => consents },
    seqBase: 1000,
  });
  return service;
}

function emitChat(chatId: string, kind: string, data: Record<string, unknown> = {}): Promise<unknown> {
  return bus.emit(`sess-${chatId}`, { kind, data: { chatId, ...data } } as unknown as AgentEvent);
}

function principal(scopes: string[]): Principal {
  return {
    type: 'paired-device',
    id: 'device:d1',
    scopes: scopes as Principal['scopes'],
    transport: 'lan',
    credentialKind: 'access-token',
  };
}

function app(current: Principal | undefined) {
  const a = express();
  a.use((req, _res, next) => {
    if (current) req.principal = current;
    next();
  });
  a.use('/api/attention', createAttentionRoutes({ attentionService: service } as never));
  return a;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'generatorai-g01-test-'));
  db = createDB(join(dir, 'attention.db'));
  migrateDB(db);
  bus = new EventBus();
  streaming = new StreamingChatRegistry();
  consents = [];
  interactions = new AgentInteractionService(new DrizzleAgentInteractionRepository(db), undefined, undefined, {
    sweepIntervalMs: 0,
  });
  emitted = [];
  bus.subscribeGlobal((event: PersistedEvent) => {
    if (event.kind.startsWith('attention.')) {
      emitted.push({ kind: event.kind, data: event.data as Record<string, unknown> });
    }
  });
});

afterEach(() => {
  service?.stop();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the handle a moment longer */
  }
});

describe('AttentionService — boot rebuild', () => {
  it('lists gates, streaming chats, live runs and running executions; empty run history is fine', async () => {
    await makeProject(P1, 'Website');
    await makeChat('c-ask', { projectId: P1 });
    await makeChat('c-run');
    await makeChat('c-orch', { name: 'Orchestrator' });
    await makeChat('c-worker', { parentChatId: 'c-orch', name: 'Worker' } as Partial<Chat>);
    openGate('c-ask', 'tool_permission', { toolName: 'Bash', inputSummary: 'git push origin main' });
    openGate('c-worker', 'question', { questions: [{ id: 'q', header: 'h', question: 'Which branch?' }] });
    streaming.set('c-run', () => {});
    streaming.set('c-ask', () => {}); // blocked on its gate: Needs you only

    await makeDefinition('d1', { projectId: P1 });
    await makeRun('r-live', 'd1', 'running');
    makeStage('s1', 'r-live', 'Scan', 'completed');
    makeStage('s2', 'r-live', 'Plan upgrades', 'running');
    makeStage('s3', 'r-live', 'Apply', 'pending');
    await makeRun('r-gate', 'd1', 'running');
    makeStage('s4', 'r-gate', 'Apply upgrades', 'awaiting_input', {
      kind: 'stage_completion_review',
      reason: '14 packages, 3 majors',
    });
    await makeRun('r-paused', 'd1', 'paused');
    await makeRun('r-done', 'd1', 'completed');
    await makeAutomation('a1', P1);
    await makeExecution('e-run', 'a1', 'running');
    await makeExecution('e-done', 'a1', 'completed');
    await vi.waitFor(async () => expect(await interactions.listPendingAll()).toHaveLength(2));

    await startService().start();
    const snap = service.getSnapshot();

    expect(snap.needsYou.map((i) => i.key).sort()).toEqual(
      [
        expect.stringMatching(/^chat:c-ask:/),
        expect.stringMatching(/^chat:c-worker:/),
        'workflow_run:r-gate:s4',
        'workflow_run:r-paused:r-paused',
      ].sort((a, b) => String(a).localeCompare(String(b))),
    );
    expect(snap.running.map((i) => i.key).sort()).toEqual([
      'automation_execution:e-run',
      'chat:c-run',
      'workflow_run:r-live',
    ]);

    const ask = snap.needsYou.find((i) => i.entityId === 'c-ask')!;
    expect(ask).toMatchObject({
      entity: 'chat',
      state: 'needs_you',
      title: 'Chat c-ask',
      href: '/chats/c-ask',
      project: { id: P1, name: 'Website' },
      stoppable: true,
      ask: { kind: 'tool_permission', summary: 'Run this command?', detail: 'git push origin main', actions: ['allow_once', 'deny', 'open'] },
    });

    // A worker's ask rolls up to its orchestrator, opened on the Tasks dock.
    const worker = snap.needsYou.find((i) => i.entityId === 'c-worker')!;
    expect(worker.parent).toEqual({ entity: 'chat', id: 'c-orch', title: 'Orchestrator' });
    expect(worker.href).toBe('/chats/c-orch?dock=tasks');
    expect(worker.ask).toMatchObject({ kind: 'question', summary: 'Which branch?', actions: ['answer', 'open'] });

    const stage = snap.needsYou.find((i) => i.key === 'workflow_run:r-gate:s4')!;
    expect(stage).toMatchObject({
      title: 'Dependency upgrade',
      href: '/workflows/d1/runs/r-gate',
      state: 'needs_you',
      ask: { kind: 'stage_approval', summary: 'Approve “Apply upgrades”', detail: 'Stage 1 of 1 · 14 packages, 3 majors' },
    });
    expect(snap.needsYou.find((i) => i.key === 'workflow_run:r-paused:r-paused')).toMatchObject({
      state: 'paused',
      ask: { kind: 'run_paused', actions: ['open'] },
    });

    const run = snap.running.find((i) => i.key === 'workflow_run:r-live')!;
    expect(run).toMatchObject({ state: 'running', stoppable: true, progress: { label: 'Plan upgrades', step: 2, of: 3 } });
    expect(snap.running.find((i) => i.key === 'automation_execution:e-run')).toMatchObject({
      title: 'Nightly audit',
      href: '/automations/a1',
      state: 'running',
      project: { id: P1, name: 'Website' },
      progress: { label: 'Iteration 2 of 4', step: 2, of: 4 },
    });

    expect(snap.counts).toEqual({
      needsYou: 4,
      running: 3,
      byEntity: {
        chat: { needsYou: 2, running: 1 },
        workflow_run: { needsYou: 2, running: 1 },
        automation_execution: { needsYou: 0, running: 1 },
      },
    });
    // Project filter: counts follow it.
    const p1 = service.getSnapshot({ projectId: P1 });
    expect(p1.needsYou.every((i) => i.project?.id === P1)).toBe(true);
    expect(p1.counts.needsYou).toBe(p1.needsYou.length);
    expect(p1.running.map((i) => i.key).sort()).toEqual(['automation_execution:e-run', 'workflow_run:r-live']);
  });

  it('lists a live run held only by paused stages under Needs you (U-32)', async () => {
    await makeDefinition('d1', { projectId: P1 });
    await makeRun('r-held', 'd1', 'waiting');
    makeStage('s1', 'r-held', 'Scan', 'completed');
    makeStage('s2', 'r-held', 'Patrol', 'paused');
    sqliteHandle(db).prepare(`UPDATE stage_runs SET status_reason = 'interrupted' WHERE id = 's2'`).run();

    await startService().start();
    const snap = service.getSnapshot();
    expect(snap.running.map((i) => i.key)).not.toContain('workflow_run:r-held');
    expect(snap.needsYou.find((i) => i.key === 'workflow_run:r-held:r-held')).toMatchObject({
      state: 'paused',
      ask: { kind: 'run_paused', summary: 'Patrol stopped when the app closed — resume to continue', actions: ['open'] },
    });
  });

  it('an automation whose only live run waits on a person waits, not spins (U-41)', async () => {
    await makeProject(P1, 'Website');
    await makeDefinition('d1', { projectId: P1 });
    await makeAutomation('a1', P1);
    await makeExecution('e-held', 'a1', 'running');
    await makeRun('r-auto', 'd1', 'waiting');
    sqliteHandle(db)
      .prepare(`UPDATE workflow_runs SET trigger = ? WHERE id = 'r-auto'`)
      .run(JSON.stringify({ kind: 'automation', automationId: 'a1', executionId: 'e-held', via: 'schedule', iterationIndex: 0 }));
    makeStage('s1', 'r-auto', 'Patrol', 'paused');

    await startService().start();
    await service.settled();
    const snap = service.getSnapshot();
    expect(snap.needsYou.map((i) => i.key)).toContain('workflow_run:r-auto:r-auto');
    expect(snap.running.find((i) => i.key === 'automation_execution:e-held')).toMatchObject({ state: 'waiting' });
  });

  it('starts empty on an empty database (no run history at all)', async () => {
    await startService().start();
    const snap = service.getSnapshot();
    expect(snap.needsYou).toEqual([]);
    expect(snap.running).toEqual([]);
    expect(snap.seq).toBe(1000);
  });
});

describe('AttentionService — live deltas', () => {
  it('emits one delta per change with the next seq, then counts; asks outrank running', async () => {
    await makeChat('c1');
    await startService().start();
    expect(emitted).toEqual([]);

    streaming.set('c1', () => {});
    await service.settled();
    expect(emitted.map((e) => [e.kind, e.data['seq']])).toEqual([
      ['attention.upsert', 1001],
      ['attention.counts', 1001],
    ]);
    expect((emitted[0]!.data['item'] as { key: string }).key).toBe('chat:c1');

    // A tool step updates the label in place — an upsert, but the totals did
    // not move, so no `attention.counts` wakes the badge (P2-R16).
    emitted = [];
    await emitChat('c1', 'harness.tool_start', { tool: 'Bash', args: { command: 'pnpm build\n--filter web' } });
    await service.settled();
    expect(service.getSnapshot().running[0]!.progress).toEqual({ label: 'Running pnpm build' });
    expect(emitted.map((e) => e.kind)).toEqual(['attention.upsert']);

    // The agent asks: the chat leaves Running and appears under Needs you.
    emitted = [];
    openGate('c1', 'tool_permission', { toolName: 'Write', description: 'Write src/app.ts' });
    await vi.waitFor(async () => expect(await interactions.listPendingByChat('c1')).toHaveLength(1));
    const [gate] = await interactions.listPendingByChat('c1');
    await emitChat('c1', 'chat.permission.requested', { interactionId: gate!.id });
    await service.settled();
    const kinds = emitted.map((e) => e.kind);
    expect(kinds).toEqual(['attention.remove', 'attention.upsert', 'attention.counts']);
    const seqs = emitted.map((e) => e.data['seq'] as number);
    expect(seqs[1]).toBe(seqs[0]! + 1);
    expect(seqs[2]).toBe(seqs[1]);
    expect(service.getSnapshot().running).toEqual([]);
    expect(service.getSnapshot().needsYou[0]!.ask).toMatchObject({ kind: 'tool_permission', id: gate!.id });

    // Resolved and the turn ends: the ask goes, nothing is left.
    await interactions.resolve(gate!.id, 'answered', { granted: true });
    await emitChat('c1', 'chat.permission.resolved', { interactionId: gate!.id });
    streaming.delete('c1');
    await service.settled();
    expect(service.getSnapshot().needsYou).toEqual([]);
    expect(service.getSnapshot().running).toEqual([]);
  });

  it('follows workflow runs through global events and ignores its own emits', async () => {
    await makeDefinition('d1');
    await makeRun('r1', 'd1', 'running');
    makeStage('s1', 'r1', 'Build', 'running');
    await startService().start();
    expect(service.getSnapshot().running.map((i) => i.key)).toEqual(['workflow_run:r1']);

    // The executor parks the instance on an input request (running -> awaiting_input).
    const parked = repos().stageRuns.transition('s1', ['running'], 'awaiting_input', {
      patch: { interruptData: { prompt: 'Pick a version' } },
    });
    expect(parked.ok).toBe(true);
    await bus.emitGlobal({ kind: 'stage_run.awaiting_input', data: { stageRunId: 's1', workflowRunId: 'r1' } } as AgentEvent);
    await service.settled();
    expect(service.getSnapshot().needsYou[0]).toMatchObject({
      key: 'workflow_run:r1:s1',
      ask: { kind: 'stage_input', summary: 'Answer “Build”', actions: ['answer', 'open'] },
    });

    advanceRun('r1', 'completed');
    await bus.emitGlobal({ kind: 'workflow_run.completed', data: { workflowRunId: 'r1' } } as AgentEvent);
    await service.settled();
    expect(service.getSnapshot().needsYou).toEqual([]);
    expect(service.getSnapshot().running).toEqual([]);
  });

  it('shows a run whose only live instances wait on a timer or a retry as waiting, not running', async () => {
    await makeDefinition('d1');
    await makeRun('r1', 'd1', 'waiting');
    makeStage('s1', 'r1', 'Build', 'completed');
    makeStage('s2', 'r1', 'Poll deploy', 'waiting');
    makeStage('s3', 'r1', 'Notify', 'retry_wait');
    await startService().start();
    expect(service.getSnapshot().needsYou).toEqual([]);
    expect(service.getSnapshot().running).toEqual([
      expect.objectContaining({ key: 'workflow_run:r1', state: 'waiting', stoppable: true, progress: { step: 2, of: 3 } }),
    ]);
  });

  it('P2-R33: refreshProject drops a deleted project from every item shown under it, runs included', async () => {
    await makeProject(P1, 'Website');
    await makeDefinition('d1', { projectId: P1 });
    await makeRun('r1', 'd1', 'running');
    makeStage('s1', 'r1', 'Build', 'running');
    await makeChat('c1', { projectId: P1 });
    streaming.set('c1', () => {});
    await startService().start();
    expect(service.getSnapshot().running.map((i) => i.project?.id)).toEqual([P1, P1]);

    await repos().projects.delete(P1); // unlinks the chat and the definition, emits nothing
    service.refreshProject(P1);
    await service.settled();
    expect(service.getSnapshot().running.map((i) => i.key).sort()).toEqual(['chat:c1', 'workflow_run:r1']);
    expect(service.getSnapshot().running.map((i) => i.project)).toEqual([undefined, undefined]);
  });

  it('lists a pending computer consent under its chat and drops it once answered', async () => {
    await makeChat('c1');
    await startService().start();
    consents = [
      { requestId: 'rq1', workspaceId: 'w1', chatId: 'c1', appLabel: 'Safari', action: 'click', summary: 'Click “Buy”', expiresAt: Date.now() + 60_000 },
    ];
    await bus.emit('computer:w1', {
      kind: 'computer.consent_required',
      data: { chatId: 'c1', requestId: 'rq1', expiresAt: Date.now() + 60_000 },
    } as unknown as AgentEvent);
    await service.settled();
    expect(service.getSnapshot().needsYou[0]).toMatchObject({
      key: 'chat:c1:rq1',
      href: '/chats/c1?dock=computer',
      ask: { kind: 'computer_consent', summary: 'Allow Safari?', detail: 'Click “Buy”' },
    });

    consents = [];
    await bus.emit('computer:w1', { kind: 'computer.consent_resolved', data: { chatId: 'c1', requestId: 'rq1' } } as unknown as AgentEvent);
    await service.settled();
    expect(service.getSnapshot().needsYou).toEqual([]);
  });
});

describe('AttentionService — worker chats roll up into their orchestrator (D-86)', () => {
  it('counts what a person started: one Running item per orchestrator, never one per worker', async () => {
    await makeChat('orch', { name: 'Orchestrator' });
    await makeChat('w1', { parentChatId: 'orch' } as Partial<Chat>);
    await makeChat('w2', { parentChatId: 'orch' } as Partial<Chat>);
    await makeChat('w3', { parentChatId: 'orch' } as Partial<Chat>);
    // Two workers working, one blocked on a question; the orchestrator's own turn has ended.
    streaming.set('w1', () => {});
    streaming.set('w2', () => {});
    streaming.set('w3', () => {});
    openGate('w3', 'question', { questions: [{ id: 'q', header: 'h', question: 'Which branch?' }] });
    await vi.waitFor(async () => expect(await interactions.listPendingByChat('w3')).toHaveLength(1));

    await startService().start();
    let snap = service.getSnapshot();
    expect(snap.running).toHaveLength(1);
    expect(snap.running[0]).toMatchObject({
      key: 'chat:orch',
      title: 'Orchestrator',
      href: '/chats/orch?dock=tasks',
      state: 'running',
      stoppable: false,
      progress: { label: '2 background tasks running' },
    });
    expect(snap.running[0]!.parent).toBeUndefined();
    // The asking worker still needs the person.
    expect(snap.needsYou.map((i) => i.entityId)).toEqual(['w3']);
    expect(snap.counts.running).toBe(1);
    expect(snap.counts.byEntity.chat).toEqual({ needsYou: 1, running: 1 });

    // A worker finishes: the label follows.
    streaming.delete('w2');
    await service.settled();
    expect(service.getSnapshot().running[0]!.progress).toEqual({ label: '1 background task running' });

    // The orchestrator takes a turn while a worker still works: one item, its step first.
    streaming.set('orch', () => {});
    await emitChat('orch', 'harness.tool_start', { tool: 'Bash', args: { command: 'pnpm test' } });
    await service.settled();
    snap = service.getSnapshot();
    expect(snap.running.map((i) => i.key)).toEqual(['chat:orch']);
    expect(snap.running[0]).toMatchObject({
      href: '/chats/orch',
      stoppable: true,
      progress: { label: 'Running pnpm test · 1 background task running' },
    });

    // Every worker done, then the orchestrator: nothing is running, and nothing is left behind.
    streaming.delete('w1');
    await service.settled();
    expect(service.getSnapshot().running[0]!.progress).toEqual({ label: 'Running pnpm test' });
    streaming.delete('orch');
    await service.settled();
    expect(service.getSnapshot().running).toEqual([]);
    expect(service.getSnapshot().counts.running).toBe(0);
  });

  it('D-92: an orchestrator carries its workers by lifecycle, kept current by the worker events', async () => {
    const task = (status: string) => ({ orchestratorChatId: 'orch', taskName: 't', status }) as Chat['backgroundTask'];
    await makeChat('orch', {
      name: 'Orchestrator',
      orchestratorMode: true,
      model: 'claude-sonnet-5',
      agentSnapshot: { driving: { name: 'Release Captain' } } as Chat['agentSnapshot'],
    } as Partial<Chat>);
    await makeChat('w1', { parentChatId: 'orch', backgroundTask: task('running') } as Partial<Chat>);
    await makeChat('w2', { parentChatId: 'orch', backgroundTask: task('spawned') } as Partial<Chat>);
    await makeChat('w3', { parentChatId: 'orch', backgroundTask: task('completed') } as Partial<Chat>);
    streaming.set('w1', () => {});
    await startService().start();
    expect(service.getSnapshot().running[0]).toMatchObject({
      key: 'chat:orch',
      meta: {
        agent: 'Release Captain',
        model: 'claude-sonnet-5',
        workers: { total: 3, running: 1, queued: 1, inReview: 0, done: 1, failed: 0 },
      },
    });

    // The queued worker starts: the orchestrator is re-read on the worker's status event.
    await repos().chats.updateBackgroundTaskStatus('w2', 'running');
    await emitChat('orch', 'chat.background_task.status', { parentChatId: 'orch', taskId: 'w2', status: 'running' });
    await service.settled();
    expect(service.getSnapshot().running[0]!.meta?.workers).toMatchObject({ running: 2, queued: 0 });
  });

  it('D-92: an approval wait stage waits on a person: Needs you with Approve / Reject, not Running', async () => {
    await makeDefinition('d1', { stageKeys: ['z1', 'm2', 'a3'] });
    await makeRun('r-wait', 'd1', 'waiting');
    // Ids/paths deliberately out of alphabetical order: the position follows creation order.
    makeStage('z1', 'r-wait', 'Scan', 'completed');
    makeStage('m2', 'r-wait', 'Apply upgrades', 'waiting', { kind: 'wait', type: 'approval', label: 'Approve', prompt: '14 packages' });
    makeStage('a3', 'r-wait', 'Verify', 'pending');
    await startService().start();
    const snap = service.getSnapshot();
    expect(snap.running).toEqual([]);
    expect(snap.needsYou[0]).toMatchObject({
      key: 'workflow_run:r-wait:m2',
      state: 'needs_you',
      ask: { kind: 'stage_approval', id: 'm2', summary: 'Approve “Apply upgrades”', detail: 'Stage 2 of 3 · 14 packages', actions: ['approve', 'reject', 'open'] },
      progress: { step: 2, of: 3 },
    });
  });

  it('D-92: a run an automation started rolls up into its execution (one Running item)', async () => {
    await makeDefinition('d1');
    await makeRun('r-auto', 'd1', 'running');
    sqliteHandle(db).prepare('UPDATE workflow_runs SET trigger = ? WHERE id = ?').run(JSON.stringify({ kind: 'automation', automationId: 'a1', executionId: 'e1' }), 'r-auto');
    makeStage('s1', 'r-auto', 'Collect', 'running');
    await makeAutomation('a1');
    await makeExecution('e1', 'a1', 'running');
    await startService().start();
    expect(service.getSnapshot().running.map((i) => i.key)).toEqual(['automation_execution:e1']);
  });

  it('D-92: a live automation execution names its trigger and can be stopped', async () => {
    await makeAutomation('a1');
    await makeExecution('e1', 'a1', 'running');
    await startService().start();
    expect(service.getSnapshot().running[0]).toMatchObject({
      key: 'automation_execution:e1',
      stoppable: true,
      meta: { automation: { id: 'a1', triggerType: 'manual' } },
    });
  });

  it('drops an archived worker from its orchestrator', async () => {
    await makeChat('orch', { name: 'Orchestrator' });
    await makeChat('w1', { parentChatId: 'orch' } as Partial<Chat>);
    streaming.set('w1', () => {});
    await startService().start();
    expect(service.getSnapshot().counts.running).toBe(1);

    await repos().chats.update('w1', { status: 'archived' });
    await emitChat('w1', 'chat.archived');
    await service.settled();
    expect(service.getSnapshot().running).toEqual([]);
  });
});

describe('AttentionService — consent without a chat (P2-R19)', () => {
  it('lists a workspace-level prompt on the top-level chat that owns the workspace, and drops it once answered', async () => {
    await makeChat('owner', { workspaceId: 'w2' } as Partial<Chat>);
    await makeChat('worker', { workspaceId: 'w2', parentChatId: 'owner' } as Partial<Chat>);
    await makeChat('other', { workspaceId: 'w3' } as Partial<Chat>);
    await startService().start();
    consents = [
      { requestId: 'rq2', workspaceId: 'w2', appLabel: 'Finder', action: 'open', summary: 'Open Downloads', expiresAt: Date.now() + 60_000 },
    ];
    await bus.emit('computer:w2', {
      kind: 'computer.consent_required',
      data: { workspaceId: 'w2', requestId: 'rq2', expiresAt: Date.now() + 60_000 },
    } as unknown as AgentEvent);
    await vi.waitFor(() => expect(service.getSnapshot().needsYou).toHaveLength(1));
    expect(service.getSnapshot().needsYou[0]).toMatchObject({
      key: 'chat:owner:rq2',
      entityId: 'owner',
      ask: { kind: 'computer_consent', summary: 'Allow Finder?' },
    });

    consents = [];
    await bus.emit('computer:w2', {
      kind: 'computer.consent_resolved',
      data: { workspaceId: 'w2', requestId: 'rq2' },
    } as unknown as AgentEvent);
    await vi.waitFor(() => expect(service.getSnapshot().needsYou).toEqual([]));
  });

  it('P2-R32: drops a prompt raised by a worker chat once answered, although the answer names no chat', async () => {
    await makeChat('owner', { workspaceId: 'w4' } as Partial<Chat>);
    await makeChat('worker', { workspaceId: 'w4', parentChatId: 'owner' } as Partial<Chat>);
    await startService().start();
    consents = [
      { requestId: 'rq4', workspaceId: 'w4', chatId: 'worker', appLabel: 'Safari', action: 'click', summary: 'Click', expiresAt: Date.now() + 60_000 },
    ];
    await bus.emit('computer:w4', {
      kind: 'computer.consent_required',
      data: { chatId: 'worker', workspaceId: 'w4', requestId: 'rq4', expiresAt: Date.now() + 60_000 },
    } as unknown as AgentEvent);
    await service.settled();
    expect(service.getSnapshot().needsYou.map((i) => i.key)).toEqual(['chat:worker:rq4']);

    consents = [];
    // The shape ComputerService emits: workspace + request, no chatId.
    await bus.emit('computer:w4', {
      kind: 'computer.consent_resolved',
      data: { workspaceId: 'w4', requestId: 'rq4', decision: 'allow_once' },
    } as unknown as AgentEvent);
    await vi.waitFor(() => expect(service.getSnapshot().needsYou).toEqual([]));
  });

  it('finds a pending workspace-level prompt on boot', async () => {
    await makeChat('owner', { workspaceId: 'w2' } as Partial<Chat>);
    consents = [
      { requestId: 'rq3', workspaceId: 'w2', appLabel: 'Mail', action: 'send', summary: 'Send', expiresAt: Date.now() + 60_000 },
    ];
    await startService().start();
    expect(service.getSnapshot().needsYou.map((i) => i.key)).toEqual(['chat:owner:rq3']);
  });
});

describe('GET /api/attention', () => {
  beforeEach(async () => {
    await makeProject(P1, 'Website');
    await makeChat('c1', { projectId: P1 });
    await makeDefinition('d1');
    await makeRun('r1', 'd1', 'running');
    makeStage('s1', 'r1', 'Apply', 'awaiting_input', { kind: 'tool_permission', request: { description: 'rm -rf dist' } });
    openGate('c1', 'tool_permission', { toolName: 'Bash', inputSummary: 'git push --force' });
    await vi.waitFor(async () => expect(await interactions.listPendingAll()).toHaveLength(1));
    await startService().start();
  });

  it('returns the full snapshot to an unauthenticated loopback caller', async () => {
    const res = await request(app(undefined)).get('/api/attention');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as AttentionSnapshot;
    expect(body.seq).toBeGreaterThan(1000);
    expect(body.needsYou.map((i) => i.entity).sort()).toEqual(['chat', 'workflow_run']);
    expect(JSON.stringify(body)).toContain('git push --force');
    expect(JSON.stringify(body)).toContain('rm -rf dist');
  });

  it('filters by project', async () => {
    const res = await request(app(undefined)).get(`/api/attention?projectId=${P1}`);
    expect((res.body as AttentionSnapshot).needsYou.map((i) => i.entityId)).toEqual(['c1']);
    expect((res.body as AttentionSnapshot).counts.needsYou).toBe(1);
  });

  it('strips detail per entity for a principal that may not read it', async () => {
    const res = await request(app(principal(['read:activity', 'read:chats']))).get('/api/attention');
    const text = JSON.stringify(res.body);
    expect(text).toContain('git push --force'); // may read chats
    expect(text).not.toContain('rm -rf dist'); // may not read workflows
    const run = (res.body as AttentionSnapshot).needsYou.find((i) => i.entity === 'workflow_run')!;
    expect(run.ask).toMatchObject({ kind: 'stage_approval', summary: 'Approve “Apply”' });
    expect(run.ask).not.toHaveProperty('detail');

    const none = await request(app(principal(['read:activity']))).get('/api/attention');
    expect(JSON.stringify(none.body)).not.toContain('git push --force');
    expect((none.body as AttentionSnapshot).counts.needsYou).toBe(2);
  });

  it('P2-R17: answers 503, not an empty feed, when the service never started', async () => {
    service.stop();
    startService(); // constructed, not started
    const res = await request(app(undefined)).get('/api/attention');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: { code: 'ATTENTION_UNAVAILABLE' } });
  });

  it('rejects an empty projectId', async () => {
    const res = await request(app(undefined)).get('/api/attention?projectId=');
    expect(res.status).toBe(400);
  });
});
