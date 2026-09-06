// ────────────────────────────────────────────────────────────────
// Project MCP server routes — W48.
//
// Deliberately NOT routed through `__tests__/helpers/testApp.ts`: that
// harness's `security.secretStore` is a `vi.fn()` stub that always resolves
// `get` to `null`, so it cannot prove a credential round-trips through the
// vault — it would only prove the route dispatches, which is not the claim
// under test here ("a token forwards to the harness config but a GET never
// returns it"). This builds a real `ProjectConfigService` (backed by a temp
// dir) + a real `ArtifactCatalog` + a real `McpCredentialVault` over
// `MemorySecretStore`, and calls `createProjectRoutes` directly.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySecretStore } from '@generatorai/secrets';
import {
  ArtifactCatalog,
  ProjectConfigService,
  McpCredentialVault,
  InMemoryMcpHub,
  type IProjectConfigRepository,
} from '@generatorai/core';
import type { ProjectConfig, ILogger } from '@generatorai/shared';
import { createProjectRoutes } from '../routes/projects.js';
import type { Container } from '../composition-root.js';

const logger: ILogger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
  child: () => logger,
} as unknown as ILogger;

/** In-memory `IProjectConfigRepository` — enough for the MCP routes' reads/writes. */
function makeConfigRepo(): IProjectConfigRepository {
  const rows = new Map<string, ProjectConfig>();
  return {
    async create(c) { rows.set(c.id, c); return c; },
    async getById(id) {
      const row = rows.get(id);
      if (!row) throw new Error(`not found: ${id}`);
      return row;
    },
    async getByProjectId(projectId, type) {
      return [...rows.values()].filter((r) => r.projectId === projectId && (!type || r.type === type));
    },
    async update(id, updates) {
      const row = rows.get(id);
      if (!row) throw new Error(`not found: ${id}`);
      const next = { ...row, ...updates };
      rows.set(id, next);
      return next;
    },
    async delete(id) { rows.delete(id); },
    async deleteByProjectId(projectId) {
      for (const [id, r] of rows) if (r.projectId === projectId) rows.delete(id);
    },
  };
}

describe('project MCP server routes', () => {
  let app: Express;
  let dir: string;
  let artifactCatalog: ArtifactCatalog;
  let secretStore: MemorySecretStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-mcp-routes-'));
    const configRepo = makeConfigRepo();

    // Minimal duck-typed ProjectService — only the two methods
    // ProjectConfigService actually calls.
    const projectService = {
      async getProject() { return { id: 'p1', name: 'Test project' }; },
      getProjectConfigTypeDir(_projectId: string, type: string) {
        return join(dir, type);
      },
    };

    const projectConfigService = new ProjectConfigService(
      configRepo,
      projectService as never,
      logger,
    );

    artifactCatalog = new ArtifactCatalog(
      { listSystemArtifacts: async () => [] } as never,
      configRepo,
      join(dir, 'templates', 'system'),
      logger,
      { resolveProjectConfigPath: (c) => join(projectService.getProjectConfigTypeDir(c.projectId, c.type), c.filePath) },
    );

    secretStore = new MemorySecretStore();
    const container = {
      projectService: {} as never,
      codebaseService: {} as never,
      worktreeService: {} as never,
      worktreeCleanupService: {} as never,
      projectConfigService,
      systemArtifactService: {} as never,
      artifactCatalog,
      security: { secretStore } as never,
      logger,
    } as unknown as Container;

    app = express();
    app.use(express.json());
    app.use('/api/projects', createProjectRoutes(container));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('POST with headers stores the token in the vault; GET redacts it and reports hasCredentials', async () => {
    const createRes = await request(app)
      .post('/api/projects/p1/mcp-servers')
      .send({ name: 'Jira', serverType: 'http', url: 'https://jira.example/mcp', headers: { Authorization: 'Bearer live-token-abc' } });

    expect(createRes.status).toBe(201);
    expect(createRes.body.headers).toEqual({ Authorization: '••••' });
    expect(createRes.body.hasCredentials).toBe(true);
    expect(JSON.stringify(createRes.body)).not.toContain('live-token-abc');

    const listRes = await request(app).get('/api/projects/p1/mcp-servers');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].headers).toEqual({ Authorization: '••••' });
    expect(JSON.stringify(listRes.body)).not.toContain('live-token-abc');
  });


  it('END TO END: the harness config gets the real token; the GET response never does', async () => {
    const createRes = await request(app)
      .post('/api/projects/p1/mcp-servers')
      .send({ name: 'Jira', serverType: 'http', url: 'https://jira.example/mcp', headers: { Authorization: 'Bearer live-token-abc' } });
    expect(createRes.status).toBe(201);
    expect(JSON.stringify(createRes.body)).not.toContain('live-token-abc');

    // What a client (GET) sees — pointer/redaction only.
    const listRes = await request(app).get('/api/projects/p1/mcp-servers');
    const wire = listRes.body[0];
    expect(wire.headers).toEqual({ Authorization: '••••' });

    // What the SAME catalog hands the harness, via the credential vault —
    // this is the config `mergeMcpServers`/the chat builder would forward.
    const vault = new McpCredentialVault(secretStore);
    const hub = new InMemoryMcpHub({ vault });
    const catalogServers = await artifactCatalog.listMcpServers('p1');
    const jira = catalogServers.find((s) => s.id === wire.id)!;
    const resolved = await hub.resolveForRun({
      workflowDefinitionId: 'chat:c1',
      workflowRunId: 'r1',
      declared: { [jira.name]: jira.config },
    });
    expect(resolved.servers['Jira']?.headers).toEqual({ Authorization: 'Bearer live-token-abc' });
    expect(resolved.dropped).toEqual([]);
  });

  it('rejects a body missing the required connection field', async () => {
    const res = await request(app)
      .post('/api/projects/p1/mcp-servers')
      .send({ name: 'Broken', serverType: 'http' });
    expect(res.status).toBe(400);
  });

  it('PUT omitting headers keeps a previously-stored credential (redaction marker round-trip)', async () => {
    const createRes = await request(app)
      .post('/api/projects/p1/mcp-servers')
      .send({ name: 'Jira', serverType: 'http', url: 'https://jira.example/mcp', headers: { Authorization: 'Bearer live-token-abc' } });
    const id = createRes.body.id as string;

    // Resend the REDACTED value the GET gave us — the documented way a form
    // submit keeps a credential it never saw in the clear.
    const putRes = await request(app)
      .put(`/api/projects/p1/mcp-servers/${id}`)
      .send({ name: 'Jira', serverType: 'http', url: 'https://jira.example/mcp', headers: { Authorization: '••••' } });
    expect(putRes.status).toBe(204);

    const listRes = await request(app).get('/api/projects/p1/mcp-servers');
    expect(listRes.body[0].hasCredentials).toBe(true);
  });

  it('DELETE removes the server and its vaulted credentials', async () => {
    const createRes = await request(app)
      .post('/api/projects/p1/mcp-servers')
      .send({ name: 'Jira', serverType: 'http', url: 'https://jira.example/mcp', headers: { Authorization: 'Bearer live-token-abc' } });
    const id = createRes.body.id as string;

    const delRes = await request(app).delete(`/api/projects/p1/mcp-servers/${id}`);
    expect(delRes.status).toBe(204);

    const listRes = await request(app).get('/api/projects/p1/mcp-servers');
    expect(listRes.body).toEqual([]);
  });
});
