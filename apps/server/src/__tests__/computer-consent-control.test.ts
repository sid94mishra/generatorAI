// ────────────────────────────────────────────────────────────────
// G-07 — the consent card's plan and "this app / any app" scope, and
// Pause agent / Take over, through the real routes, a REAL ComputerService,
// PendingConsentStore and grant repository on a temp SQLite database. Only the
// desktop driver is faked (no computer-use host in a test).
//
// Pinned:
//   - an agent action parks on a prompt that GET /consent lists; POST /consent
//     with `scope: 'any'` + always_allow stores a `*` grant (GET /grants) that
//     then covers a different app without asking;
//   - `computer_run_steps` style plans reach the pending row as `plan`;
//   - POST /control paused|user refuses the agent (agent_paused /
//     user_in_control), emits computer.control_changed on the workspace
//     scope, GET /control reads it back, agent hands control back;
//   - bad bodies are 400, an answer to nothing is 409.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputerService, EventBus, NullComputerBridge, PendingConsentStore } from '@generatorai/core';
import type { ActionRequest, ComputerAppIdentity, ComputerHandle, IComputerBridge } from '@generatorai/core';
import { closeDB, createDB, DrizzleComputerUseRepository, executionWorkspaces, migrateDB, type AppDatabase } from '@generatorai/db';
import { AppConfigSchema, type AgentEvent, type ComputerActionResult, type ILogger } from '@generatorai/shared';

import { createComputerRoutes } from '../routes/computer.js';

const WS = 'ws-g07';
const CTX = { workspaceId: WS, workspaceRoot: '/tmp/ws-g07', chatId: 'chat-1' };
const APPS = [
  { id: 'com.example.inspector', name: 'Queue Inspector', pid: 41 },
  { id: 'com.example.other', name: 'Other', pid: 42 },
];

/** A driver that answers everything; the point here is consent and control, not driving. */
class FakeBridge implements Partial<IComputerBridge> {
  readonly id = 'fake';
  actCalls: ActionRequest[] = [];
  async isAvailable() { return true; }
  async runtime() { return { provider: this.id, host: 'in-process' as const, state: 'ready' as const }; }
  async capabilities() {
    return { platform: 'darwin', provider: 'fake', providerVersion: '1', supports: {}, limitations: [] } as never;
  }
  async start(opts: { workspaceId: string }): Promise<ComputerHandle> {
    return { workspaceId: opts.workspaceId, provider: this.id, providerVersion: '1', hostRef: 'fake', operational: true };
  }
  async stop() {}
  async listApps() {
    return { apps: APPS.map((a) => ({ ...a, frontmost: false, windowCount: 1 })) };
  }
  async listWindows() {
    return { windows: [{ id: 1, title: 'Main', index: 0, focused: true, minimised: false }] };
  }
  async snapshot(_h: ComputerHandle, req: { app: ComputerAppIdentity }): Promise<ComputerActionResult> {
    return {
      ok: true,
      screenshot: null,
      snapshot: {
        snapshotId: `snap-${req.app.appId}`,
        app: { id: req.app.appId, name: req.app.name, pid: req.app.pid },
        window: { id: 1, title: 'Main', index: 0, focused: true },
        elements: [],
        truncated: null,
        capturedAt: Date.now(),
      },
    } as unknown as ComputerActionResult;
  }
  async act(_h: ComputerHandle, req: ActionRequest): Promise<ComputerActionResult> {
    this.actCalls.push(req);
    return { ok: true, snapshot: null, screenshot: null, action: { path: 'synthetic' } } as ComputerActionResult;
  }
}

let dir: string;
let db: AppDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'generatorai-g07-'));
  db = createDB(join(dir, 'server.db'));
  migrateDB(db);
  // Grants belong to a real execution workspace (foreign key).
  const now = new Date();
  db.insert(executionWorkspaces)
    .values({ id: WS, ownerType: 'chat', ownerId: 'chat-1', rootPath: join(dir, 'ws'), status: 'active', createdAt: now, updatedAt: now })
    .run();
  delete process.env['GENERATORAI_COMPUTER_USE'];
});

afterEach(() => {
  closeDB(db);
  rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;
  const eventBus = new EventBus();
  const computerUseRepo = new DrizzleComputerUseRepository(db);
  const computerConsentStore = new PendingConsentStore(computerUseRepo, eventBus, logger);
  const bridge = new FakeBridge();
  const computerService = new ComputerService(
    { create: async () => undefined } as never,
    eventBus,
    logger,
    computerConsentStore,
    { record: (entry) => computerUseRepo.recordAudit(entry) },
    { ...AppConfigSchema.parse({}).computerUse, enabled: true, allowSyntheticFallback: true, consentTtlSeconds: 30 },
    [bridge as unknown as IComputerBridge, new NullComputerBridge()],
  );
  const events: AgentEvent[] = [];
  eventBus.subscribe(`computer:${WS}`, (e) => events.push(e as unknown as AgentEvent));

  const app = express();
  app.use(express.json());
  app.use(
    '/api/workspaces/:id/computer',
    createComputerRoutes({
      workspaceArtifactRepo: {},
      workspaceManager: {},
      computerService,
      computerUseRepo,
      computerConsentStore,
      screenCast: {},
      logger,
    } as never),
  );
  return { app, computerService, bridge, events };
}

async function waitForPending(app: express.Express) {
  for (let i = 0; i < 100; i += 1) {
    const res = await request(app).get(`/api/workspaces/${WS}/computer/consent`).expect(200);
    if (res.body.pending.length > 0) return res.body.pending as Array<Record<string, unknown>>;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('no prompt appeared');
}

describe('G-07 consent scope over the routes', () => {
  it('an always_allow for ANY app stores a * grant that covers another app without asking', async () => {
    const { app, computerService } = setup();
    const first = computerService.snapshot(CTX, { by: 'appId', appId: APPS[0]!.id });
    const [pending] = await waitForPending(app);
    expect(pending).toMatchObject({ workspaceId: WS, chatId: 'chat-1', appIdentity: APPS[0]!.id, appLabel: 'Queue Inspector' });

    const answer = await request(app)
      .post(`/api/workspaces/${WS}/computer/consent`)
      .send({ requestId: pending!['requestId'], appIdentity: APPS[0]!.id, decision: 'always_allow', scope: 'any' })
      .expect(200);
    expect(answer.body).toEqual({ ok: true, requestId: pending!['requestId'], decision: 'always_allow', scope: 'any' });
    expect((await first).refusal).toBeUndefined();

    const grants = await request(app).get(`/api/workspaces/${WS}/computer/grants`).expect(200);
    expect(grants.body.grants).toEqual([
      expect.objectContaining({ appIdentity: '*', appLabel: 'Any app', decision: 'always_allow', scope: 'read' }),
    ]);

    // A different app: covered by the any-app grant, no new prompt.
    expect((await computerService.snapshot(CTX, { by: 'appId', appId: APPS[1]!.id })).refusal).toBeUndefined();
    expect((await request(app).get(`/api/workspaces/${WS}/computer/consent`)).body.pending).toEqual([]);

    // Revoking it (the "*" identity, URL-encoded) makes the next read ask again.
    await request(app).delete(`/api/workspaces/${WS}/computer/grants/${encodeURIComponent('*')}`).expect(200);
    expect((await request(app).get(`/api/workspaces/${WS}/computer/grants`)).body.grants).toEqual([]);
  });

  it('omitted scope keeps the decision’s own reach; a deny answers for the app only', async () => {
    const { app, computerService } = setup();
    const pendingRead = computerService.snapshot(CTX, { by: 'appId', appId: APPS[0]!.id });
    const [p] = await waitForPending(app);
    const res = await request(app)
      .post(`/api/workspaces/${WS}/computer/consent`)
      .send({ requestId: p!['requestId'], appIdentity: APPS[0]!.id, decision: 'deny', scope: 'any' })
      .expect(200);
    expect(res.body.scope).toBe('app');
    expect((await pendingRead).refusal?.code).toBe('consent_denied');
  });

  it('a batched plan reaches the pending row, one answer runs every step', async () => {
    const { app, computerService, bridge } = setup();
    const target = { app: { appId: '', name: '', pid: 0 }, window: { by: 'focused' as const } };
    const run = computerService.actPlan(CTX, { by: 'appId', appId: APPS[0]!.id }, [
      { type: 'clickPoint', target, x: 5, y: 6 },
      { type: 'typeText', target, text: 'queue-7' },
      { type: 'pressKey', target, key: 'Enter' },
    ]);
    const [p] = await waitForPending(app);
    expect(p).toMatchObject({ summary: '3 actions in Queue Inspector', path: 'synthetic' });
    expect((p!['plan'] as Array<{ action: string }>).map((s) => s.action)).toEqual(['clickPoint', 'typeText', 'pressKey']);
    await request(app)
      .post(`/api/workspaces/${WS}/computer/consent`)
      .send({ requestId: p!['requestId'], appIdentity: APPS[0]!.id, decision: 'allow_once' })
      .expect(200);
    expect((await run).ok).toBe(true);
    expect(bridge.actCalls.map((c) => c.type)).toEqual(['clickPoint', 'typeText', 'pressKey']);
  });

  it('rejects a bad scope and an answer to nothing', async () => {
    const { app } = setup();
    await request(app)
      .post(`/api/workspaces/${WS}/computer/consent`)
      .send({ requestId: 'r', appIdentity: 'a', decision: 'allow_once', scope: 'everything' })
      .expect(400);
    const gone = await request(app)
      .post(`/api/workspaces/${WS}/computer/consent`)
      .send({ requestId: 'r', appIdentity: 'a', decision: 'allow_once', scope: 'app' })
      .expect(409);
    expect(gone.body.error.code).toBe('NOT_PENDING');
  });
});

describe('G-07 Pause agent / Take over over the routes', () => {
  it('pauses, takes over and hands back, with the event and the agent refused meanwhile', async () => {
    const { app, computerService, events } = setup();
    expect((await request(app).get(`/api/workspaces/${WS}/computer/control`).expect(200)).body).toEqual({
      workspaceId: WS,
      mode: 'agent',
      changedAt: null,
    });

    const paused = await request(app).post(`/api/workspaces/${WS}/computer/control`).send({ mode: 'paused' }).expect(200);
    expect(paused.body).toMatchObject({ workspaceId: WS, mode: 'paused', changedAt: expect.any(Number) });
    expect((await computerService.snapshot(CTX, { by: 'appId', appId: APPS[0]!.id })).refusal?.code).toBe('agent_paused');

    await request(app).post(`/api/workspaces/${WS}/computer/control`).send({ mode: 'user' }).expect(200);
    expect((await computerService.listApps(CTX)).refusal?.code).toBe('user_in_control');
    expect((await request(app).get(`/api/workspaces/${WS}/computer/control`)).body.mode).toBe('user');

    await request(app).post(`/api/workspaces/${WS}/computer/control`).send({ mode: 'agent' }).expect(200);
    expect((await computerService.listApps(CTX)).refusal).toBeUndefined();

    const changes = events.filter((e) => e.kind === 'computer.control_changed').map((e) => e.data);
    expect(changes).toEqual([
      expect.objectContaining({ workspaceId: WS, mode: 'paused', previous: 'agent' }),
      expect.objectContaining({ workspaceId: WS, mode: 'user', previous: 'paused' }),
      expect.objectContaining({ workspaceId: WS, mode: 'agent', previous: 'user' }),
    ]);
  });

  it('rejects an unknown mode', async () => {
    const { app } = setup();
    await request(app).post(`/api/workspaces/${WS}/computer/control`).send({ mode: 'robot' }).expect(400);
  });
});
