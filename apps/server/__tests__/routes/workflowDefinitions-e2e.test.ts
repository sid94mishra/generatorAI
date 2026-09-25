// ────────────────────────────────────────────────────────────────
// E2E: Workflow Definition API Flow — Integration Tests (P9.2, P01 WP-1.7)
//
// Definitions are whole v2 documents: create from a graph, save the graph
// back with optimistic concurrency, publish, export, delete-or-archive.
// The first block checks route wiring against the mock container; the
// second runs the real WorkflowDefinitionService on an in-memory database
// so the status codes (409/422/403) and the archive rule are real.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ALL_SCOPES, type Principal } from '@generatorai/auth';
import { WorkflowDefinitionService, type TemplateRegistry } from '@generatorai/core';
import { createDB, migrateDB, SqliteWorkflowDefinitionStore } from '@generatorai/db';
import { createApp } from '../../src/app.js';
import { createMockContainer, createTestApp, testGraph } from '../helpers/testApp.js';
import { createTestSecurityContext, TEST_PRINCIPAL } from '../helpers/testSecurity.js';
import type { Container } from '../../src/composition-root.js';

describe('E2E: Workflow Definition API Flow', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  it('POST /api/workflow-definitions creates a draft from a graph', async () => {
    const graph = testGraph('Test Workflow');
    const res = await request(app).post('/api/workflow-definitions').send(graph);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'def-1', status: 'draft', revision: 1 });
    expect(container.workflowDefinitionService.create).toHaveBeenCalledWith(graph, { canEditCommands: true });
  });

  it('GET /api/workflow-definitions returns a page of summaries and passes the filters', async () => {
    const res = await request(app).get('/api/workflow-definitions?projectId=global&status=draft&q=test&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(container.workflowDefinitionService.list).toHaveBeenCalledWith({
      projectId: null,
      status: 'draft',
      q: 'test',
      limit: 10,
      includeArchived: false,
    });
  });

  it('GET /api/workflow-definitions/:id returns the record with its graph', async () => {
    const res = await request(app).get('/api/workflow-definitions/def-1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'def-1');
    expect(res.body.graph.stages[0]).toHaveProperty('key', 'build');
  });

  it('PUT /api/workflow-definitions/:id/graph saves the graph at the expected revision', async () => {
    const graph = testGraph('Renamed');
    const res = await request(app).put('/api/workflow-definitions/def-1/graph').send({ graph, expectedRevision: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('revision', 2);
    expect(container.workflowDefinitionService.saveGraph).toHaveBeenCalledWith('def-1', graph, 1, { canEditCommands: true });
  });

  it('PUT /api/workflow-definitions/:id/graph without expectedRevision is a 400', async () => {
    const res = await request(app).put('/api/workflow-definitions/def-1/graph').send({ graph: testGraph('x') });

    expect(res.status).toBe(400);
    expect(container.workflowDefinitionService.saveGraph).not.toHaveBeenCalled();
  });

  it('POST /api/workflow-definitions/validate returns the validation result', async () => {
    const res = await request(app).post('/api/workflow-definitions/validate').send(testGraph('x'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true, issues: [] });
  });

  it('DELETE /api/workflow-definitions/:id reports the outcome', async () => {
    const res = await request(app).delete('/api/workflow-definitions/def-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(container.workflowDefinitionService.delete).toHaveBeenCalledWith('def-1');
  });

  it('supports create → save → publish → export → delete', async () => {
    expect((await request(app).post('/api/workflow-definitions').send(testGraph('Flow'))).status).toBe(201);
    expect(
      (await request(app).put('/api/workflow-definitions/def-1/graph').send({ graph: testGraph('Flow'), expectedRevision: 1 }))
        .status,
    ).toBe(200);
    const published = await request(app).post('/api/workflow-definitions/def-1/publish');
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ status: 'published', currentVersionId: 'ver-1' });
    const exported = await request(app).get('/api/workflow-definitions/def-1/export');
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toMatch(/application\/json/);
    expect((await request(app).delete('/api/workflow-definitions/def-1')).status).toBe(200);
  });
});

// ── The real service ──

const TEMPLATE_ID = 'tiny';

function tinyTemplates(): TemplateRegistry {
  const template = { id: TEMPLATE_ID, category: 'test', graph: testGraph('Tiny template') };
  return {
    getWorkflowTemplate: (id: string) => (id === TEMPLATE_ID ? template : undefined),
    getAllWorkflowTemplates: () => [template],
  } as unknown as TemplateRegistry;
}

/** A graph with a workflow-level script hook (a command-bearing field). */
function graphWithScriptHook() {
  const graph = testGraph('Hooked');
  return {
    ...graph,
    workflow: {
      ...graph.workflow,
      hooks: [
        {
          id: 'notify',
          name: 'Notify',
          type: 'script' as const,
          phase: 'on_run_start' as const,
          config: { type: 'script' as const, command: 'node', args: ['notify.js'] },
        },
      ],
    },
  };
}

/** The raw better-sqlite3 handle, for seeding a run row. */
type RawSqlite = { prepare(sql: string): { run(...params: unknown[]): unknown } };

function realApp(principal: Principal = TEST_PRINCIPAL) {
  const db = createDB(':memory:');
  migrateDB(db);
  const container = createMockContainer();
  const sqlite = (db as unknown as { session: { client: RawSqlite } }).session.client;
  (container as { workflowDefinitionService: unknown }).workflowDefinitionService = new WorkflowDefinitionService(
    new SqliteWorkflowDefinitionStore(db),
    tinyTemplates(),
  );
  (container as { security: unknown }).security = createTestSecurityContext({
    auth: {
      authenticate: async () => principal,
      issueStreamTicket: async () => ({ ticket: 't', expiresAt: Date.now() + 30_000 }),
      isLegacyKeyConfigured: false,
    },
  } as never);
  return { app: createApp(container), sqlite };
}

describe('Workflow definitions on the real service', () => {
  it('a save with a stale expectedRevision is a 409 carrying the current record', async () => {
    const { app } = realApp();
    const created = await request(app).post('/api/workflow-definitions').send(testGraph('Draft'));
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect((await request(app).put(`/api/workflow-definitions/${id}/graph`).send({ graph: testGraph('One'), expectedRevision: 1 })).status).toBe(200);

    const stale = await request(app).put(`/api/workflow-definitions/${id}/graph`).send({ graph: testGraph('Two'), expectedRevision: 1 });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    expect(stale.body.error.current.revision).toBe(2);
    expect(stale.body.error.current.graph.workflow.name).toBe('One');
  });

  it('an invalid graph is a 422 whose issues point at the field', async () => {
    const { app } = realApp();
    const graph = testGraph('Bad');
    const res = await request(app)
      .post('/api/workflow-definitions')
      .send({ ...graph, edges: [{ from: 'build', to: 'missing', on: 'success' }] });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('WORKFLOW_INVALID');
    expect(res.body.error.issues[0].path).toMatch(/^\/edges\/0/);
  });

  it('adding a script hook without admin:settings is a 403', async () => {
    const { app } = realApp({
      ...TEST_PRINCIPAL,
      type: 'paired-device',
      scopes: ALL_SCOPES.filter((s) => s !== 'admin:settings'),
    });
    const created = await request(app).post('/api/workflow-definitions').send(testGraph('Plain'));
    expect(created.status).toBe(201);

    const res = await request(app)
      .put(`/api/workflow-definitions/${created.body.id as string}/graph`)
      .send({ graph: graphWithScriptHook(), expectedRevision: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('deleting a definition that has a run archives it', async () => {
    const { app, sqlite } = realApp();
    const created = await request(app).post('/api/workflow-definitions').send(testGraph('Ran once'));
    const id = created.body.id as string;
    const published = await request(app).post(`/api/workflow-definitions/${id}/publish`);
    expect(published.status).toBe(200);
    const now = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_definition_id, definition_version_id, name, created_at, updated_at)
         VALUES ('run-1', ?, ?, 'Run', ?, ?)`,
      )
      .run(id, published.body.currentVersionId, now, now);

    const res = await request(app).delete(`/api/workflow-definitions/${id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ archived: true, runs: 1 });
    expect((await request(app).get(`/api/workflow-definitions/${id}`)).body.archivedAt).not.toBeNull();
  });

  it('importing {templateId} creates a draft tagged with the template', async () => {
    const { app } = realApp();
    const res = await request(app).post('/api/workflow-definitions/import').send({ templateId: TEMPLATE_ID, name: 'Mine' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.graph.workflow.name).toBe('Mine');
    expect(res.body.graph.workflow.tags).toContain(`template:${TEMPLATE_ID}`);
  });
});
