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
  DrizzleStageDefinitionRepository,
  DrizzleStageRunRepository,
  DrizzleWorkflowDefinitionRepository,
  DrizzleWorkflowRunRepository,
  type AppDatabase,
} from '@generatorai/db';
import type {
  AgentEvent,
  AttentionSnapshot,
  Automation,
  AutomationExecution,
  Chat,
  PersistedEvent,
  StageDefinition,
  StageRun,
  WorkflowDefinition,
  WorkflowRun,
} from '@generatorai/shared';
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
  definitions: new DrizzleWorkflowDefinitionRepository(db),
  automations: new DrizzleAutomationRepository(db),
  executions: new DrizzleAutomationExecutionRepository(db),
});

const T0 = new Date('2026-09-26T09:00:00.000Z');

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

async function makeDefinition(id: string, over: Partial<WorkflowDefinition> = {}): Promise<void> {
  await repos().definitions.create({
    id,
    name: 'Dependency upgrade',
    version: 1,
    sessionMode: 'per-stage',
    variables: [],
    tags: [],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  } as WorkflowDefinition);
}

async function makeRun(id: string, definitionId: string, status: WorkflowRun['status']): Promise<void> {
  await repos().runs.create({
    id,
    workflowDefinitionId: definitionId,
    name: `Dependency upgrade - Run 1790000000000`,
    status,
    sessionMode: 'per-stage',
    variables: {},
    createdAt: T0,
    updatedAt: T0,
    startedAt: T0,
  });
}

async function makeStage(
  id: string,
  runId: string,
  name: string,
  status: StageRun['status'],
  interruptData?: unknown,
): Promise<void> {
  const run = await repos().runs.getById(runId);
  await new DrizzleStageDefinitionRepository(db).create({
    id: `def-${id}`,
    workflowDefinitionId: run.workflowDefinitionId,
    name,
    order: 0,
    prompts: [],
    variables: {},
    hooks: [],
    createdAt: T0,
    updatedAt: T0,
  } as unknown as StageDefinition);
  await repos().stageRuns.create({
    id,
    workflowRunId: runId,
    stageDefinitionId: `def-${id}`,
    name,
    status,
    currentStep: 0,
    totalSteps: 1,
    retryCount: 0,
    version: 1,
    createdAt: T0,
    ...(interruptData !== undefined ? { interruptData } : {}),
  } as StageRun);
  if (interruptData !== undefined) {
    await repos().stageRuns.update(id, { interruptData } as Partial<StageRun>);
  }
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
    executions: r.executions,
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
    await makeProject('p1', 'Website');
    await makeChat('c-ask', { projectId: 'p1' });
    await makeChat('c-run');
    await makeChat('c-orch', { name: 'Orchestrator' });
    await makeChat('c-worker', { parentChatId: 'c-orch', name: 'Worker' } as Partial<Chat>);
    openGate('c-ask', 'tool_permission', { toolName: 'Bash', inputSummary: 'git push origin main' });
    openGate('c-worker', 'question', { questions: [{ id: 'q', header: 'h', question: 'Which branch?' }] });
    streaming.set('c-run', () => {});
    streaming.set('c-ask', () => {}); // blocked on its gate: Needs you only

    await makeDefinition('d1', { projectId: 'p1' });
    await makeRun('r-live', 'd1', 'running');
    await makeStage('s1', 'r-live', 'Scan', 'completed');
    await makeStage('s2', 'r-live', 'Plan upgrades', 'running');
    await makeStage('s3', 'r-live', 'Apply', 'pending');
    await makeRun('r-gate', 'd1', 'running');
    await makeStage('s4', 'r-gate', 'Apply upgrades', 'awaiting_input', {
      kind: 'stage_completion_review',
      reason: '14 packages, 3 majors',
    });
    await makeRun('r-paused', 'd1', 'paused');
    await makeRun('r-done', 'd1', 'completed');
    await makeAutomation('a1', 'p1');
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
      project: { id: 'p1', name: 'Website' },
      stoppable: true,
      ask: { kind: 'tool_permission', summary: 'Allow Bash?', detail: 'git push origin main', actions: ['allow_once', 'deny', 'open'] },
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
      project: { id: 'p1', name: 'Website' },
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
    const p1 = service.getSnapshot({ projectId: 'p1' });
    expect(p1.needsYou.every((i) => i.project?.id === 'p1')).toBe(true);
    expect(p1.counts.needsYou).toBe(p1.needsYou.length);
    expect(p1.running.map((i) => i.key).sort()).toEqual(['automation_execution:e-run', 'workflow_run:r-live']);
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

    // A tool step updates the label in place.
    await emitChat('c1', 'harness.tool_start', { tool: 'Bash', args: { command: 'pnpm build\n--filter web' } });
    await service.settled();
    expect(service.getSnapshot().running[0]!.progress).toEqual({ label: 'Running pnpm build' });

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
    await makeStage('s1', 'r1', 'Build', 'running');
    await startService().start();
    expect(service.getSnapshot().running.map((i) => i.key)).toEqual(['workflow_run:r1']);

    await repos().stageRuns.update('s1', { status: 'awaiting_input', interruptData: { prompt: 'Pick a version' } } as Partial<StageRun>);
    await bus.emitGlobal({ kind: 'stage_run.awaiting_input', data: { stageRunId: 's1', workflowRunId: 'r1' } } as AgentEvent);
    await service.settled();
    expect(service.getSnapshot().needsYou[0]).toMatchObject({
      key: 'workflow_run:r1:s1',
      ask: { kind: 'stage_input', summary: 'Answer “Build”', actions: ['answer', 'open'] },
    });

    await repos().runs.updateStatus('r1', 'completed');
    await bus.emitGlobal({ kind: 'workflow_run.completed', data: { workflowRunId: 'r1' } } as AgentEvent);
    await service.settled();
    expect(service.getSnapshot().needsYou).toEqual([]);
    expect(service.getSnapshot().running).toEqual([]);
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

describe('GET /api/attention', () => {
  beforeEach(async () => {
    await makeProject('p1', 'Website');
    await makeChat('c1', { projectId: 'p1' });
    await makeDefinition('d1');
    await makeRun('r1', 'd1', 'running');
    await makeStage('s1', 'r1', 'Apply', 'awaiting_input', { kind: 'tool_permission', request: { description: 'rm -rf dist' } });
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
    const res = await request(app(undefined)).get('/api/attention?projectId=p1');
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

  it('rejects an empty projectId', async () => {
    const res = await request(app(undefined)).get('/api/attention?projectId=');
    expect(res.status).toBe(400);
  });
});
