// ────────────────────────────────────────────────────────────────
// G-18 — palette entity search: `GET /api/search?q=&types=&limit=`.
//
// One merged, ranked list across chats, projects, agents, workflow
// definitions, automations and scripts. Every source is an existing
// read-only call on `Container` (`workflowDefinitionService`/
// `automationService`/`workflowScriptLoader` are Workflow-Overhaul-owned —
// read-only, nothing added to them). Scope filtering keeps a type out of
// the results entirely (never a 403) when the caller lacks its read scope.
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Agent, Automation, Chat, Project } from '@generatorai/shared';
import type { WorkflowDefinitionSummary } from '@generatorai/workflow-spec';

import { createSearchRoutes } from '../routes/search.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function chatRow(name: string, id = name.toLowerCase().replace(/\s+/g, '-')) {
  return {
    chat: { id, name, sessionId: `sess-${id}`, tags: [], status: 'active', createdAt: NOW, updatedAt: NOW } as Chat,
    activity: { lastActivityAt: NOW },
  };
}

function project(name: string, id = name.toLowerCase().replace(/\s+/g, '-')): Project {
  return { id, name, settings: {}, rootPath: `/tmp/${id}`, status: 'active', createdAt: NOW, updatedAt: NOW };
}

function agent(name: string, id = name.toLowerCase().replace(/\s+/g, '-')): Agent {
  return {
    id, scope: 'project', projectId: 'proj-1', slug: id, ref: `project:${id}`, name,
    description: 'A test agent, long enough to satisfy validation.',
    instructions: 'do things', role: 'general', projection: 'summary', tags: [], enabled: true, skillIds: [],
  } as unknown as Agent;
}

function definition(name: string, id = name.toLowerCase().replace(/\s+/g, '-')): WorkflowDefinitionSummary {
  return {
    id, name, projectId: 'proj-1', status: 'published', revision: 1, currentVersionId: 'ver-1', tags: [],
    stageCount: 0, needsAttention: false, agentAuthored: false, archivedAt: null,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
}

function automation(name: string, id = name.toLowerCase().replace(/\s+/g, '-')): Automation {
  return {
    id, name, enabled: true, triggerType: 'schedule', createdAt: NOW, updatedAt: NOW,
  } as unknown as Automation;
}

interface Deps {
  chats?: Array<ReturnType<typeof chatRow>>;
  projects?: Project[];
  agents?: Agent[];
  definitions?: WorkflowDefinitionSummary[];
  automations?: Automation[];
  scripts?: Array<{ id: string; name: string; description?: string; tags: string[]; lastModified: Date }>;
  scriptsDisabled?: boolean;
  principalScopes?: string[] | null;
}

function makeApp(deps: Deps = {}) {
  const container = {
    chatEntityRepo: { listPage: vi.fn().mockResolvedValue({ rows: deps.chats ?? [] }) },
    projectService: { listProjects: vi.fn().mockResolvedValue(deps.projects ?? []) },
    agentRepo: { list: vi.fn().mockResolvedValue(deps.agents ?? []) },
    workflowDefinitionService: { list: vi.fn().mockResolvedValue({ items: deps.definitions ?? [] }) },
    automationService: { listAutomations: vi.fn().mockResolvedValue(deps.automations ?? []) },
    workflowScriptLoader: {
      getAllMetadata: deps.scriptsDisabled
        ? vi.fn(() => { throw new Error('Workflow scripts are disabled'); })
        : vi.fn().mockReturnValue(deps.scripts ?? []),
    },
    attentionService: { isAvailable: vi.fn().mockReturnValue(false), getSnapshot: vi.fn() },
  };
  const app = express();
  app.use(express.json());
  const principalScopes = deps.principalScopes;
  if (principalScopes !== undefined) {
    app.use((req, _res, next) => {
      (req as unknown as { principal: { scopes: string[] } | null }).principal =
        principalScopes === null ? null : { scopes: principalScopes };
      next();
    });
  }
  app.use('/api/search', createSearchRoutes(container as never));
  return app;
}

describe('GET /api/search', () => {
  it('returns nothing for an empty query', async () => {
    const res = await request(makeApp()).get('/api/search?q=');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [] });
  });

  it('finds a matching chat by title, sets href and actions', async () => {
    const app = makeApp({ chats: [chatRow('Nightly audit chat')] });
    const res = await request(app).get('/api/search?q=nightly');
    const chatResult = res.body.results.find((r: { type: string }) => r.type === 'chat');
    expect(chatResult).toMatchObject({
      type: 'chat',
      title: 'Nightly audit chat',
      href: '/chats/nightly-audit-chat',
      actions: ['open'],
    });
  });

  it('finds a matching project, agent, workflow and automation', async () => {
    const app = makeApp({
      projects: [project('Nightly Project')],
      agents: [agent('Nightly Agent')],
      definitions: [definition('Nightly audit')],
      automations: [automation('Nightly digest')],
    });
    const res = await request(app).get('/api/search?q=nightly');
    const byType = new Map(res.body.results.map((r: { type: string }) => [r.type, r]));
    expect((byType.get('project') as { href: string }).href).toBe('/projects/nightly-project');
    expect((byType.get('agent') as { href: string }).href).toBe('/agents/nightly-agent');
    expect((byType.get('workflow') as { actions: string[] }).actions).toEqual(['open', 'run']);
    expect((byType.get('automation') as { href: string }).href).toBe('/automations/nightly-digest');
  });

  it('finds a matching script and links to /scripts/:id', async () => {
    const app = makeApp({
      scripts: [{ id: 'nightly-script', name: 'Nightly script', tags: [], lastModified: NOW }],
    });
    const res = await request(app).get('/api/search?q=nightly');
    const scriptResult = res.body.results.find((r: { type: string }) => r.type === 'script');
    expect(scriptResult.href).toBe('/scripts/nightly-script');
  });

  it('treats scripts being disabled as "no scripts", not a search-wide failure', async () => {
    const app = makeApp({ scriptsDisabled: true, projects: [project('Nightly Project')] });
    const res = await request(app).get('/api/search?q=nightly');
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { type: string }) => r.type === 'script')).toBe(false);
    expect(res.body.results.some((r: { type: string }) => r.type === 'project')).toBe(true);
  });

  it('ranks a title-prefix match above a title-substring match', async () => {
    const app = makeApp({
      projects: [
        project('Something Nightly Related', 'mid-match'), // "nightly" is in the middle
        project('Nightly', 'prefix-match'), // "nightly" is the whole title
      ],
    });
    const res = await request(app).get('/api/search?q=nightly');
    expect(res.body.results[0].id).toBe('prefix-match');
    expect(res.body.results[1].id).toBe('mid-match');
  });

  it('respects `types` — a type not requested contributes nothing', async () => {
    const app = makeApp({
      projects: [project('Nightly Project')],
      agents: [agent('Nightly Agent')],
    });
    const res = await request(app).get('/api/search?q=nightly&types=project');
    expect(res.body.results.every((r: { type: string }) => r.type === 'project')).toBe(true);
  });

  it('clamps and defaults `limit`', async () => {
    const many = Array.from({ length: 30 }, (_, i) => project(`Nightly ${i}`, `nightly-${i}`));
    const app = makeApp({ projects: many });
    const res = await request(app).get('/api/search?q=nightly');
    expect(res.body.results.length).toBeLessThanOrEqual(20); // default
    const res2 = await request(app).get('/api/search?q=nightly&limit=999');
    expect(res2.body.results.length).toBeLessThanOrEqual(50); // hard max
  });

  describe('scope filtering', () => {
    it('a null principal (unauthenticated loopback dev) sees every type', async () => {
      const app = makeApp({
        principalScopes: null,
        chats: [chatRow('Nightly chat')],
        projects: [project('Nightly project')],
      });
      const res = await request(app).get('/api/search?q=nightly');
      const types = new Set(res.body.results.map((r: { type: string }) => r.type));
      expect(types.has('chat')).toBe(true);
      expect(types.has('project')).toBe(true);
    });

    it('a principal without read:chats never sees chat results', async () => {
      const app = makeApp({
        principalScopes: ['read:projects', 'read:workflows'],
        chats: [chatRow('Nightly chat')],
        projects: [project('Nightly project')],
      });
      const res = await request(app).get('/api/search?q=nightly');
      expect(res.body.results.some((r: { type: string }) => r.type === 'chat')).toBe(false);
      expect(res.body.results.some((r: { type: string }) => r.type === 'project')).toBe(true);
    });

    it('a principal without read:workflows never sees agent/workflow/automation/script results', async () => {
      const app = makeApp({
        principalScopes: ['read:chats', 'read:projects'],
        agents: [agent('Nightly agent')],
        definitions: [definition('Nightly workflow')],
        automations: [automation('Nightly automation')],
      });
      const res = await request(app).get('/api/search?q=nightly');
      expect(res.body.results).toHaveLength(0);
    });
  });
});
