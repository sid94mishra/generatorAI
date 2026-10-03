// ────────────────────────────────────────────────────────────────
// G-13 — `?include=summary` on GET /projects and GET /projects/:id.
//
// Projects columns (Codebases, Active chats + Needs you, Last run,
// Worktrees) and the ProjectDetail tab counts. Every field comes from an
// existing read-only repository/service call — this test exercises the
// route's aggregation (counts, bucketing, "latest run" selection) with
// canned service responses, the same style `systemInfoRoute.test.ts` uses
// for G-12. `needsYou` / `running` must be OMITTED, never `0`, whenever the
// attention feed has not produced a snapshot yet (D-36).
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Chat, Project, WorkflowRun, WorktreeInfo } from '@generatorai/shared';
import type { WorkflowDefinitionSummary } from '@generatorai/workflow-spec';

import { createProjectRoutes } from '../routes/projects.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Demo',
    settings: {},
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
    name: 'Chat',
    sessionId: 'sess-1',
    tags: [],
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Chat;
}

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

function definition(overrides: Partial<WorkflowDefinitionSummary> = {}): WorkflowDefinitionSummary {
  return {
    id: 'def-1',
    name: 'Nightly audit',
    projectId: 'proj-1',
    status: 'published',
    revision: 1,
    currentVersionId: 'ver-1',
    tags: [],
    stageCount: 0,
    needsAttention: false,
    agentAuthored: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowDefinitionId: 'def-1',
    name: 'Run 1',
    status: 'completed',
    definitionVersionId: 'ver-1',
    variables: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as WorkflowRun;
}

interface Deps {
  codebases?: unknown[];
  chats?: Chat[];
  worktrees?: WorktreeInfo[];
  definitions?: WorkflowDefinitionSummary[];
  runsByDefinition?: Record<string, WorkflowRun[]>;
  attentionAvailable?: boolean;
  attentionCounts?: { needsYou: number; running: number };
}

function makeApp(deps: Deps = {}) {
  const runsByDefinition = deps.runsByDefinition ?? {};
  const container = {
    projectService: {
      listProjects: vi.fn().mockResolvedValue([project()]),
      getProjectWithCodebases: vi.fn().mockResolvedValue({ ...project(), codebases: [] }),
    },
    codebaseService: { getByProjectId: vi.fn().mockResolvedValue(deps.codebases ?? []) },
    worktreeService: { listWorktrees: vi.fn().mockResolvedValue(deps.worktrees ?? []) },
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
    chatEntityRepo: { getByProjectId: vi.fn().mockResolvedValue(deps.chats ?? []) },
    workflowDefinitionService: { list: vi.fn().mockResolvedValue({ items: deps.definitions ?? [] }) },
    workflowRunRepo: {
      getByDefinitionId: vi.fn((definitionId: string) => Promise.resolve(runsByDefinition[definitionId] ?? [])),
    },
    attentionService: {
      isAvailable: vi.fn().mockReturnValue(deps.attentionAvailable ?? false),
      getSnapshot: vi.fn().mockReturnValue({
        needsYou: new Array(deps.attentionCounts?.needsYou ?? 0).fill({}),
        running: new Array(deps.attentionCounts?.running ?? 0).fill({}),
      }),
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectRoutes(container as never));
  return app;
}

describe('GET /api/projects?include=summary', () => {
  it('omits summary by default', async () => {
    const res = await request(makeApp()).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body[0].summary).toBeUndefined();
  });

  it('reports codebases, active chats, worktree buckets and the latest run', async () => {
    const app = makeApp({
      codebases: [{}, {}],
      // c3 is an orchestrator's worker: hidden from chat lists, so not counted.
      chats: [chat({ id: 'c1', status: 'active' }), chat({ id: 'c2', status: 'archived' }), chat({ id: 'c3', status: 'active', parentChatId: 'c1' })],
      worktrees: [
        worktree({ id: 'wt-active', status: 'active' }),
        worktree({ id: 'wt-orphaned', status: 'orphaned' }),
        worktree({ id: 'wt-done', status: 'completed' }),
      ],
      definitions: [definition({ id: 'def-1' })],
      runsByDefinition: {
        'def-1': [
          run({ id: 'run-old', completedAt: new Date('2025-12-01T00:00:00Z') }),
          run({ id: 'run-new', status: 'failed', completedAt: new Date('2025-12-31T00:00:00Z') }),
        ],
      },
    });
    const res = await request(app).get('/api/projects?include=summary');
    expect(res.status).toBe(200);
    const summary = res.body[0].summary;
    expect(summary.codebases).toBe(2);
    expect(summary.activeChats).toBe(1);
    expect(summary.worktrees).toEqual({ active: 1, orphaned: 1 });
    expect(summary.runs).toBe(2);
    expect(summary.lastRun).toMatchObject({
      runId: 'run-new',
      definitionId: 'def-1',
      name: 'Nightly audit',
      status: 'failed',
    });
    // Omitted while the attention feed is unavailable — never invented 0s.
    expect(summary.needsYou).toBeUndefined();
    expect(summary.running).toBeUndefined();
  });

  it('includes needsYou/running once the attention feed is available', async () => {
    const app = makeApp({ attentionAvailable: true, attentionCounts: { needsYou: 1, running: 2 } });
    const res = await request(app).get('/api/projects?include=summary');
    expect(res.body[0].summary.needsYou).toBe(1);
    expect(res.body[0].summary.running).toBe(2);
  });

  it('tolerates a project with zero definitions and zero runs (empty run history)', async () => {
    const app = makeApp({ definitions: [] });
    const res = await request(app).get('/api/projects?include=summary');
    const summary = res.body[0].summary;
    expect(summary.runs).toBe(0);
    expect(summary.lastRun).toBeUndefined();
  });
});

describe('GET /api/projects/:id?include=summary', () => {
  it('attaches the same summary shape to the single-project response', async () => {
    const app = makeApp({ codebases: [{}] });
    const res = await request(app).get('/api/projects/proj-1?include=summary');
    expect(res.status).toBe(200);
    expect(res.body.summary.codebases).toBe(1);
  });
});
