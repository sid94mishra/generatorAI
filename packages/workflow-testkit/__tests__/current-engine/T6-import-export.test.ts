// ────────────────────────────────────────────────────────────────
// T6 — definition documents: create, export → import round trip,
// malformed imports, and the draft / version lifecycle
// (F_live_tests §1 T6, §2 F-12, F-13; PHASE-01 WP-1.7 tests).
//
// Drives the definition service behind the routes. P01 rewrote the
// definition model: a definition is one v2 `WorkflowGraph` document, so
// the P00 KNOWN-BUGs W-20 / W-25 (fields dropped on create or export),
// W-30 (broken definitions accepted) and W-64 (non-strict import) flipped
// to PASS here, and W-13 (a run reads the live definition) is covered by
// the pinned-version test below.
// ────────────────────────────────────────────────────────────────

import { ConflictError, RevisionConflictError, WorkflowValidationError } from '@generatorai/shared';
import { validateWorkflow, type WorkflowGraph } from '@generatorai/workflow-spec';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const hook = (id: string, phase: string) => ({
  id,
  name: `h-${id}`,
  phase,
  type: 'script',
  priority: 1,
  enabled: true,
  failurePolicy: 'continue',
  timeoutMs: 5000,
  retries: 1,
  config: { type: 'script', command: 'echo', args: ['hi'] },
});

const stage = (key: string, extra: Record<string, unknown> = {}) => ({
  kind: 'agent',
  key,
  name: key.toUpperCase(),
  description: `stage ${key}`,
  position: { x: 10, y: 20 },
  prompts: [{ label: 'p1', text: `Do {{variables.topic}} ${key}` }],
  session: { defaultAgentMode: 'plan', model: 'haiku', browser: { visibility: 'visible' }, skills: { disabled: ['stageSkill'] } },
  context: { mode: 'output' },
  output: { format: 'text', rules: [{ type: 'contains', value: 'WF-LEVEL', message: 'wf-level rule' }] },
  retry: { maxAttempts: 4, initialDelayMs: 1500, backoffMultiplier: 3 },
  timeouts: { attemptMs: 120_000 },
  approval: { prompt: 'Looks right?', allowChanges: true, maxRounds: 2 },
  hooks: [hook(`${key}_h`, 'pre_run')],
  ...extra,
});

/** Every field the v1 engine accepts, the ones P00 showed being dropped included. */
const FULL: unknown = {
  formatVersion: 2,
  workflow: {
    name: 't6-roundtrip',
    description: 'complex def for round trip',
    session: { model: 'haiku', reasoningEffort: 'low', maxTurns: 7, browser: { enabled: true, visibility: 'headless', allowedHosts: ['example.com'] } },
    variables: [{ name: 'topic', type: 'string', label: 'Topic', required: true, defaultValue: 'cats' }],
    hooks: [hook('wh1', 'on_run_start'), hook('hf1', 'on_run_complete')],
    lifecycle: {
      useWorktree: false,
      requiresCodebase: false,
      preprocessingSteps: [{ name: 'pp', failOnError: false, config: { type: 'set_variable', variableName: 'pp', value: 'v' } }],
    },
    tags: ['t6'],
  },
  stages: [
    stage('s0', { guard: "variables.topic != ''" }),
    stage('s1', { context: { from: ['s0'], mode: 'summary' } }),
    stage('s2'),
    stage('s3', { output: { format: 'json', schema: { type: 'object' }, rules: [] } }),
  ],
  edges: [
    { from: 's0', to: 's1', on: 'success' },
    { from: 's0', to: 's2', on: 'failure' },
    { from: 's1', to: 's3', on: 'completion', when: "stages.s1.status == 'completed'" },
    { from: 's2', to: 's3', on: 'always' },
  ],
};

const fullGraph = (): WorkflowGraph => {
  const result = validateWorkflow(FULL);
  expect(result.issues).toEqual([]);
  return result.graph!;
};

describe('T6 definitions: create and export → import round trip', () => {
  it('stores every field and round-trips with zero diffs', async () => {
    engine = await createTestEngine();
    const svc = engine.services.workflowDefinitionService;
    const created = await svc.createFromSpec(FULL, { canEditCommands: true });
    expect(created.status).toBe('draft');
    expect(created.graph).toEqual(fullGraph());

    const exported = await svc.exportGraph(created.id);
    const imported = await svc.import(JSON.parse(exported), { canEditCommands: true });
    expect(imported.id).not.toBe(created.id);
    expect(imported.graph).toEqual(created.graph);
    expect(await svc.exportGraph(imported.id)).toBe(exported);
  });
});

describe('T6 malformed imports', () => {
  const doc = (patch: { stages?: unknown[]; edges?: unknown[]; extra?: Record<string, unknown> }) => ({
    formatVersion: 2,
    workflow: { name: 'bad' },
    stages: patch.stages ?? [
      { kind: 'agent', key: 'a', name: 'a', prompts: [{ label: 'a', text: 'a' }] },
      { kind: 'agent', key: 'b', name: 'b', prompts: [{ label: 'b', text: 'b' }] },
    ],
    edges: patch.edges ?? [],
    ...patch.extra,
  });
  const a = { kind: 'agent', key: 'a', name: 'a', prompts: [{ label: 'a', text: 'a' }] };
  const b = { kind: 'agent', key: 'b', name: 'b', prompts: [{ label: 'b', text: 'b' }] };

  it('rejects structural errors, broken expressions and unknown fields', async () => {
    engine = await createTestEngine();
    const svc = engine.services.workflowDefinitionService;
    const cases: Record<string, unknown> = {
      cycle: doc({ edges: [{ from: 'a', to: 'b', on: 'success' }, { from: 'b', to: 'a', on: 'success' }] }),
      selfLoop: doc({ edges: [{ from: 'a', to: 'a', on: 'success' }] }),
      missingStage: doc({ edges: [{ from: 'a', to: 'zz', on: 'success' }] }),
      duplicateEdge: doc({ edges: [{ from: 'a', to: 'b', on: 'success' }, { from: 'a', to: 'b', on: 'failure' }] }),
      duplicateKeys: doc({ stages: [a, { ...b, key: 'a' }] }),
      badKey: doc({ stages: [a, { ...b, key: 'B-1' }] }),
      unparseableGuard: doc({ stages: [a, { ...b, guard: '((( variables.x ==' }], edges: [{ from: 'a', to: 'b', on: 'success' }] }),
      undeclaredVariable: doc({ stages: [a, { ...b, guard: 'variables.nope == 1' }] }),
      unknownContextSource: doc({ stages: [a, { ...b, context: { from: ['nope'] } }] }),
      unknownTopField: doc({ extra: { bogusTop: 1 } }),
      unknownStageField: doc({ stages: [a, { ...b, bogusStage: true }] }),
      v1Field: doc({ stages: [a, { ...b, retryPolicy: { maxRetries: 1 } }] }),
      wrongFormat: { ...doc({}), formatVersion: 1 },
    };
    for (const [label, input] of Object.entries(cases)) {
      const err = await svc.import(input, { canEditCommands: true }).catch((e: unknown) => e);
      expect({ label, rejected: err instanceof WorkflowValidationError }).toEqual({ label, rejected: true });
      expect((err as WorkflowValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe('T6 draft, versions and runs', () => {
  const LINEAR = {
    name: 't6-lifecycle',
    stages: [
      { name: 'A', prompt: 'Write one line containing the token A-ORIGINAL.' },
      { name: 'B', prompt: 'Write one line containing the token B-ORIGINAL.' },
    ],
    edges: [['A', 'B']] as const,
  };

  it('a draft runs only as a test run; publish makes it runnable', async () => {
    engine = await createTestEngine();
    const svc = engine.services.workflowDefinitionService;
    const { definitionId } = await engine.importDefinition(LINEAR);
    // importDefinition publishes; make a fresh draft from its graph.
    const draft = await svc.createFromSpec((await svc.get(definitionId)).graph, { canEditCommands: true });
    expect(draft.status).toBe('draft');

    await expect(engine.runWorkflow({ definitionId: draft.id })).rejects.toBeInstanceOf(ConflictError);

    const test = await (await engine.runWorkflow({ definitionId: draft.id }, {}, { testRun: true })).waitForTerminal();
    expect(test.run.status).toBe('completed');
    const kindOf = (versionId: string) =>
      (engine!.sqlite.prepare('SELECT kind FROM workflow_definition_versions WHERE id = ?').get(versionId) as { kind: string }).kind;
    expect(kindOf(test.run.definitionVersionId)).toBe('test');

    const published = await svc.publish(draft.id);
    expect(published.status).toBe('published');
    expect(published.hasUnpublishedChanges).toBe(false);
    const real = await (await engine.runWorkflow({ definitionId: draft.id })).waitForTerminal();
    expect(real.run.status).toBe('completed');
    expect(real.run.definitionVersionId).toBe(published.currentVersionId);
    expect(kindOf(real.run.definitionVersionId)).toBe('published');
  });

  it('a run keeps its pinned version when the definition is edited and republished mid-run (W-13)', async () => {
    engine = await createTestEngine({ script: { A: [{ text: 'A-ORIGINAL line that is long enough to be kept as is.', delayMs: 1500 }] } });
    const svc = engine.services.workflowDefinitionService;
    const { definitionId } = await engine.importDefinition(LINEAR);
    const run = await engine.runWorkflow({ definitionId });
    const before = await svc.get(definitionId);

    const edited = structuredClone(before.graph);
    edited.stages[1]!.prompts[0]!.text = 'Write one line containing the token B-EDITED.';
    const saved = await svc.saveGraph(definitionId, edited, before.revision, { canEditCommands: false });
    expect(saved.revision).toBe(before.revision + 1);
    expect(saved.hasUnpublishedChanges).toBe(true);
    const republished = await svc.publish(definitionId);
    expect(republished.currentVersionId).not.toBe(before.currentVersionId);

    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    expect(snap.run.definitionVersionId).toBe(before.currentVersionId);
    const bPrompt = snap.calls.find((c) => c.stageName === 'B' && c.kind === 'prompt')!;
    expect(bPrompt.prompt).toContain('B-ORIGINAL');
    expect(bPrompt.prompt).not.toContain('B-EDITED');
  });

  it('a stale revision is a conflict, and deleting a definition with runs archives it', async () => {
    engine = await createTestEngine();
    const svc = engine.services.workflowDefinitionService;
    const { definitionId } = await engine.importDefinition(LINEAR);
    const record = await svc.get(definitionId);
    await svc.saveGraph(definitionId, record.graph, record.revision, { canEditCommands: false });

    const err = await svc.saveGraph(definitionId, record.graph, record.revision, { canEditCommands: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RevisionConflictError);
    expect((err as RevisionConflictError).current.revision).toBe(record.revision + 1);

    // Adding a command-bearing field needs the command-edit scope.
    const withHook = structuredClone(record.graph);
    withHook.stages[0]!.hooks = [hook('x', 'pre_run')] as never;
    await expect(svc.saveGraph(definitionId, withHook, record.revision + 1, { canEditCommands: false })).rejects.toThrow(/admin:settings/);

    await (await engine.runWorkflow({ definitionId })).waitForTerminal();
    expect(await svc.delete(definitionId)).toEqual({ archived: true, runs: 1 });
    expect((await svc.get(definitionId)).archivedAt).not.toBeNull();
    await expect(engine.runWorkflow({ definitionId })).rejects.toBeInstanceOf(ConflictError);

    const { definitionId: unused } = await engine.importDefinition({ ...LINEAR, name: 'unused' });
    expect(await svc.delete(unused)).toEqual({ deleted: true });
  });
});
