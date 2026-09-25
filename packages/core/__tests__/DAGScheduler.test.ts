// ────────────────────────────────────────────────────────────────
// DAGScheduler Tests — scheduling over a run's pinned v2 graph, keyed by
// stage key (P01 WP-1.7).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import type { StageRun, StageRunStatus, WorkflowRun } from '@generatorai/shared';
import { DAGScheduler } from '../src/services/DAGScheduler.js';
import { RunDefinitionReader } from '../src/services/definitions/RunDefinitionReader.js';
import {
  MockStageRunRepository,
  MockWorkflowDefinitionStore,
  MockWorkflowRunRepository,
  seedDefinition,
  testGraph,
  type SeedEdge,
  type SeedStage,
} from './MockRepositories.js';

const RUN_ID = 'run-1';

/** The workflow variables the expression tests reference (expressions are typed at save). */
const VARIABLES = {
  variables: [
    { name: 'env', type: 'string', label: 'Env' },
    { name: 'count', type: 'number', label: 'Count' },
    { name: 'missing', type: 'number', label: 'Missing' },
  ],
};

describe('DAGScheduler', () => {
  let store: MockWorkflowDefinitionStore;
  let stageRunRepo: MockStageRunRepository;
  let runRepo: MockWorkflowRunRepository;
  let scheduler: DAGScheduler;

  beforeEach(() => {
    store = new MockWorkflowDefinitionStore();
    stageRunRepo = new MockStageRunRepository();
    runRepo = new MockWorkflowRunRepository(stageRunRepo);
    scheduler = new DAGScheduler(new RunDefinitionReader(store), stageRunRepo, runRepo);
  });

  /**
   * Seed a published definition, a run pinned to its version, and one stage
   * run per entry of `statuses` (a stage missing from it has no stage run).
   */
  async function setup(
    stages: SeedStage[],
    edges: SeedEdge[],
    statuses: Record<string, StageRunStatus>,
    variables: Record<string, unknown> = {},
  ): Promise<void> {
    const { definitionId, versionId } = await seedDefinition(store, testGraph(stages, edges, VARIABLES));
    await runRepo.create({
      id: RUN_ID,
      workflowDefinitionId: definitionId,
      definitionVersionId: versionId,
      name: 'run',
      status: 'running',
      sessionMode: 'per-stage',
      variables,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as WorkflowRun);
    for (const [key, status] of Object.entries(statuses)) {
      await stageRunRepo.create({
        id: `sr-${key}`,
        workflowRunId: RUN_ID,
        stageKey: key,
        name: key,
        status,
        currentStep: 0,
        totalSteps: 1,
        retryCount: 0,
        version: 0,
        createdAt: new Date(),
      } as StageRun);
    }
  }

  const reconcile = () => scheduler.reconcileRun(RUN_ID);

  // ── DAG construction ──

  describe('buildDAGForRun', () => {
    it('builds the pinned version DAG keyed by stage key, once per version', async () => {
      const { versionId } = await seedDefinition(store, testGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]));
      const dag = await scheduler.buildDAGForRun({ definitionVersionId: versionId });
      expect([...dag.nodes.keys()]).toEqual(['a', 'b', 'c']);
      expect(dag.rootIds).toEqual(['a']);
      expect(dag.leafIds).toEqual(['c']);
      expect(await scheduler.buildDAGForRun({ definitionVersionId: versionId })).toBe(dag);
      expect(scheduler.stats.dagBuilds).toBe(1);
    });
  });

  // ── Linear: a → b → c ──

  describe('linear DAG (a → b → c)', () => {
    const stages = ['a', 'b', 'c'];
    const edges: SeedEdge[] = [['a', 'b'], ['b', 'c']];

    it('launches only the root initially', async () => {
      await setup(stages, edges, { a: 'pending', b: 'pending', c: 'pending' });
      expect((await reconcile()).toLaunch).toEqual(['a']);
    });

    it('launches b after a completes', async () => {
      await setup(stages, edges, { a: 'completed', b: 'pending', c: 'pending' });
      const rec = await reconcile();
      expect(rec.toLaunch).toEqual(['b']);
      expect(rec.runTerminal).toBeUndefined();
    });

    it('is terminal once every stage is terminal, not while one is running', async () => {
      await setup(stages, edges, { a: 'completed', b: 'running', c: 'pending' });
      expect((await reconcile()).runTerminal).toBeUndefined();
      await stageRunRepo.updateStatus('sr-b', 'completed');
      await stageRunRepo.updateStatus('sr-c', 'completed');
      expect((await reconcile()).runTerminal).toBe('completed');
    });

    it('is not terminal while a stage has no stage run', async () => {
      await setup(stages, edges, { a: 'completed', b: 'completed' });
      expect((await reconcile()).runTerminal).toBeUndefined();
    });
  });

  // ── Diamond: a → (b, c) → d ──

  describe('diamond DAG (a → [b, c] → d)', () => {
    const stages = ['a', 'b', 'c', 'd'];
    const edges: SeedEdge[] = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']];

    it('launches both branches after a completes', async () => {
      await setup(stages, edges, { a: 'completed', b: 'pending', c: 'pending', d: 'pending' });
      expect((await reconcile()).toLaunch.sort()).toEqual(['b', 'c']);
    });

    it('holds the join until both branches are terminal', async () => {
      await setup(stages, edges, { a: 'completed', b: 'completed', c: 'running', d: 'pending' });
      const rec = await reconcile();
      expect(rec.toLaunch).toEqual([]);
      expect(rec.toSkip).toEqual([]);
      await stageRunRepo.updateStatus('sr-c', 'completed');
      expect((await reconcile()).toLaunch).toEqual(['d']);
    });

    // 5.5 — the diamond that used to hang: c fails, the join must be skipped.
    it('skips the join when one branch fails and reports the run failed', async () => {
      await setup(stages, edges, { a: 'completed', b: 'completed', c: 'failed', d: 'pending' });
      const rec = await reconcile();
      expect(rec.toLaunch).toEqual([]);
      expect(rec.toSkip).toEqual(['d']);
      expect(rec.runTerminal).toBe('failed');
    });
  });

  // ── Fan-out: a → (b, c, d) ──

  it('fan-out launches every child after the root completes', async () => {
    await setup(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['a', 'd']], {
      a: 'completed', b: 'pending', c: 'pending', d: 'pending',
    });
    expect((await reconcile()).toLaunch.sort()).toEqual(['b', 'c', 'd']);
  });

  // ── Failure propagation ──

  describe('failure propagation', () => {
    it('skips a success-only successor of a failed stage and cascades the skip', async () => {
      await setup(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']], { a: 'failed', b: 'pending', c: 'pending' });
      const rec = await reconcile();
      expect(rec.toLaunch).toEqual([]);
      expect(rec.toSkip).toEqual(['b', 'c']);
      expect(rec.runTerminal).toBe('failed');
    });

    it('routes a failure edge to the recovery stage and skips the success path', async () => {
      await setup(['a', 'b', 'r'], [['a', 'b'], ['a', 'r', 'failure']], { a: 'failed', b: 'pending', r: 'pending' });
      const rec = await reconcile();
      expect(rec.toLaunch).toEqual(['r']);
      expect(rec.toSkip).toEqual(['b']);
    });

    it('treats a lone cancelled stage as a cancelled run', async () => {
      await setup(['a'], [], { a: 'cancelled' });
      expect((await reconcile()).runTerminal).toBe('cancelled');
    });
  });

  // ── Terminal run status ──

  describe('runTerminal', () => {
    it('is failed for an unhandled failure', async () => {
      await setup(['a', 'b'], [['a', 'b']], { a: 'failed', b: 'skipped' });
      expect((await reconcile()).runTerminal).toBe('failed');
    });

    it('is completed when a failure edge recovery completes', async () => {
      await setup(['a', 'r'], [['a', 'r', 'failure']], { a: 'failed', r: 'completed' });
      expect((await reconcile()).runTerminal).toBe('completed');
    });

    it('is failed when the recovery itself fails unhandled', async () => {
      await setup(['a', 'r'], [['a', 'r', 'failure']], { a: 'failed', r: 'failed' });
      expect((await reconcile()).runTerminal).toBe('failed');
    });

    it('resolves multi-level recovery (a fail → r fail → r2 complete)', async () => {
      await setup(['a', 'r', 'r2'], [['a', 'r', 'failure'], ['r', 'r2', 'failure']], {
        a: 'failed', r: 'failed', r2: 'completed',
      });
      expect((await reconcile()).runTerminal).toBe('completed');
    });
  });

  // ── `always` edges out of a skipped stage (EXEC-6) ──

  it('routes an always edge out of a skipped stage', async () => {
    // a → b (success), b → c (always). a fails → b skipped → c still runs.
    await setup(['a', 'b', 'c'], [['a', 'b'], ['b', 'c', 'always']], { a: 'failed', b: 'pending', c: 'pending' });
    const rec = await reconcile();
    expect(rec.toSkip).toEqual(['b']);
    expect(rec.toLaunch).toEqual(['c']);
  });

  // ── Expression v2 guards and edge `when` ──

  describe('guards and edge conditions (Expression v2)', () => {
    it('launches a guarded stage when its guard holds and skips it otherwise', async () => {
      const stages: SeedStage[] = ['a', { key: 'b', guard: "variables.env == 'prod'" }];
      await setup(stages, [['a', 'b']], { a: 'completed', b: 'pending' }, { env: 'prod' });
      expect((await reconcile()).toLaunch).toEqual(['b']);

      await store.clear();
      runRepo.clear();
      stageRunRepo.clear();
      await setup(stages, [['a', 'b']], { a: 'completed', b: 'pending' }, { env: 'dev' });
      const rec = await reconcile();
      expect(rec.toLaunch).toEqual([]);
      expect(rec.toSkip).toEqual(['b']);
    });

    it.each<[string, StageRunStatus, boolean]>([
      ["parent.status == 'completed' and variables.env == 'prod'", 'completed', true],
      ["parent.status == 'failed'", 'completed', false],
      ["parent.status == 'failed'", 'failed', true],
      ['variables.count == 5', 'completed', true],
      ['variables.missing == 1', 'completed', false],
    ])('edge when %s (source %s) → launches: %s', async (when, predStatus, launches) => {
      await setup(['a', 'b'], [['a', 'b', 'completion', when]], { a: predStatus, b: 'pending' }, { env: 'prod', count: 5 });
      const { toLaunch, toSkip } = await reconcile();
      expect(toLaunch.includes('b')).toBe(launches);
      expect(toSkip.includes('b')).toBe(!launches);
    });

    it('reads stages.<key>.status and output in a guard', async () => {
      await setup(
        [
          'a',
          { key: 'b', output: { format: 'json', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } },
          { key: 'c', guard: "stages.a.status == 'completed' and stages.b.output.ok == true" },
        ],
        [['a', 'c'], ['b', 'c']],
        { a: 'completed', b: 'completed', c: 'pending' },
      );
      await stageRunRepo.update('sr-b', { outputData: { ok: true } });
      expect((await reconcile()).toLaunch).toEqual(['c']);
    });
  });
});
