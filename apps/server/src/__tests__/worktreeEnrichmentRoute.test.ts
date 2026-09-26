// ────────────────────────────────────────────────────────────────
// G-17 — worktree enrichment: `GET .../worktrees?include=usage,link` adds
// `sizeBytes`, `link` and `expiresAt` per item plus a `totalBytes`/
// `reclaimableBytes` list summary. Bare (no `include`) stays the plain
// array — the legacy CodebaseDetailPage calls it that way and must keep
// working unchanged.
//
// Real disk-usage math is covered by
// `packages/core/src/services/__tests__/WorktreeSizeService.test.ts`
// (real temp dirs); this is the route's aggregation + link-resolution
// logic, against a mocked container.
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Chat, Project, WorkflowDefinition, WorkflowRun, WorktreeInfo } from '@generatorai/shared';

import { createProjectRoutes } from '../routes/projects.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function worktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id: 'wt-1',
    projectId: 'proj-1',
    codebaseId: 'cb-1',
    worktreePath: '/tmp/wt-1',
    branchName: 'main',
    status: 'active',
    createdAt: NOW,
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Demo',
    settings: { worktreeRetention: 'hours-24' },
    rootPath: '/tmp/demo',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    name: 'My chat',
    sessionId: 'sess-1',
    tags: [],
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Chat;
}

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowDefinitionId: 'def-1',
    name: 'Run 1',
    status: 'running',
    sessionMode: 'single',
    variables: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as WorkflowRun;
}

function definition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'def-1',
    name: 'Nightly audit',
    projectId: 'proj-1',
    stages: [],
    edges: [],
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as WorkflowDefinition;
}

interface Deps {
  worktrees?: WorktreeInfo[];
  project?: Project;
  chats?: Record<string, Chat>;
  runs?: Record<string, WorkflowRun>;
  definitions?: Record<string, WorkflowDefinition>;
  sizes?: Record<string, number>;
}

function makeApp(deps: Deps = {}) {
  const sizes = deps.sizes ?? {};
  const container = {
    projectService: {
      getProject: vi.fn().mockResolvedValue(deps.project ?? project()),
    },
    codebaseService: {},
    worktreeService: {
      listWorktreesByCodebase: vi.fn().mockResolvedValue(deps.worktrees ?? [worktree()]),
    },
    worktreeSizeService: {
      requestMeasurement: vi.fn(),
      getCachedSizeBytes: vi.fn((id: string) => sizes[id]),
    },
    worktreeCleanupService: {},
    projectConfigService: {},
    systemArtifactService: {},
    artifactCatalog: {},
    security: { secretStore: {} },
    sourceControlRegistry: {},
    repoReadinessService: {},
    chatManagementService: {},
    chatListInvalidator: {},
    gitManager: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    chatEntityRepo: {
      getById: vi.fn((id: string) => {
        const found = deps.chats?.[id];
        return found ? Promise.resolve(found) : Promise.reject(new Error('not found'));
      }),
    },
    workflowDefinitionService: {
      getDefinition: vi.fn((id: string) => {
        const found = deps.definitions?.[id];
        return found ? Promise.resolve(found) : Promise.reject(new Error('not found'));
      }),
    },
    workflowRunRepo: {
      getById: vi.fn((id: string) => {
        const found = deps.runs?.[id];
        return found ? Promise.resolve(found) : Promise.reject(new Error('not found'));
      }),
    },
    attentionService: {},
  };
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectRoutes(container as never));
  return app;
}

describe('GET /api/projects/:id/codebases/:cid/worktrees', () => {
  it('bare call returns the plain array — unchanged for the legacy page', async () => {
    const app = makeApp({ worktrees: [worktree({ id: 'wt-1' }), worktree({ id: 'wt-2' })] });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb-1/worktrees');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].sizeBytes).toBeUndefined();
  });

  it('?include=usage adds sizeBytes only for measured items, and computes the summary', async () => {
    const app = makeApp({
      worktrees: [
        worktree({ id: 'wt-active', status: 'active' }),
        worktree({ id: 'wt-orphaned', status: 'orphaned' }),
        worktree({ id: 'wt-unmeasured', status: 'active' }),
      ],
      sizes: { 'wt-active': 1000, 'wt-orphaned': 500 },
    });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb-1/worktrees?include=usage');
    expect(res.status).toBe(200);
    const byId = new Map(res.body.items.map((i: { id: string }) => [i.id, i]));
    expect((byId.get('wt-active') as { sizeBytes?: number }).sizeBytes).toBe(1000);
    expect((byId.get('wt-orphaned') as { sizeBytes?: number }).sizeBytes).toBe(500);
    expect((byId.get('wt-unmeasured') as { sizeBytes?: number }).sizeBytes).toBeUndefined(); // never a fake 0
    expect(res.body.totalBytes).toBe(1500);
    expect(res.body.reclaimableBytes).toBe(500); // only the non-active one
  });

  it('omits totalBytes/reclaimableBytes entirely when nothing has been measured yet', async () => {
    const app = makeApp({ worktrees: [worktree()], sizes: {} });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb-1/worktrees?include=usage');
    expect(res.body.totalBytes).toBeUndefined();
    expect(res.body.reclaimableBytes).toBeUndefined();
  });

  it('?include=usage adds expiresAt from the project retention policy', async () => {
    const created = new Date('2026-01-01T00:00:00.000Z');
    const app = makeApp({
      worktrees: [worktree({ id: 'wt-1', createdAt: created })],
      project: project({ settings: { worktreeRetention: 'hours-24' } }),
    });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb-1/worktrees?include=usage');
    const item = res.body.items[0];
    expect(item.expiresAt).toBe(new Date(created.getTime() + 24 * 60 * 60 * 1000).toISOString());
  });

  it('omits expiresAt under manual retention (never expires)', async () => {
    const app = makeApp({
      worktrees: [worktree({ id: 'wt-1' })],
      project: project({ settings: { worktreeRetention: 'manual' } }),
    });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb-1/worktrees?include=usage');
    expect(res.body.items[0].expiresAt).toBeUndefined();
  });

  it('?include=link resolves a chat-mounted worktree (runType: manual)', async () => {
    const app = makeApp({
      worktrees: [worktree({ id: 'wt-1', runId: 'chat-1', runType: 'manual' })],
      chats: { 'chat-1': chat({ id: 'chat-1', name: 'My chat', status: 'active' }) },
    });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb-1/worktrees?include=link');
    expect(res.body.items[0].link).toEqual({ entity: 'chat', id: 'chat-1', title: 'My chat', status: 'active' });
  });

  it('?include=link resolves a workflow-run worktree, preferring the live definition name', async () => {
    const app = makeApp({
      worktrees: [worktree({ id: 'wt-1', runId: 'run-1', runType: 'workflow' })],
      runs: { 'run-1': run({ id: 'run-1', workflowDefinitionId: 'def-1', status: 'running' }) },
      definitions: { 'def-1': definition({ id: 'def-1', name: 'Nightly audit (renamed)' }) },
    });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb-1/worktrees?include=link');
    expect(res.body.items[0].link).toEqual({
      entity: 'workflow_run',
      id: 'run-1',
      title: 'Nightly audit (renamed)',
      status: 'running',
    });
  });

  it('omits link when the owning chat/run no longer exists (never invented)', async () => {
    const app = makeApp({ worktrees: [worktree({ id: 'wt-1', runId: 'gone', runType: 'manual' })] });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb-1/worktrees?include=link');
    expect(res.body.items[0].link).toBeUndefined();
  });

  it('omits link for a worktree with no runId', async () => {
    const app = makeApp({ worktrees: [worktree({ id: 'wt-1' })] });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb-1/worktrees?include=link');
    expect(res.body.items[0].link).toBeUndefined();
  });

  it('combines usage and link together', async () => {
    const app = makeApp({
      worktrees: [worktree({ id: 'wt-1', runId: 'chat-1', runType: 'manual' })],
      chats: { 'chat-1': chat() },
      sizes: { 'wt-1': 42 },
    });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb-1/worktrees?include=usage,link');
    expect(res.body.items[0].sizeBytes).toBe(42);
    expect(res.body.items[0].link.entity).toBe('chat');
  });
});
