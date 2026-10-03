// ────────────────────────────────────────────────────────────────
// G-11 — `GET /api/activity/recent`: Home "Recently finished".
//
// Merges chats' finished turns (G-02), terminal workflow runs and terminal
// automation executions into one feed, newest first. Every source is an
// existing read-only repository/service call — this test exercises the
// merge, the `since`/`limit` filters, outcome mapping, retry attribution
// and the final-page-only enrichment (project name, run commit branch)
// with canned service responses, the same style the other G-1x route
// tests use. There are no separate PR/commit items; a chat or run carries
// the commit / PR its workspace recorded through the SCM flow (MG-13).
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type {
  Automation,
  AutomationExecution,
  Chat,
  ChatChangeStats,
  ChatTurnStatus,
  WorkflowRun,
  WorktreeInfo,
} from '@generatorai/shared';
import type { WorkflowDefinitionSummary } from '@generatorai/workflow-spec';

import { createActivityRoutes } from '../routes/activity.js';

interface TestChatActivity {
  lastActivityAt: Date;
  lastTurn?: { status: ChatTurnStatus; endedAt: Date; error?: string };
  changes?: ChatChangeStats;
}

function chatRow(overrides: Partial<Chat> = {}, activityOverrides: Partial<TestChatActivity> = {}) {
  const chat: Chat = {
    id: 'chat-1',
    name: 'Fix the flaky test',
    sessionId: 'sess-1',
    tags: [],
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Chat;
  return {
    chat,
    activity: {
      lastActivityAt: new Date('2026-01-02T00:00:00Z'),
      lastTurn: { status: 'succeeded', endedAt: new Date('2026-01-02T00:00:00Z') },
      ...activityOverrides,
    },
  };
}

function definition(overrides: Partial<WorkflowDefinitionSummary> = {}): WorkflowDefinitionSummary {
  return {
    id: 'def-1',
    name: 'Nightly audit',
    projectId: null,
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
    name: 'Run',
    status: 'completed',
    definitionVersionId: 'ver-1',
    variables: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    completedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  } as WorkflowRun;
}

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Nightly build',
    triggerType: 'manual',
    workflowIds: ['def-1'],
    inputMode: 'single',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Automation;
}

function execution(overrides: Partial<AutomationExecution> = {}): AutomationExecution {
  return {
    id: 'exec-1',
    automationId: 'auto-1',
    status: 'completed',
    triggeredBy: 'manual',
    totalIterations: 4,
    completedIterations: 4,
    failedIterations: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  } as AutomationExecution;
}

function makeApp(opts: {
  chatRows?: ReturnType<typeof chatRow>[];
  definitions?: WorkflowDefinitionSummary[];
  runsByDefinition?: Record<string, WorkflowRun[]>;
  automations?: Automation[];
  executionsByAutomation?: Record<string, AutomationExecution[]>;
  worktreesByRun?: Record<string, WorktreeInfo[]>;
  projects?: Record<string, { id: string; name: string }>;
  workspaces?: Record<string, { status: string; metadata?: Record<string, unknown> }>;
} = {}) {
  const runsByDefinition = opts.runsByDefinition ?? {};
  const executionsByAutomation = opts.executionsByAutomation ?? {};
  const worktreesByRun = opts.worktreesByRun ?? {};
  const projects = opts.projects ?? {};
  const chatPage = {
    rows: opts.chatRows ?? [],
    next: null,
    total: opts.chatRows?.length ?? 0,
    counts: { active: opts.chatRows?.length ?? 0, archived: 0 },
  };
  const container = {
    chatEntityRepo: { listPage: vi.fn().mockResolvedValue(chatPage) },
    workflowDefinitionService: { list: vi.fn().mockResolvedValue({ items: opts.definitions ?? [] }) },
    workflowRunRepo: {
      getByDefinitionId: vi.fn((id: string) => Promise.resolve(runsByDefinition[id] ?? [])),
    },
    automationService: {
      listAutomations: vi.fn().mockResolvedValue(opts.automations ?? []),
      getExecutionsByAutomation: vi.fn((id: string) => Promise.resolve(executionsByAutomation[id] ?? [])),
    },
    worktreeService: {
      listWorktrees: vi.fn((_projectId: string | undefined, runId: string | undefined) =>
        Promise.resolve(runId ? worktreesByRun[runId] ?? [] : []),
      ),
    },
    projectService: {
      getProject: vi.fn((id: string) => {
        const p = projects[id];
        return p ? Promise.resolve(p) : Promise.reject(new Error('not found'));
      }),
    },
    executionWorkspaceRepo: {
      findById: vi.fn((id: string) => Promise.resolve(opts.workspaces?.[id] ?? null)),
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/activity', createActivityRoutes(container as never));
  return app;
}

describe('GET /api/activity/recent', () => {
  it('rejects an unparseable since', async () => {
    const res = await request(makeApp()).get('/api/activity/recent?since=nope');
    expect(res.status).toBe(400);
  });

  it('returns an empty feed with no data (tolerates empty run history)', async () => {
    const res = await request(makeApp()).get('/api/activity/recent');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('merges a finished chat turn, a terminal run and a terminal execution, newest first', async () => {
    const app = makeApp({
      chatRows: [
        chatRow(
          { id: 'chat-1' },
          { lastTurn: { status: 'succeeded', endedAt: new Date('2026-01-05T00:00:00Z') } },
        ),
      ],
      definitions: [definition()],
      runsByDefinition: { 'def-1': [run({ id: 'run-1', completedAt: new Date('2026-01-03T00:00:00Z') })] },
      automations: [automation()],
      executionsByAutomation: { 'auto-1': [execution({ id: 'exec-1', completedAt: new Date('2026-01-04T00:00:00Z') })] },
    });
    const res = await request(app).get('/api/activity/recent');
    expect(res.body.items.map((i: { key: string }) => i.key)).toEqual([
      'chat:chat-1',
      'automation_execution:exec-1',
      'run:run-1',
    ]);
  });

  it('excludes items ended before `since` and respects `limit`', async () => {
    const app = makeApp({
      chatRows: [
        chatRow({ id: 'old' }, { lastTurn: { status: 'succeeded', endedAt: new Date('2025-01-01T00:00:00Z') } }),
        chatRow({ id: 'new' }, { lastTurn: { status: 'succeeded', endedAt: new Date('2026-01-05T00:00:00Z') } }),
      ],
    });
    const res = await request(app).get('/api/activity/recent?since=2026-01-01T00:00:00Z&limit=1');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].key).toBe('chat:new');
  });

  it('excludes runs that are still in progress and executions that never terminated', async () => {
    const app = makeApp({
      definitions: [definition()],
      runsByDefinition: { 'def-1': [run({ id: 'run-live', status: 'running', completedAt: undefined })] },
      automations: [automation()],
      executionsByAutomation: { 'auto-1': [execution({ id: 'exec-pending', status: 'pending', completedAt: undefined })] },
    });
    const res = await request(app).get('/api/activity/recent');
    expect(res.body.items).toEqual([]);
  });

  it('attributes retry to failed chats (chat_prompt) and failed runs (run_retry), never to automations', async () => {
    const app = makeApp({
      chatRows: [
        chatRow(
          { id: 'chat-1' },
          { lastTurn: { status: 'failed', endedAt: new Date('2026-01-05T00:00:00Z'), error: 'pnpm typecheck exited 2' } },
        ),
      ],
      definitions: [definition()],
      runsByDefinition: { 'def-1': [run({ id: 'run-1', status: 'failed', completedAt: new Date('2026-01-04T00:00:00Z') })] },
      automations: [automation()],
      executionsByAutomation: { 'auto-1': [execution({ id: 'exec-1', status: 'failed', completedAt: new Date('2026-01-03T00:00:00Z') })] },
    });
    const res = await request(app).get('/api/activity/recent');
    const byKey = Object.fromEntries(res.body.items.map((i: { key: string; retry?: string }) => [i.key, i.retry]));
    expect(byKey['chat:chat-1']).toBe('chat_prompt');
    expect(byKey['run:run-1']).toBe('run_retry');
    expect(byKey['automation_execution:exec-1']).toBeUndefined();
  });

  it('enriches only the final page: resolves the project name and a run\'s commit branch', async () => {
    const app = makeApp({
      definitions: [definition({ id: 'def-1', projectId: 'proj-1' })],
      runsByDefinition: { 'def-1': [run({ id: 'run-1', completedAt: new Date('2026-01-05T00:00:00Z') })] },
      worktreesByRun: { 'run-1': [{ id: 'wt-1', projectId: 'proj-1', codebaseId: 'cb-1', runId: 'run-1', worktreePath: '/tmp/wt-1', branchName: 'feat/x', status: 'active', createdAt: new Date() }] },
      projects: { 'proj-1': { id: 'proj-1', name: 'Demo Project' } },
    });
    const res = await request(app).get('/api/activity/recent');
    expect(res.body.items[0].project).toEqual({ id: 'proj-1', name: 'Demo Project' });
    expect(res.body.items[0].commit).toEqual({ branch: 'feat/x' });
  });

  it('never invents a pullRequest field', async () => {
    const app = makeApp({
      definitions: [definition()],
      runsByDefinition: { 'def-1': [run({ id: 'run-1', completedAt: new Date('2026-01-05T00:00:00Z') })] },
    });
    const res = await request(app).get('/api/activity/recent');
    expect(res.body.items[0].pullRequest).toBeUndefined();
  });

  it('carries the commit and PR the item\'s workspace recorded after its work began (MG-13)', async () => {
    const outcome = (at: string) => ({
      scmOutcome: { at, branch: 'fix/flaky', commit: { sha: 'abc123' }, pullRequest: { number: 1176, url: 'https://github.com/a/b/pull/1176' } },
    });
    const app = makeApp({
      chatRows: [
        chatRow({ id: 'chat-1', workspaceId: 'ws-1' }, { lastTurn: { status: 'succeeded', endedAt: new Date('2026-01-05T00:00:00Z') } }),
        chatRow({ id: 'chat-2', workspaceId: 'ws-2' }, { lastTurn: { status: 'succeeded', endedAt: new Date('2026-01-05T00:00:00Z') } }),
      ],
      definitions: [definition()],
      runsByDefinition: {
        'def-1': [run({ id: 'run-1', workspaceId: 'ws-3', startedAt: new Date('2026-01-03T00:00:00Z'), completedAt: new Date('2026-01-04T00:00:00Z') })],
      },
      workspaces: {
        // After the turn ended: belongs to it.
        'ws-1': { status: 'active', metadata: outcome('2026-01-05T00:10:00Z') },
        // Before the turn ended: an earlier turn's commit, not this one's.
        'ws-2': { status: 'active', metadata: outcome('2026-01-04T00:00:00Z') },
        'ws-3': { status: 'active', metadata: outcome('2026-01-03T12:00:00Z') },
      },
    });
    const res = await request(app).get('/api/activity/recent');
    const byKey = Object.fromEntries(res.body.items.map((i: { key: string }) => [i.key, i]));
    expect(byKey['chat:chat-1'].pullRequest).toEqual({ number: 1176, url: 'https://github.com/a/b/pull/1176' });
    expect(byKey['chat:chat-1'].commit).toEqual({ branch: 'fix/flaky', sha: 'abc123' });
    expect(byKey['chat:chat-2'].pullRequest).toBeUndefined();
    expect(byKey['chat:chat-2'].commit).toBeUndefined();
    expect(byKey['run:run-1'].pullRequest).toEqual({ number: 1176, url: 'https://github.com/a/b/pull/1176' });
    expect(byKey['run:run-1'].commit).toEqual({ branch: 'fix/flaky', sha: 'abc123' });
  });
});
