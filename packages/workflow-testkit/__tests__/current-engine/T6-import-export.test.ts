// ────────────────────────────────────────────────────────────────
// T6 — definition create, export → import round trip, malformed imports
// (F_live_tests §1 T6, §2 F-12, F-13; `t6.mts`).
//
// Drives the service methods behind the routes, after parsing each body
// with the SAME zod schema the route validates with.
//
// CHARACTERISATION of today's engine. `// KNOWN-BUG W-xx` marks the
// assertions PHASE-01 flips (the definition model is rewritten there).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { CreateStageSchema, CreateWorkflowDefinitionSchema, ImportWorkflowJsonSchema } from '@generatorai/shared';
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

const FULL_DEF = {
  name: 't6-roundtrip',
  description: 'complex def for round trip',
  sessionMode: 'per-stage',
  harnessConfig: { model: 'haiku', reasoningEffort: 'low', maxTurns: 7 },
  variables: [{ name: 'topic', type: 'string', label: 'Topic', required: true, defaultValue: 'cats' }],
  orchestratorConfig: {
    category: 'custom',
    codebaseAliases: [],
    requiresCodebase: false,
    preprocessingSteps: [{ type: 'set_variable', name: 'pp', config: { k: 'v' }, failOnError: false, order: 0 }],
    resultValidations: [{ stageIndex: 0, rules: [{ type: 'contains', value: 'WF-LEVEL', message: 'wf-level rule' }] }],
    postProcessingSteps: [],
  },
  skills: [{ name: 'skillA', description: 'dA' }],
  agents: [{ name: 'agentA', description: 'aa', instructions: 'ii', tools: ['Read'] }],
  hooks: [hook('wh1', 'on_run_start')],
  hooksFile: { version: 1, workflow: [hook('hf1', 'on_run_complete')], stages: { S0: [hook('hfs1', 'pre_run')] } },
  useWorktree: false,
  browserConfig: { enabled: true, visibility: 'headless', allowedHosts: ['example.com'] },
  defaultAgentRef: 'user:default-agent',
};

const stageBody = (name: string, order: number) => ({
  name,
  order,
  prompts: [{ label: 'p1', text: `Do {{topic}} ${name}` }],
  retryPolicy: { maxRetries: 3, backoffMs: 1500, backoffMultiplier: 3 },
  contextFilter: 'full',
  approvalRequired: true,
  agentMode: 'plan',
  skills: [{ name: 'stageSkill' }],
  browserConfig: { visibility: 'visible' },
});

describe('T6 definitions: create and export → import (current engine)', () => {
  it('create drops fields it accepted, and the round trip loses more', async () => {
    engine = await createTestEngine();
    const svc = engine.services.workflowDefinitionService;
    // POST /workflow-definitions, /:id/stages, /:id/edges.
    const created = await svc.createDefinition(CreateWorkflowDefinitionSchema.parse(FULL_DEF) as never);
    const stageSchema = CreateStageSchema.omit({ workflowDefinitionId: true });
    const ids: string[] = [];
    for (const [i, n] of ['S0', 'S1', 'S2', 'S3'].entries()) {
      const s = await svc.addStage({ ...(stageSchema.parse(stageBody(n, i)) as never), workflowDefinitionId: created.id });
      ids.push(s.id);
    }
    const edgeTypes = [
      [0, 1, 'on_success'],
      [0, 2, 'on_failure'],
      [1, 3, 'on_completion'],
      [2, 3, 'always'],
    ] as const;
    for (const [f, t, edgeType] of edgeTypes) {
      await svc.addEdge({ workflowDefinitionId: created.id, fromStageId: ids[f]!, toStageId: ids[t]!, edgeType });
    }
    const orig = await svc.getDefinitionWithStages(created.id);

    // Create silently drops accepted fields (F-12).
    expect(orig.skills ?? null).toBeNull(); // KNOWN-BUG W-20 (definition skills dropped)
    expect(orig.agents ?? null).toBeNull(); // KNOWN-BUG W-20 (definition agents dropped)
    expect(orig.defaultAgentRef ?? null).toBeNull(); // KNOWN-BUG W-20 (defaultAgentRef dropped)
    expect(orig.useWorktree).toBe(true); // KNOWN-BUG W-20 (useWorktree:false stored as true)
    expect((orig as { browserConfig?: unknown }).browserConfig).toBeUndefined(); // KNOWN-BUG W-20 (no column)
    expect((orig.stages[0] as { skills?: unknown }).skills).toBeUndefined(); // KNOWN-BUG W-20 (stage skills dropped)
    expect((orig.stages[0] as { browserConfig?: unknown }).browserConfig).toBeUndefined(); // KNOWN-BUG W-20
    // Stored correctly.
    expect(orig.orchestratorConfig?.preprocessingSteps).toHaveLength(1);
    expect(orig.hooksFile).toBeDefined();
    expect(orig.stages[0]!.agentMode).toBe('plan');

    // GET /:id/export → POST /import-json.
    const exported = await svc.exportAsTemplate(created.id);
    const imported = await svc.importFromJSON(ImportWorkflowJsonSchema.parse(exported));
    const back = await svc.getDefinitionWithStages(imported.id);

    expect(back.orchestratorConfig).toBeUndefined(); // KNOWN-BUG W-25 (preprocessing + workflow-level validations lost)
    expect(back.hooksFile).toBeUndefined(); // KNOWN-BUG W-25 (hooksFile not exported)
    expect(back.stages.every((s) => s.agentMode === undefined)).toBe(true); // KNOWN-BUG W-25 (agentMode not exported)
    expect(back.tags).toEqual(['json-import']);

    // Preserved.
    expect(back.stages.map((s) => s.name)).toEqual(['S0', 'S1', 'S2', 'S3']);
    expect(back.stages[1]!.retryPolicy).toEqual({ maxRetries: 3, backoffMs: 1500, backoffMultiplier: 3 });
    expect(back.stages[1]!.approvalRequired).toBe(true);
    expect(back.hooks).toHaveLength(1);
    expect(back.variables).toEqual(orig.variables);
    const edgeKey = (e: { fromStageId: string; toStageId: string; edgeType: string }, stages: Array<{ id: string }>) =>
      `${stages.findIndex((s) => s.id === e.fromStageId)}->${stages.findIndex((s) => s.id === e.toStageId)}:${e.edgeType}`;
    expect(back.edges.map((e) => edgeKey(e, back.stages)).sort()).toEqual(
      orig.edges.map((e) => edgeKey(e, orig.stages)).sort(),
    );
  });
});

describe('T6 malformed imports (current engine)', () => {
  const base = {
    name: 'bad',
    stages: [
      { name: 'a', order: 0, prompts: [{ label: 'a', text: 'a' }] },
      { name: 'b', order: 1, prompts: [{ label: 'b', text: 'b' }] },
    ],
    edges: [] as Array<Record<string, unknown>>,
  };

  async function tryImport(e: TestEngine, doc: unknown): Promise<'accepted' | 'rejected'> {
    const parsed = ImportWorkflowJsonSchema.safeParse(doc);
    if (!parsed.success) return 'rejected';
    try {
      await e.services.workflowDefinitionService.importFromJSON(parsed.data);
      return 'accepted';
    } catch {
      return 'rejected';
    }
  }

  it('rejects structural errors', async () => {
    engine = await createTestEngine();
    const cases: Record<string, unknown> = {
      cycle: { ...base, edges: [{ fromStageIndex: 0, toStageIndex: 1 }, { fromStageIndex: 1, toStageIndex: 0 }] },
      selfLoop: { ...base, edges: [{ fromStageIndex: 0, toStageIndex: 0 }] },
      missingStage: { ...base, edges: [{ fromStageIndex: 0, toStageIndex: 5 }] },
      duplicateEdge: { ...base, edges: [{ fromStageIndex: 0, toStageIndex: 1 }, { fromStageIndex: 0, toStageIndex: 1 }] },
      zeroStages: { ...base, stages: [] },
      negativeIndex: { ...base, edges: [{ fromStageIndex: -1, toStageIndex: 1 }] },
    };
    for (const [label, doc] of Object.entries(cases)) {
      expect({ label, result: await tryImport(engine, doc) }).toEqual({ label, result: 'rejected' });
    }
  });

  it('accepts definitions that can never run as written', async () => {
    engine = await createTestEngine();
    const [a, b] = base.stages as [Record<string, unknown>, Record<string, unknown>];
    const cases: Record<string, unknown> = {
      duplicateNames: { ...base, stages: [a, { ...b, name: 'a' }] },
      duplicateOrder: { ...base, stages: [a, { ...b, order: 0 }] },
      unparseableCondition: {
        ...base,
        stages: [a, { ...b, condition: { type: 'expression', expression: '((( variables.x ==' } }],
        edges: [{ fromStageIndex: 0, toStageIndex: 1 }],
      },
      expressionWithoutText: { ...base, stages: [a, { ...b, condition: { type: 'expression' } }] },
      unknownContextSource: { ...base, stages: [a, { ...b, contextSources: ['nope'] }] },
    };
    for (const [label, doc] of Object.entries(cases)) {
      expect({ label, result: await tryImport(engine, doc) }).toEqual({ label, result: 'accepted' }); // KNOWN-BUG W-30 (validator accepts broken definitions)
    }
    // Unknown fields are stripped silently rather than rejected.
    const unknown = { ...base, bogusTop: 1, stages: base.stages.map((s) => ({ ...s, bogusStage: true })) };
    expect(await tryImport(engine, unknown)).toBe('accepted'); // KNOWN-BUG W-64 (import is non-strict)
  });
});
