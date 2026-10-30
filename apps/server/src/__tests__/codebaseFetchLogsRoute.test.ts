// ────────────────────────────────────────────────────────────────
// G-16 — codebase fetch/clone logs and live status.
//
// `POST .../fetch` now answers `202 { jobId }` instead of waiting for the
// whole git fetch; `GET .../logs` tails the in-memory ring buffer + job.
// The real git/CodebaseService wiring (streamTo, status transitions,
// codebase.status_changed) is covered end to end by
// `packages/core/src/services/__tests__/CodebaseService.fetchJob.test.ts`
// against a real dummy repo — this file is the HTTP contract only,
// against a mocked container (same style `projectSummaryRoute.test.ts` uses).
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { CodebaseJob, CodebaseLogsResponse, ProjectCodebase } from '@generatorai/shared';

import { createProjectRoutes } from '../routes/projects.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function codebase(overrides: Partial<ProjectCodebase> = {}): ProjectCodebase {
  return {
    id: 'cb1',
    projectId: 'proj-1',
    alias: 'app',
    type: 'git-remote',
    clonePath: '/tmp/cb1',
    status: 'ready',
    settings: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function job(overrides: Partial<CodebaseJob> = {}): CodebaseJob {
  return { id: 'job-1', kind: 'fetch', status: 'running', startedAt: NOW.toISOString(), ...overrides };
}

interface Deps {
  getCodebaseStatus?: ReturnType<typeof vi.fn>;
  startFetchJob?: ReturnType<typeof vi.fn>;
  getLogs?: ReturnType<typeof vi.fn>;
}

function makeApp(deps: Deps = {}) {
  const container = {
    projectService: {},
    codebaseService: {
      getCodebaseStatus: deps.getCodebaseStatus ?? vi.fn().mockResolvedValue(codebase()),
      startFetchJob: deps.startFetchJob ?? vi.fn().mockReturnValue(job()),
    },
    codebaseLogService: {
      getLogs: deps.getLogs ?? vi.fn().mockReturnValue({ lines: [], job: job() } satisfies CodebaseLogsResponse),
    },
    worktreeService: {},
    worktreeSizeService: {},
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
    workflowDefinitionService: {},
    workflowRunRepo: {},
    attentionService: {},
  };
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectRoutes(container as never));
  return app;
}

describe('POST /api/projects/:id/codebases/:cid/fetch', () => {
  it('answers 202 with the started job id', async () => {
    const startFetchJob = vi.fn().mockReturnValue(job({ id: 'job-42' }));
    const app = makeApp({ startFetchJob });
    const res = await request(app).post('/api/projects/proj-1/codebases/cb1/fetch');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ jobId: 'job-42' });
    expect(startFetchJob).toHaveBeenCalledWith('cb1');
  });

  it('propagates a not-found error instead of starting a job', async () => {
    const startFetchJob = vi.fn();
    const app = makeApp({
      getCodebaseStatus: vi.fn().mockRejectedValue(new Error('not found: cb1')),
      startFetchJob,
    });
    const res = await request(app).post('/api/projects/proj-1/codebases/cb1/fetch');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(startFetchJob).not.toHaveBeenCalled();
  });
});

describe('GET /api/projects/:id/codebases/:cid/logs', () => {
  it('returns the ring buffer + job as-is', async () => {
    const body: CodebaseLogsResponse = {
      lines: [{ ts: NOW.toISOString(), stream: 'stdout', text: 'Fetching origin' }],
      job: job({ status: 'succeeded', endedAt: NOW.toISOString() }),
    };
    const app = makeApp({ getLogs: vi.fn().mockReturnValue(body) });
    const res = await request(app).get('/api/projects/proj-1/codebases/cb1/logs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
  });

  it('passes a numeric `limit` through to the service', async () => {
    const getLogs = vi.fn().mockReturnValue({ lines: [] });
    const app = makeApp({ getLogs });
    await request(app).get('/api/projects/proj-1/codebases/cb1/logs?limit=50');
    expect(getLogs).toHaveBeenCalledWith('cb1', 50);
  });

  it('ignores a non-numeric limit and uses the service default', async () => {
    const getLogs = vi.fn().mockReturnValue({ lines: [] });
    const app = makeApp({ getLogs });
    await request(app).get('/api/projects/proj-1/codebases/cb1/logs?limit=nope');
    expect(getLogs).toHaveBeenCalledWith('cb1');
  });

  it('404s for an unknown codebase', async () => {
    const app = makeApp({ getCodebaseStatus: vi.fn().mockRejectedValue(new Error('not found')) });
    const res = await request(app).get('/api/projects/proj-1/codebases/nope/logs');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
