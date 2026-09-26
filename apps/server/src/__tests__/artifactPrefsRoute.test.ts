// ────────────────────────────────────────────────────────────────
// G-19 — per-project artifact enable/disable, server-side.
//
// `GET`/`PUT /projects/:id/artifact-prefs` are stored inline on the
// project's existing JSON `settings` column (no migration, G-13
// precedent). This also covers the `/available-artifacts` filtering.
// Catalog-side enforcement (skills/MCP) is
// `packages/core/src/services/__tests__/ArtifactCatalog.disabledPrefs.test.ts`.
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@generatorai/shared';

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

interface Deps {
  project?: Project;
  updateProject?: ReturnType<typeof vi.fn>;
  availableArtifacts?: unknown[];
}

function makeApp(deps: Deps = {}) {
  const store = { project: deps.project ?? project() };
  const container = {
    projectService: {
      getProject: vi.fn(async () => store.project),
      updateProject: deps.updateProject ?? vi.fn(async (_id: string, updates: { settings?: Record<string, unknown> }) => {
        store.project = { ...store.project, settings: { ...store.project.settings, ...updates.settings } };
        return store.project;
      }),
    },
    codebaseService: {},
    worktreeService: {},
    worktreeSizeService: {},
    worktreeCleanupService: {},
    projectConfigService: { listConfigs: vi.fn().mockResolvedValue([]) },
    systemArtifactService: { getAvailableArtifacts: vi.fn().mockResolvedValue(deps.availableArtifacts ?? []) },
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

describe('GET /api/projects/:id/artifact-prefs', () => {
  it('answers an empty disabled list for a project with no prefs', async () => {
    const res = await request(makeApp()).get('/api/projects/proj-1/artifact-prefs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ disabled: [] });
  });

  it('reflects the stored prefs', async () => {
    const app = makeApp({ project: project({ settings: { disabledArtifacts: [{ type: 'skill', id: 's1' }] } }) });
    const res = await request(app).get('/api/projects/proj-1/artifact-prefs');
    expect(res.body).toEqual({ disabled: [{ type: 'skill', id: 's1' }] });
  });
});

describe('PUT /api/projects/:id/artifact-prefs', () => {
  it('saves the disabled set and echoes it back', async () => {
    const app = makeApp();
    const res = await request(app)
      .put('/api/projects/proj-1/artifact-prefs')
      .send({ disabled: [{ type: 'mcp', id: 'm1' }, { type: 'agent', id: 'a1' }] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ disabled: [{ type: 'mcp', id: 'm1' }, { type: 'agent', id: 'a1' }] });
  });

  it('replaces (does not merge) on a second write', async () => {
    const app = makeApp({ project: project({ settings: { disabledArtifacts: [{ type: 'skill', id: 'old' }] } }) });
    const res = await request(app)
      .put('/api/projects/proj-1/artifact-prefs')
      .send({ disabled: [{ type: 'prompt', id: 'p1' }] });
    expect(res.body).toEqual({ disabled: [{ type: 'prompt', id: 'p1' }] });
  });

  it('400s when `disabled` is not an array', async () => {
    const res = await request(makeApp()).put('/api/projects/proj-1/artifact-prefs').send({ disabled: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400s on an entry with an unknown type', async () => {
    const res = await request(makeApp())
      .put('/api/projects/proj-1/artifact-prefs')
      .send({ disabled: [{ type: 'workflow', id: 'w1' }] });
    expect(res.status).toBe(400);
  });

  it('400s on an entry with no id', async () => {
    const res = await request(makeApp())
      .put('/api/projects/proj-1/artifact-prefs')
      .send({ disabled: [{ type: 'skill' }] });
    expect(res.status).toBe(400);
  });

  it('empties the set cleanly', async () => {
    const app = makeApp({ project: project({ settings: { disabledArtifacts: [{ type: 'skill', id: 's1' }] } }) });
    const res = await request(app).put('/api/projects/proj-1/artifact-prefs').send({ disabled: [] });
    expect(res.body).toEqual({ disabled: [] });
  });
});

describe('GET /api/projects/:id/available-artifacts respects disabled prefs', () => {
  it('hides a disabled agent/prompt/skill artifact from the merged list', async () => {
    const app = makeApp({
      project: project({ settings: { disabledArtifacts: [{ type: 'skill', id: 'skill-1' }] } }),
      availableArtifacts: [
        { id: 'skill-1', type: 'skill', name: 'Hidden', source: 'system', metadata: {} },
        { id: 'skill-2', type: 'skill', name: 'Visible', source: 'system', metadata: {} },
      ],
    });
    const res = await request(app).get('/api/projects/proj-1/available-artifacts');
    expect(res.body.map((a: { id: string }) => a.id)).toEqual(['skill-2']);
  });

  it('passes everything through when nothing is disabled', async () => {
    const app = makeApp({
      availableArtifacts: [{ id: 'skill-1', type: 'skill', name: 'A', source: 'system', metadata: {} }],
    });
    const res = await request(app).get('/api/projects/proj-1/available-artifacts');
    expect(res.body).toHaveLength(1);
  });
});
