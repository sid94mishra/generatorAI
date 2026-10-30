import { describe, expect, it } from 'vitest';
import type { WorkflowDefinitionSummary, WorkflowGraph } from '@generatorai/workflow-spec';

import { definitionFacts, duplicateGraph, filterWorkflows, hooksLine, listSummary, postProcessingLine, scopeCounts, sessionLine, variableRows, versionChip } from '../model/workflowsModel';

const row = (id: string, extra: Partial<WorkflowDefinitionSummary> = {}): WorkflowDefinitionSummary => ({
  id,
  name: id,
  projectId: null,
  status: 'published',
  revision: 1,
  currentVersionId: 'v',
  tags: [],
  stageCount: 2,
  needsAttention: false,
  agentAuthored: false,
  archivedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...extra,
});

const LIST = [
  row('alpha', { tags: ['deps'], updatedAt: '2026-09-03T00:00:00.000Z' }),
  row('beta', { status: 'draft', updatedAt: '2026-09-05T00:00:00.000Z' }),
  row('gamma', { archivedAt: '2026-09-04T00:00:00.000Z' }),
];

describe('workflows list', () => {
  it('counts and filters by scope, leaving archived out', () => {
    expect(scopeCounts(LIST)).toEqual({ all: 2, published: 1, drafts: 1 });
    expect(filterWorkflows(LIST, 'drafts', '', 'updated').map((w) => w.id)).toEqual(['beta']);
    expect(filterWorkflows(LIST, 'all', 'DEPS', 'updated').map((w) => w.id)).toEqual(['alpha']);
  });

  it('sorts by update, name or last run', () => {
    expect(filterWorkflows(LIST, 'all', '', 'updated').map((w) => w.id)).toEqual(['beta', 'alpha']);
    expect(filterWorkflows(LIST, 'all', '', 'name').map((w) => w.id)).toEqual(['alpha', 'beta']);
    const stats = new Map([['alpha', { definitionId: 'alpha', lastRun: { id: 'r', status: 'completed' as const, startedAt: '2026-09-10T00:00:00.000Z' } }]]);
    expect(filterWorkflows(LIST, 'all', '', 'lastRun', stats).map((w) => w.id)).toEqual(['alpha', 'beta']);
  });

  it('summarises the 30 days, the rate only when present', () => {
    expect(listSummary({ runs: { total: 212, succeeded: 1, failed: 0, cancelled: 0, successRate: 0.934 } } as never)).toBe('212 runs in 30 days · 93.4% succeeded');
    expect(listSummary({ runs: { total: 1, succeeded: 0, failed: 0, cancelled: 0 } } as never)).toBe('1 run in 30 days');
  });
});

const GRAPH = {
  formatVersion: 2,
  workflow: {
    name: 'Audit',
    session: { model: 'm1', permissionMode: 'acceptEdits' },
    variables: [
      { name: 'target_branch', type: 'string', label: 'Branch', required: true },
      { name: 'max', type: 'number', label: 'Max', required: false, defaultValue: 3 },
    ],
    hooks: [{ id: 'h', name: 'Slack', type: 'http', phase: 'on_run_failed', priority: 0, enabled: true, failurePolicy: 'skip', timeoutMs: 1, retries: 0, config: { type: 'http', url: 'https://x', method: 'POST' } }],
    lifecycle: { codebaseAliases: ['api'], useWorktree: true, requiresCodebase: false, sandbox: 'required', preprocessingSteps: [], postProcessing: { autoCommit: true, autoPush: true, autoCreatePR: true, steps: [] } },
    tags: ['deps', 'nightly'],
  },
  stages: [
    { key: 'a', name: 'A', kind: 'agent', approval: { allowChanges: true, maxRounds: 3 } },
    { key: 'b', name: 'B', kind: 'agent' },
  ],
  edges: [],
} as unknown as WorkflowGraph;

describe('workflow detail', () => {
  it('names the version chip neutrally', () => {
    expect(versionChip({ status: 'draft', revision: 13, currentVersionId: null, hasUnpublishedChanges: true })).toEqual({ label: 'Draft', suffix: 'rev 13' });
    expect(versionChip({ status: 'published', revision: 3, currentVersionId: 'v7', hasUnpublishedChanges: false }, [{ id: 'v7', version: 7 } as never])).toEqual({ label: 'Published', suffix: 'v7' });
  });

  it('builds facts, setup lines and variables', () => {
    expect(definitionFacts(GRAPH).map((f) => f.label)).toEqual(['2 stages', '1 approval gate', 'deps · nightly']);
    expect(postProcessingLine(GRAPH)).toBe('Commit → Push → PR');
    expect(sessionLine(GRAPH.workflow.session)).toBe('m1 · Accept edits');
    expect(hooksLine(GRAPH)).toEqual({ title: 'on_run_failed → HTTP', detail: 'Slack' });
    expect(variableRows(GRAPH.workflow.variables)).toEqual([
      { name: 'target_branch', detail: 'String · Required', defaultText: null },
      { name: 'max', detail: 'Number', defaultText: '3' },
    ]);
  });

  it('duplicates as "<name> copy"', () => {
    expect(duplicateGraph(GRAPH).workflow.name).toBe('Audit copy');
  });
});
