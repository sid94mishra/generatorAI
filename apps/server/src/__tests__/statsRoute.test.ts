// ────────────────────────────────────────────────────────────────
// G-10 — `GET /api/stats/summary`: Home "This week", Workflows stat strip,
// AutomationDetail stat row, WorkflowDetail rail.
//
// Every source is an existing read-only repository/service call — this
// test exercises the aggregation (range filtering, success rate, duration
// stats, byDefinition grouping) with canned service responses, the same
// style `projectSummaryRoute.test.ts` and `projectRunsRoute.test.ts` use.
// `successRate` / `avgDurationMs` / `medianDurationMs` must be OMITTED,
// never `0`, whenever their denominator is zero (D-36).
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Automation, AutomationExecution, Chat, WorkflowDefinition, WorkflowRun } from '@generatorai/shared';

import { createStatsRoutes } from '../routes/stats.js';

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    name: 'Chat',
    sessionId: 'sess-1',
    tags: [],
    status: 'active',
    createdAt: new Date('2026-01-02T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  } as Chat;
}

function definition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'def-1',
    name: 'Nightly audit',
    stages: [],
    edges: [],
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
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
    createdAt: new Date('2026-01-02T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  } as WorkflowRun;
}

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Automation',
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
    totalIterations: 1,
    completedIterations: 1,
    failedIterations: 0,
    createdAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  } as AutomationExecution;
}

function makeApp(opts: {
  chats?: Chat[];
  definitions?: WorkflowDefinition[];
  runsByDefinition?: Record<string, WorkflowRun[]>;
  automations?: Automation[];
  executionsByAutomation?: Record<string, AutomationExecution[]>;
} = {}) {
  const runsByDefinition = opts.runsByDefinition ?? {};
  const executionsByAutomation = opts.executionsByAutomation ?? {};
  const container = {
    chatEntityRepo: {
      getAll: vi.fn().mockResolvedValue(opts.chats ?? []),
      getByProjectId: vi.fn().mockResolvedValue(opts.chats ?? []),
    },
    workflowDefinitionService: {
      listDefinitions: vi.fn().mockResolvedValue(opts.definitions ?? []),
    },
    workflowRunRepo: {
      getByDefinitionId: vi.fn((id: string) => Promise.resolve(runsByDefinition[id] ?? [])),
    },
    automationService: {
      listAutomations: vi.fn().mockResolvedValue(opts.automations ?? []),
      getExecutionsByAutomation: vi.fn((id: string) => Promise.resolve(executionsByAutomation[id] ?? [])),
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/stats', createStatsRoutes(container as never));
  return app;
}

const RANGE = '?from=2026-01-01T00:00:00Z&to=2026-01-07T23:59:59Z';

describe('GET /api/stats/summary', () => {
  it('requires from and to', async () => {
    const res = await request(makeApp()).get('/api/stats/summary');
    expect(res.status).toBe(400);
  });

  it('rejects an unparseable from/to', async () => {
    const res = await request(makeApp()).get('/api/stats/summary?from=nope&to=2026-01-07');
    expect(res.status).toBe(400);
  });

  it('tolerates zero definitions and zero automations (empty run history)', async () => {
    const res = await request(makeApp()).get(`/api/stats/summary${RANGE}`);
    expect(res.status).toBe(200);
    expect(res.body.chats).toEqual({ created: 0 });
    expect(res.body.runs).toEqual({ total: 0, succeeded: 0, failed: 0, cancelled: 0 });
    expect(res.body.runs.successRate).toBeUndefined();
    expect(res.body.runs.avgDurationMs).toBeUndefined();
    expect(res.body.automations).toBeUndefined();
    expect(res.body.byDefinition).toBeUndefined();
  });

  it('counts chats created within the range and excludes ones outside it', async () => {
    const app = makeApp({
      chats: [
        chat({ id: 'in-range', createdAt: new Date('2026-01-03T00:00:00Z') }),
        chat({ id: 'before', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ],
    });
    const res = await request(app).get(`/api/stats/summary${RANGE}`);
    expect(res.body.chats.created).toBe(1);
  });

  it('computes runs.successRate over terminal runs only, and duration stats over timed runs', async () => {
    const app = makeApp({
      definitions: [definition()],
      runsByDefinition: {
        'def-1': [
          run({
            id: 'run-ok',
            status: 'completed',
            startedAt: new Date('2026-01-03T00:00:00Z'),
            completedAt: new Date('2026-01-03T00:10:00Z'),
          }),
          run({ id: 'run-fail', status: 'failed', startedAt: new Date('2026-01-04T00:00:00Z') }),
          run({ id: 'run-live', status: 'running', startedAt: new Date('2026-01-05T00:00:00Z') }),
        ],
      },
    });
    const res = await request(app).get(`/api/stats/summary${RANGE}`);
    expect(res.body.runs.total).toBe(3);
    expect(res.body.runs.succeeded).toBe(1);
    expect(res.body.runs.failed).toBe(1);
    // successRate over terminal (succeeded+failed+cancelled = 2), never over `total` (3).
    expect(res.body.runs.successRate).toBeCloseTo(0.5);
    // Only run-ok has both startedAt and completedAt.
    expect(res.body.runs.avgDurationMs).toBe(10 * 60 * 1000);
    expect(res.body.runs.medianDurationMs).toBe(10 * 60 * 1000);
  });

  it('includes automations only when the deployment has any, and omits avgDurationMs with no timed executions', async () => {
    const app = makeApp({
      automations: [automation()],
      executionsByAutomation: {
        'auto-1': [
          execution({ id: 'exec-ok', status: 'completed', startedAt: new Date('2026-01-02T00:00:00Z') }),
          execution({ id: 'exec-fail', status: 'failed', createdAt: new Date('2026-01-03T00:00:00Z') }),
        ],
      },
    });
    const res = await request(app).get(`/api/stats/summary${RANGE}`);
    expect(res.body.automations).toEqual({ executions: 2, succeeded: 1 });
  });

  it('adds byDefinition (last run + per-definition success rate) only when groupBy=definition', async () => {
    const app = makeApp({
      definitions: [definition({ id: 'def-1' }), definition({ id: 'def-2', name: 'Other' })],
      runsByDefinition: {
        'def-1': [
          run({ id: 'run-a', status: 'completed', startedAt: new Date('2026-01-02T00:00:00Z') }),
          run({ id: 'run-b', status: 'failed', startedAt: new Date('2026-01-03T00:00:00Z') }),
        ],
        'def-2': [],
      },
    });
    const withoutGroupBy = await request(app).get(`/api/stats/summary${RANGE}`);
    expect(withoutGroupBy.body.byDefinition).toBeUndefined();

    const res = await request(app).get(`/api/stats/summary${RANGE}&groupBy=definition`);
    expect(res.body.byDefinition).toHaveLength(2);
    const def1 = res.body.byDefinition.find((r: { definitionId: string }) => r.definitionId === 'def-1');
    expect(def1.lastRun).toMatchObject({ id: 'run-b', status: 'failed' });
    expect(def1.successRate).toBeCloseTo(0.5);
    const def2 = res.body.byDefinition.find((r: { definitionId: string }) => r.definitionId === 'def-2');
    expect(def2.lastRun).toBeUndefined();
    expect(def2.successRate).toBeUndefined();
  });
});
