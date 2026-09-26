// ────────────────────────────────────────────────────────────────
// G-15 — `GET /api/projects/:id/runs`: the ProjectDetail Runs tab.
//
// `WorkflowRun` carries no `projectId` of its own, so this joins through
// `workflowDefinitionService.listDefinitions(projectId)` and reads each
// definition's runs with `workflowRunRepo.getByDefinitionId` — both
// existing read-only calls; `apps/server/src/routes/workflowRuns.ts`
// (Workflow-Overhaul-owned engine code) is never touched. This test
// exercises paging, status filtering and the "tolerate empty run history"
// requirement (05-gap-matrix.md §G-15, 07-phases.md §P2 note) with canned
// service responses, the same style `projectSummaryRoute.test.ts` uses.
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition, WorkflowRun } from '@generatorai/shared';

import { createProjectRoutes } from '../routes/projects.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

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

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowDefinitionId: 'def-1',
    name: 'Run',
    status: 'completed',
    sessionMode: 'single',
    variables: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as WorkflowRun;
}

function makeApp(opts: {
  definitions?: WorkflowDefinition[];
  runsByDefinition?: Record<string, WorkflowRun[]>;
} = {}) {
  const runsByDefinition = opts.runsByDefinition ?? {};
  const container = {
    projectService: {},
    codebaseService: {},
    worktreeService: {},
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
    chatEntityRepo: {},
    workflowDefinitionService: { listDefinitions: vi.fn().mockResolvedValue(opts.definitions ?? []) },
    workflowRunRepo: {
      getByDefinitionId: vi.fn((definitionId: string) => Promise.resolve(runsByDefinition[definitionId] ?? [])),
    },
    attentionService: {},
  };
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectRoutes(container as never));
  return app;
}

describe('GET /api/projects/:id/runs', () => {
  it('tolerates a project with no workflow definitions (empty run history)', async () => {
    const app = makeApp({ definitions: [] });
    const res = await request(app).get('/api/projects/proj-1/runs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('joins through the definition and orders newest first by startedAt', async () => {
    const app = makeApp({
      definitions: [definition()],
      runsByDefinition: {
        'def-1': [
          run({ id: 'run-old', startedAt: new Date('2025-12-01T00:00:00Z') }),
          run({ id: 'run-new', startedAt: new Date('2025-12-31T00:00:00Z') }),
        ],
      },
    });
    const res = await request(app).get('/api/projects/proj-1/runs');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((r: { id: string }) => r.id)).toEqual(['run-new', 'run-old']);
    expect(res.body.items[0].definitionName).toBe('Nightly audit');
    expect(res.body.nextCursor).toBeNull();
  });

  it('filters by status (any-of, comma-separated)', async () => {
    const app = makeApp({
      definitions: [definition()],
      runsByDefinition: {
        'def-1': [
          run({ id: 'run-ok', status: 'completed' }),
          run({ id: 'run-bad', status: 'failed' }),
          run({ id: 'run-live', status: 'running' }),
        ],
      },
    });
    const res = await request(app).get('/api/projects/proj-1/runs?status=completed,failed');
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((r: { id: string }) => r.id).sort()).toEqual(['run-bad', 'run-ok']);
  });

  it('rejects an invalid status value', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/projects/proj-1/runs?status=bogus');
    expect(res.status).toBe(400);
  });

  it('pages with cursor + limit and rejects an unknown cursor', async () => {
    const app = makeApp({
      definitions: [definition()],
      runsByDefinition: {
        'def-1': [
          run({ id: 'run-1', startedAt: new Date('2025-12-01T00:00:00Z') }),
          run({ id: 'run-2', startedAt: new Date('2025-12-02T00:00:00Z') }),
          run({ id: 'run-3', startedAt: new Date('2025-12-03T00:00:00Z') }),
        ],
      },
    });

    const page1 = await request(app).get('/api/projects/proj-1/runs?limit=2');
    expect(page1.body.items.map((r: { id: string }) => r.id)).toEqual(['run-3', 'run-2']);
    expect(page1.body.nextCursor).toBe('run-2');
    expect(page1.body.total).toBe(3);

    const page2 = await request(app).get(`/api/projects/proj-1/runs?limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items.map((r: { id: string }) => r.id)).toEqual(['run-1']);
    expect(page2.body.nextCursor).toBeNull();

    const bad = await request(app).get('/api/projects/proj-1/runs?cursor=does-not-exist');
    expect(bad.status).toBe(400);
  });
});
