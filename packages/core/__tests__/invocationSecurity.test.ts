// ────────────────────────────────────────────────────────────────
// Invocation security and replay (final review CONVINV-R1, R6, R8, R16;
// AGENT-R3): the admin gate reads what resolution made of the request,
// agents never ride the loopback waiver, a fork takes no options it would
// drop, a retried multipart start replays, and only a person test-runs.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '@generatorai/shared';
import type { InvocationRequest, WorkflowGraph } from '@generatorai/workflow-spec';
import { validateInvocation } from '../src/services/workflow-invocation/validateInvocation.js';
import { WorkflowInvocationService } from '../src/services/workflow-invocation/WorkflowInvocationService.js';
import type { InvocationContext } from '../src/services/workflow-invocation/types.js';
import { IdempotencyService } from '../src/services/IdempotencyService.js';
import type { IIdempotencyKeyStore, IInvocationUploadRepository, InvocationUploadRecord } from '../src/domain/ports/IInvocationStores.js';
import { EventBus } from '../src/events/EventBus.js';
import { testGraph } from './MockRepositories.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const DEF = '22222222-2222-4222-8222-222222222222';
const PHONE_SCOPES = ['exec:agent', 'read:workflows', 'write:workflows'];

function phone(overrides: Partial<InvocationContext> = {}): InvocationContext {
  return {
    principal: { kind: 'device', id: 'phone-1', scopes: PHONE_SCOPES },
    trigger: { kind: 'user', client: 'mobile', principalId: 'phone-1' },
    loopback: false,
    ...overrides,
  };
}

function request(overrides: Partial<InvocationRequest> = {}): InvocationRequest {
  return { target: { kind: 'definition', workflowDefinitionId: DEF }, variables: {}, ...overrides } as InvocationRequest;
}

const deps = { posture: () => 'acceptEdits' as const, now: () => Date.now() };

function forkOf(permissionMode: WorkflowRun['permissionMode']): WorkflowRun {
  return { id: 'src', workflowDefinitionId: DEF, definitionVersionId: 'v1', name: 'src', status: 'completed', variables: {}, permissionMode, createdAt: new Date(), updatedAt: new Date() } as WorkflowRun;
}

describe('the admin gate on the resolved run (CONVINV-R1)', () => {
  const graph = testGraph(['build']);

  it('a phone cannot fork a bypass run into bypass: the HTTP ceiling holds the inherited mode', async () => {
    const req = request({ target: { kind: 'fork', sourceRunId: 'src', definition: 'pinned', workspace: 'fresh' } } as Partial<InvocationRequest>);
    const err = await validateInvocation(req, phone({ callerPermissionCeiling: 'acceptEdits' }), { workflowDefinitionId: DEF, graph, fork: forkOf('bypassPermissions') }, deps).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'PERMISSION_ESCALATION' });
  });

  it('a fork\'s inherited bypass needs admin:settings off loopback even without a ceiling', async () => {
    const req = request({ target: { kind: 'fork', sourceRunId: 'src', definition: 'pinned', workspace: 'fresh' } } as Partial<InvocationRequest>);
    const err = await validateInvocation(req, phone(), { workflowDefinitionId: DEF, graph, fork: forkOf('bypassPermissions') }, deps).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'FORBIDDEN_SCOPE' });
  });

  it('a definition that edits in place needs admin:settings; the plan only warns', async () => {
    const inPlace: WorkflowGraph = testGraph(['build'], [], { lifecycle: { useWorktree: false, codebaseAliases: ['main'] } });
    const req = request({ projectId: PROJECT });
    const err = await validateInvocation(req, phone(), { workflowDefinitionId: DEF, graph: inPlace }, deps).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'FORBIDDEN_SCOPE' });

    const plan = await validateInvocation(req, phone(), { workflowDefinitionId: DEF, graph: inPlace }, { ...deps, resolvedScopes: 'warning' });
    expect(plan.warnings.map((w) => w.code)).toContain('forbidden-scope');

    const admin = phone({ principal: { kind: 'device', id: 'phone-1', scopes: [...PHONE_SCOPES, 'admin:settings'] } });
    await expect(validateInvocation(req, admin, { workflowDefinitionId: DEF, graph: inPlace }, deps)).resolves.toMatchObject({ codebases: [{ alias: 'main', mode: 'in_place' }] });
  });

  it('a fork refuses the options it would drop (CONVINV-R16)', async () => {
    const req = request({
      target: { kind: 'fork', sourceRunId: 'src', definition: 'pinned', workspace: 'fresh' },
      overrides: { model: 'gpt-5' },
      budget: { maxTokens: 10 },
    } as Partial<InvocationRequest>);
    const err = await validateInvocation(req, phone(), { workflowDefinitionId: DEF, graph, fork: forkOf(undefined) }, deps).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((err as { issues: Array<{ code: string }> }).issues.map((i) => i.code)).toEqual(['fork-option', 'fork-option']);
  });
});

describe('loopback never waives bypass for an agent principal (AGENT-R3)', () => {
  const graph = testGraph(['build']);
  const bypass = request({ overrides: { permissionMode: 'bypassPermissions' } });

  it('an MCP device on loopback needs admin:settings; a person on loopback does not', async () => {
    const mcp = phone({ loopback: true, trigger: { kind: 'external_agent', via: 'mcp', principalId: 'phone-1' } });
    await expect(validateInvocation(bypass, mcp, { workflowDefinitionId: DEF, graph }, deps)).rejects.toMatchObject({ code: 'FORBIDDEN_SCOPE' });
    await expect(validateInvocation(bypass, phone({ loopback: true }), { workflowDefinitionId: DEF, graph }, deps)).resolves.toMatchObject({
      effectivePermissionMode: 'bypassPermissions',
    });
  });
});

// ── the service ──

function memoryIdempotency(): IIdempotencyKeyStore {
  const rows = new Map<string, { executionId: string; requestHash: string | null; createdAt: Date }>();
  return {
    async claim(r) {
      const k = `${r.scope}|${r.key}`;
      const e = rows.get(k);
      if (e) return { executionId: e.executionId, replay: true, requestHash: e.requestHash, createdAt: e.createdAt };
      rows.set(k, { executionId: r.executionId, requestHash: r.requestHash ?? null, createdAt: r.createdAt });
      return { executionId: r.executionId, replay: false, requestHash: r.requestHash ?? null };
    },
    async updateExecutionId(key, scope, executionId) {
      const e = rows.get(`${scope}|${key}`);
      if (e) e.executionId = executionId;
    },
    async release(key, scope) {
      rows.delete(`${scope}|${key}`);
    },
    async sweepExpired() {
      return 0;
    },
  };
}

function memoryUploads(): IInvocationUploadRepository & { rows: Map<string, InvocationUploadRecord> } {
  const rows = new Map<string, InvocationUploadRecord>();
  return {
    rows,
    async create(r) {
      rows.set(r.id, r);
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async markConsumed() {
      return true;
    },
    async listExpired() {
      return [];
    },
    async delete(id) {
      rows.delete(id);
    },
  };
}

async function service(status: 'draft' | 'published') {
  const graph = testGraph(['build']);
  const runs = new Map<string, WorkflowRun>();
  const createRun = vi.fn(async (r: Record<string, unknown>) => {
    const run = { ...r, id: `run-${runs.size + 1}`, status: 'created', createdAt: new Date(), updatedAt: new Date() } as unknown as WorkflowRun;
    runs.set(run.id, run);
    return run;
  });
  const uploads = memoryUploads();
  const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inv-'));
  const svc = new WorkflowInvocationService({
    runs: { createRun, startRun: vi.fn(), deleteRun: vi.fn(), assertPermissionGating: vi.fn() } as never,
    runRepo: { getById: async (id: string) => runs.get(id)!, findByIdempotencyKey: async () => null } as never,
    stageRuns: {} as never,
    definitions: {
      get: async () => ({ id: DEF, status, graph, currentVersionId: 'v1', archivedAt: null }),
      resolveVersionForRun: async () => 'v1',
    } as never,
    versions: { get: async () => graph } as never,
    eventBus: new EventBus(),
    idempotency: new IdempotencyService(memoryIdempotency()),
    uploads,
    uploadsDir,
  });
  return { svc, createRun, uploads, cleanup: () => fs.rm(uploadsDir, { recursive: true, force: true }) };
}

describe('WorkflowInvocationService', () => {
  it('a retried multipart start with the same key and files replays, staging the files once (CONVINV-R6)', async () => {
    const { svc, createRun, uploads, cleanup } = await service('published');
    try {
      const files = [{ category: 'skills' as const, name: 'a.md', data: new TextEncoder().encode('# skill') }];
      const ctx = phone({ idempotencyKey: 'k1', callerPermissionCeiling: 'acceptEdits' });
      const first = await svc.invoke(request(), ctx, files);
      const second = await svc.invoke(request(), ctx, files.map((f) => ({ ...f, data: new Uint8Array(f.data) })));
      expect(second).toMatchObject({ runId: first.runId, replayed: true });
      expect(createRun).toHaveBeenCalledTimes(1);
      expect(uploads.rows.size).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('only a person test-runs a draft: an MCP device (an external agent) cannot (CONVINV-R8)', async () => {
    const { svc, cleanup } = await service('draft');
    try {
      const testRun = request({ target: { kind: 'definition', workflowDefinitionId: DEF, testRun: true } } as Partial<InvocationRequest>);
      const mcp = phone({ trigger: { kind: 'external_agent', via: 'mcp', principalId: 'phone-1' }, callerPermissionCeiling: 'acceptEdits' });
      await expect(svc.invoke(testRun, mcp)).rejects.toMatchObject({ code: 'DRAFT_NOT_RUNNABLE' });
      await expect(svc.invoke(testRun, phone({ callerPermissionCeiling: 'acceptEdits' }))).resolves.toMatchObject({ replayed: false });
    } finally {
      await cleanup();
    }
  });
});
