// ────────────────────────────────────────────────────────────────
// DAGScheduler Tests  (P3.15)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { DAGScheduler } from '../src/services/DAGScheduler.js';
import {
  MockStageDefinitionRepository,
  MockStageEdgeRepository,
  MockStageRunRepository,
  MockWorkflowRunRepository,
} from './MockRepositories.js';
import type { StageDefinition, StageEdge, StageRun, WorkflowRun } from '@generatorai/shared';

// ── Helpers ──

let counter = 0;

function stageId(): string {
  return `stage-${++counter}`;
}

function makeStageDef(
  id: string,
  workflowDefinitionId: string,
  order: number,
): StageDefinition {
  return {
    id,
    workflowDefinitionId,
    name: `Stage ${id}`,
    order,
    prompts: [{ label: 'P', text: 'do it', waitForCompletion: true }],
    variables: {},
    hooks: [],
    createdAt: new Date(),
  };
}

function makeEdge(
  workflowDefinitionId: string,
  from: string,
  to: string,
  edgeType: StageEdge['edgeType'] = 'on_success',
): StageEdge {
  return {
    id: `edge-${++counter}`,
    workflowDefinitionId,
    fromStageId: from,
    toStageId: to,
    edgeType,
  };
}

function makeStageRun(
  id: string,
  workflowRunId: string,
  stageDefId: string,
  status: StageRun['status'] = 'pending',
): StageRun {
  return {
    id,
    workflowRunId,
    stageDefinitionId: stageDefId,
    name: `SR ${stageDefId}`,
    status,
    currentStep: 0,
    totalSteps: 1,
    retryCount: 0,
    createdAt: new Date(),
  };
}

describe('DAGScheduler', () => {
  let scheduler: DAGScheduler;
  let stageDefRepo: MockStageDefinitionRepository;
  let edgeRepo: MockStageEdgeRepository;
  let stageRunRepo: MockStageRunRepository;

  const DEF_ID = 'def-1';
  const RUN_ID = 'run-1';

  beforeEach(() => {
    counter = 0;
    stageDefRepo = new MockStageDefinitionRepository();
    edgeRepo = new MockStageEdgeRepository();
    stageRunRepo = new MockStageRunRepository();

    scheduler = new DAGScheduler(stageDefRepo, edgeRepo, stageRunRepo);
  });

  // ── buildDAGForDefinition ──

  describe('buildDAGForDefinition', () => {
    it('should build and cache a DAG', async () => {
      const a = stageId();
      const b = stageId();
      await stageDefRepo.create(makeStageDef(a, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(b, DEF_ID, 1));
      await edgeRepo.create(makeEdge(DEF_ID, a, b));

      const dag1 = await scheduler.buildDAGForDefinition(DEF_ID);
      expect(dag1.nodes.size).toBe(2);
      expect(dag1.rootIds).toContain(a);

      // Second call should return cached
      const dag2 = await scheduler.buildDAGForDefinition(DEF_ID);
      expect(dag2).toBe(dag1); // same reference
    });

    it('should rebuild after clearCache', async () => {
      const a = stageId();
      await stageDefRepo.create(makeStageDef(a, DEF_ID, 0));

      const dag1 = await scheduler.buildDAGForDefinition(DEF_ID);
      scheduler.clearCache(DEF_ID);
      const dag2 = await scheduler.buildDAGForDefinition(DEF_ID);
      expect(dag2).not.toBe(dag1); // new reference
    });
  });

  // ── Linear DAG: A → B → C ──

  describe('linear DAG (A → B → C)', () => {
    let A: string, B: string, C: string;

    beforeEach(async () => {
      A = stageId(); B = stageId(); C = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      await stageDefRepo.create(makeStageDef(C, DEF_ID, 2));
      await edgeRepo.create(makeEdge(DEF_ID, A, B));
      await edgeRepo.create(makeEdge(DEF_ID, B, C));
    });

    it('should identify root stages', async () => {
      const roots = [...(await scheduler.buildDAGForDefinition(DEF_ID)).rootIds];
      expect(roots).toEqual([A]);
    });

    it('should mark only A as ready initially', async () => {
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'pending'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'pending'));
      await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'pending'));

      const ready = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(ready).toEqual([A]);
    });

    it('should schedule B after A completes', async () => {
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'pending'));
      await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'pending'));

      const next = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(next).toContain(B);
      expect(next).not.toContain(C);
    });

    it('should detect DAG completion when all stages terminal', async () => {
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'completed'));

      const complete = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).runTerminal !== undefined;
      expect(complete).toBe(true);
    });

    it('should not be complete while stages are still pending', async () => {
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'running'));
      await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'pending'));

      const complete = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).runTerminal !== undefined;
      expect(complete).toBe(false);
    });
  });

  // ── Parallel / Diamond DAG: A → B, A → C, B → D, C → D ──

  describe('diamond DAG (A → [B, C] → D)', () => {
    let A: string, B: string, C: string, D: string;

    beforeEach(async () => {
      A = stageId(); B = stageId(); C = stageId(); D = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      await stageDefRepo.create(makeStageDef(C, DEF_ID, 1));
      await stageDefRepo.create(makeStageDef(D, DEF_ID, 2));
      await edgeRepo.create(makeEdge(DEF_ID, A, B));
      await edgeRepo.create(makeEdge(DEF_ID, A, C));
      await edgeRepo.create(makeEdge(DEF_ID, B, D));
      await edgeRepo.create(makeEdge(DEF_ID, C, D));
    });

    it('should identify only A as root', async () => {
      const roots = [...(await scheduler.buildDAGForDefinition(DEF_ID)).rootIds];
      expect(roots).toEqual([A]);
    });

    it('should schedule B and C after A completes', async () => {
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'pending'));
      await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'pending'));
      await stageRunRepo.create(makeStageRun('sr-d', RUN_ID, D, 'pending'));

      const next = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(next).toContain(B);
      expect(next).toContain(C);
      expect(next).not.toContain(D);
    });

    it('should NOT schedule D when only B completes (C still pending)', async () => {
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'pending'));
      await stageRunRepo.create(makeStageRun('sr-d', RUN_ID, D, 'pending'));

      const next = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(next).not.toContain(D);
    });

    it('should schedule D once both B and C are complete', async () => {
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-d', RUN_ID, D, 'pending'));

      const next = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(next).toContain(D);
    });
  });

  // ── Fan-out DAG: A → [B, C, D] ──

  describe('fan-out DAG (A → [B, C, D])', () => {
    let A: string, B: string, C: string, D: string;

    beforeEach(async () => {
      A = stageId(); B = stageId(); C = stageId(); D = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      await stageDefRepo.create(makeStageDef(C, DEF_ID, 1));
      await stageDefRepo.create(makeStageDef(D, DEF_ID, 1));
      await edgeRepo.create(makeEdge(DEF_ID, A, B));
      await edgeRepo.create(makeEdge(DEF_ID, A, C));
      await edgeRepo.create(makeEdge(DEF_ID, A, D));
    });

    it('should schedule all children after A completes', async () => {
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'pending'));
      await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'pending'));
      await stageRunRepo.create(makeStageRun('sr-d', RUN_ID, D, 'pending'));

      const next = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(next).toContain(B);
      expect(next).toContain(C);
      expect(next).toContain(D);
    });
  });

  // ── Failure propagation ──

  describe('failure propagation', () => {
    it('does NOT run a success-only successor of a failed stage — it skips it', async () => {
      const A = stageId();
      const B = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      await edgeRepo.create(makeEdge(DEF_ID, A, B)); // default: on_success

      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'failed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'pending'));

      // Terminal-ness alone must not make B ready: its only inbound edge is
      // on_success and A failed, so the edge is inactive.
      const ready = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(ready).not.toContain(B);

      // And it must be positively skipped, never left pending forever.
      const skippable = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toSkip;
      expect(skippable).toContain(B);
    });

    /**
     * 5.5 — the diamond that used to hang forever. A → (B, C) → D on default
     * on_success edges. B succeeds, C fails: the old router looked only at the
     * stage that just finished (so it scheduled nothing) while the old skipper
     * asked "is ANY inbound edge active?" (B's was, so it skipped nothing),
     * leaving D pending for the life of the process.
     */
    describe('diamond with one failed branch (5.5)', () => {
      const A = stageId();
      const B = stageId();
      const C = stageId();
      const D = stageId();

      beforeEach(async () => {
        await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
        await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
        await stageDefRepo.create(makeStageDef(C, DEF_ID, 2));
        await stageDefRepo.create(makeStageDef(D, DEF_ID, 3));
        await edgeRepo.create(makeEdge(DEF_ID, A, B));
        await edgeRepo.create(makeEdge(DEF_ID, A, C));
        await edgeRepo.create(makeEdge(DEF_ID, B, D));
        await edgeRepo.create(makeEdge(DEF_ID, C, D));

        await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
        await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'completed'));
        await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'failed'));
        await stageRunRepo.create(makeStageRun('sr-d', RUN_ID, D, 'pending'));
      });

      it('skips the join instead of hanging, and never launches it', async () => {
        const rec = await scheduler.reconcileRun(RUN_ID, DEF_ID);
        expect(rec.toSkip).toContain(D);
        expect(rec.toLaunch).not.toContain(D);
      });

      it('reports the run as failed once the join is skipped', async () => {
        await stageRunRepo.updateStatus('sr-d', 'skipped');
        const rec = await scheduler.reconcileRun(RUN_ID, DEF_ID);
        expect(rec.runTerminal).toBe('failed');
      });

      it('re-driving after a restart does not launch the join either', async () => {
        // The old restart path ignored edge types entirely and ran D.
        scheduler.clearCache(DEF_ID);
        const ready = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
        expect(ready).not.toContain(D);
      });
    });

    it('treats a cancelled stage as terminal and does not report the run completed', async () => {
      const A = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'cancelled'));

      const rec = await scheduler.reconcileRun(RUN_ID, DEF_ID);
      expect(rec.runTerminal).toBe('cancelled');
    });
  });

  // ── run completion (runTerminal) ──

  describe("run completion", () => {
    it('should return true when all stages are in terminal state', async () => {
      const A = stageId();
      const B = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      await edgeRepo.create(makeEdge(DEF_ID, A, B));

      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'skipped'));

      expect((await scheduler.reconcileRun(RUN_ID, DEF_ID)).runTerminal !== undefined).toBe(true);
    });

    it('should return false when a stage has no run', async () => {
      const A = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));

      // No stage run exists for A
      expect((await scheduler.reconcileRun(RUN_ID, DEF_ID)).runTerminal !== undefined).toBe(false);
    });
  });

  // ── terminal run status (EXEC-5) ──

  describe('reconcileRun().runTerminal', () => {
    it('returns completed when all stages completed', async () => {
      const A = stageId(); const B = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      await edgeRepo.create(makeEdge(DEF_ID, A, B));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'completed'));
      expect((await scheduler.reconcileRun(RUN_ID, DEF_ID)).runTerminal).toBe('completed');
    });

    it('returns failed for an unhandled failure (on_success successor skipped)', async () => {
      const A = stageId(); const B = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      await edgeRepo.create(makeEdge(DEF_ID, A, B, 'on_success'));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'failed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'skipped'));
      expect((await scheduler.reconcileRun(RUN_ID, DEF_ID)).runTerminal).toBe('failed');
    });

    it('returns completed when a failure is handled by an on_failure recovery', async () => {
      const A = stageId(); const R = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(R, DEF_ID, 1));
      await edgeRepo.create(makeEdge(DEF_ID, A, R, 'on_failure'));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'failed'));
      await stageRunRepo.create(makeStageRun('sr-r', RUN_ID, R, 'completed'));
      expect((await scheduler.reconcileRun(RUN_ID, DEF_ID)).runTerminal).toBe('completed');
    });

    it('returns failed when the recovery branch itself fails unhandled', async () => {
      const A = stageId(); const R = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(R, DEF_ID, 1));
      await edgeRepo.create(makeEdge(DEF_ID, A, R, 'on_failure'));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'failed'));
      await stageRunRepo.create(makeStageRun('sr-r', RUN_ID, R, 'failed'));
      expect((await scheduler.reconcileRun(RUN_ID, DEF_ID)).runTerminal).toBe('failed');
    });

    it('resolves multi-level recovery (A fail → R fail → R2 complete)', async () => {
      const A = stageId(); const R = stageId(); const R2 = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(R, DEF_ID, 1));
      await stageDefRepo.create(makeStageDef(R2, DEF_ID, 2));
      await edgeRepo.create(makeEdge(DEF_ID, A, R, 'on_failure'));
      await edgeRepo.create(makeEdge(DEF_ID, R, R2, 'on_failure'));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'failed'));
      await stageRunRepo.create(makeStageRun('sr-r', RUN_ID, R, 'failed'));
      await stageRunRepo.create(makeStageRun('sr-r2', RUN_ID, R2, 'completed'));
      expect((await scheduler.reconcileRun(RUN_ID, DEF_ID)).runTerminal).toBe('completed');
    });
  });

  // ── Skip routing of `always` edges (EXEC-6) ──

  describe('always-edge skip routing', () => {
    it('routes an always edge out of a skipped stage', async () => {
      // A → B (on_success), B → C (always). A fails → B skipped → C reachable via `always`.
      const A = stageId(); const B = stageId(); const C = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      await stageDefRepo.create(makeStageDef(C, DEF_ID, 2));
      await edgeRepo.create(makeEdge(DEF_ID, A, B, 'on_success'));
      await edgeRepo.create(makeEdge(DEF_ID, B, C, 'always'));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'failed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'skipped'));
      await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'pending'));

      const next = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(next).toContain(C);
    });

    it('does NOT skip a stage reachable via an always edge from a skipped predecessor', async () => {
      const A = stageId(); const B = stageId(); const C = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      await stageDefRepo.create(makeStageDef(C, DEF_ID, 2));
      await edgeRepo.create(makeEdge(DEF_ID, A, B, 'on_success'));
      await edgeRepo.create(makeEdge(DEF_ID, B, C, 'always'));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'failed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'skipped'));
      await stageRunRepo.create(makeStageRun('sr-c', RUN_ID, C, 'pending'));

      const skippable = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toSkip;
      expect(skippable).not.toContain(C);
    });
  });

  // ── SCHEMA-3: variables.* in edge conditions ──
  describe('variables.* edge conditions (SCHEMA-3)', () => {
    function makeRun(variables: Record<string, unknown>): WorkflowRun {
      return {
        id: RUN_ID,
        workflowDefinitionId: DEF_ID,
        status: 'running',
        sessionMode: 'per-stage',
        variables,
        tags: [],
        requiresCodebase: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowRun;
    }

    function withCondition(def: StageDefinition, expression: string): StageDefinition {
      return { ...def, condition: { type: 'expression', expression } };
    }

    it('schedules a conditional successor when variables.* expression is TRUE', async () => {
      const A = stageId(); const B = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(
        withCondition(makeStageDef(B, DEF_ID, 1), "variables.env == 'prod'"),
      );
      await edgeRepo.create(makeEdge(DEF_ID, A, B, 'on_success'));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'pending'));

      const runRepo = new MockWorkflowRunRepository();
      await runRepo.create(makeRun({ env: 'prod' }));
      const sched = new DAGScheduler(stageDefRepo, edgeRepo, stageRunRepo, runRepo);

      const next = (await sched.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(next).toContain(B);
    });

    it('does NOT schedule the successor when variables.* expression is FALSE', async () => {
      const A = stageId(); const B = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(
        withCondition(makeStageDef(B, DEF_ID, 1), "variables.env == 'prod'"),
      );
      await edgeRepo.create(makeEdge(DEF_ID, A, B, 'on_success'));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'pending'));

      const runRepo = new MockWorkflowRunRepository();
      await runRepo.create(makeRun({ env: 'dev' }));
      const sched = new DAGScheduler(stageDefRepo, edgeRepo, stageRunRepo, runRepo);

      const next = (await sched.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(next).not.toContain(B);
    });

    it('treats variables.* as undefined (condition false) when no run repo is wired', async () => {
      const A = stageId(); const B = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(
        withCondition(makeStageDef(B, DEF_ID, 1), "variables.env == 'prod'"),
      );
      await edgeRepo.create(makeEdge(DEF_ID, A, B, 'on_success'));
      await stageRunRepo.create(makeStageRun('sr-a', RUN_ID, A, 'completed'));
      await stageRunRepo.create(makeStageRun('sr-b', RUN_ID, B, 'pending'));

      // scheduler from beforeEach has NO runRepo
      const next = (await scheduler.reconcileRun(RUN_ID, DEF_ID)).toLaunch;
      expect(next).not.toContain(B);
    });
  });

  // ── Two-tier definition cache validation (P1-19) ──
  //
  // The cache MUST still bust on every mid-run definition edit; these pin that
  // guarantee down now that the check is no longer a digest over everything.

  describe('definition cache validation (P1-19)', () => {
    function withExpression(def: StageDefinition, expression: string): StageDefinition {
      return { ...def, condition: { type: 'expression', expression } };
    }

    it('busts the cache when a stage is added mid-run', async () => {
      const A = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      const dag1 = await scheduler.buildDAGForDefinition(DEF_ID);

      await stageDefRepo.create(makeStageDef(stageId(), DEF_ID, 1));

      const dag2 = await scheduler.buildDAGForDefinition(DEF_ID);
      expect(dag2).not.toBe(dag1);
      expect(dag2.nodes.size).toBe(2);
    });

    it('busts the cache when an edge is added mid-run', async () => {
      const A = stageId();
      const B = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      const dag1 = await scheduler.buildDAGForDefinition(DEF_ID);
      expect(dag1.rootIds).toEqual([A, B]);

      await edgeRepo.create(makeEdge(DEF_ID, A, B));

      const dag2 = await scheduler.buildDAGForDefinition(DEF_ID);
      expect(dag2).not.toBe(dag1);
      expect(dag2.rootIds).toEqual([A]);
    });

    it('busts the cache when a stage order changes mid-run', async () => {
      const A = stageId();
      const B = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(makeStageDef(B, DEF_ID, 1));
      await edgeRepo.create(makeEdge(DEF_ID, A, B));
      const dag1 = await scheduler.buildDAGForDefinition(DEF_ID);

      await stageDefRepo.update(B, { order: 7 });

      expect(await scheduler.buildDAGForDefinition(DEF_ID)).not.toBe(dag1);
    });

    it('busts the cache when only a condition body is edited mid-run', async () => {
      // The cheap tier-1 signature cannot see inside a condition — same stage
      // ids, same order, same edges, condition still present — so this is the
      // case that the condition digest exists to catch.
      const A = stageId();
      const B = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      await stageDefRepo.create(
        withExpression(makeStageDef(B, DEF_ID, 1), "variables.env == 'prod'"),
      );
      await edgeRepo.create(makeEdge(DEF_ID, A, B));
      const dag1 = await scheduler.buildDAGForDefinition(DEF_ID);

      await stageDefRepo.update(B, {
        condition: { type: 'expression', expression: "variables.env == 'dev'" },
      });

      const dag2 = await scheduler.buildDAGForDefinition(DEF_ID);
      expect(dag2).not.toBe(dag1);
      expect(dag2.nodes.get(B)?.stage.condition).toEqual({
        type: 'expression',
        expression: "variables.env == 'dev'",
      });
    });

    it('busts the cache when a condition is added to a previously plain stage', async () => {
      const A = stageId();
      await stageDefRepo.create(makeStageDef(A, DEF_ID, 0));
      const dag1 = await scheduler.buildDAGForDefinition(DEF_ID);

      await stageDefRepo.update(A, {
        condition: { type: 'expression', expression: 'variables.go == true' },
      });

      expect(await scheduler.buildDAGForDefinition(DEF_ID)).not.toBe(dag1);
    });

    it('validates an unchanged condition-free definition without any crypto digest', async () => {
      // Regression for P1-19: validation used to SHA-1 every stage and every
      // edge on every call, i.e. on every stage completion.
      for (let i = 0; i < 50; i++) {
        await stageDefRepo.create(makeStageDef(`plain-${i}`, DEF_ID, i));
        if (i > 0) await edgeRepo.create(makeEdge(DEF_ID, `plain-${i - 1}`, `plain-${i}`));
      }

      const dag1 = await scheduler.buildDAGForDefinition(DEF_ID);
      for (let i = 0; i < 5; i++) {
        expect(await scheduler.buildDAGForDefinition(DEF_ID)).toBe(dag1);
      }

      expect(scheduler.stats.dagBuilds).toBe(1);
      expect(scheduler.stats.conditionDigests).toBe(0);
    });
  });

  // The incremental-frontier optimisation (P1-19) was removed when the four
  // divergent readiness predicates were consolidated into one reconcile pass
  // (review item 5.5). There is now a single full-graph evaluation, so there is
  // no second code path left to prove equivalent to it.
})
