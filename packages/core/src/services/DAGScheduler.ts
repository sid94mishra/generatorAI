// ────────────────────────────────────────────────────────────────
// DAGScheduler — schedules stage execution based on DAG structure
// ────────────────────────────────────────────────────────────────

import type { StageRun, StageRunStatus } from '@generatorai/shared';
import type { IStageDefinitionRepository } from '../domain/ports/IStageDefinitionRepository.js';
import type { IStageEdgeRepository } from '../domain/ports/IStageEdgeRepository.js';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import type { IDAGScheduler } from '../domain/ports/IServiceInterfaces.js';
import { buildDAG } from '../domain/dag/DAGValidator.js';
import { evaluateCondition } from '../domain/dag/ConditionEvaluator.js';
import type { DAG } from '../domain/dag/types.js';
import { createHash } from 'node:crypto';

/**
 * Per-run FIFO queue. Replaces the older promise-chain lock that swallowed
 * prior failures via bare `.catch(() => {})`: now each queued operation
 * rejects its own caller if it throws, and subsequent queued ops still run
 * (the queue doesn't "stick" on one bad op). Errors surface to the caller.
 */
interface QueuedOp<T> {
  fn: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (err: Error) => void;
}
const runQueues = new Map<string, Array<QueuedOp<unknown>>>();
const runQueueActive = new Set<string>();

async function processQueue(runId: string): Promise<void> {
  if (runQueueActive.has(runId)) return;
  runQueueActive.add(runId);
  try {
    for (;;) {
      const queue = runQueues.get(runId);
      if (!queue || queue.length === 0) break;
      const op = queue.shift()!;
      try {
        const result = await op.fn();
        op.resolve(result);
      } catch (err) {
        op.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
    runQueues.delete(runId);
  } finally {
    runQueueActive.delete(runId);
  }
}

function withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const queue = runQueues.get(runId) ?? [];
    queue.push({
      fn: fn as () => Promise<unknown>,
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    runQueues.set(runId, queue);
    // Kick off processing asynchronously so the caller's try/await path
    // completes before we start draining the queue.
    void processQueue(runId);
  });
}

/** Stable hash of (stage ids + their order/conditions + edge tuples) used
 *  as a cache key so a mid-run edit to the definition busts the DAG. */
function hashDefinition(
  stages: Array<{ id: string; order: number; condition?: unknown }>,
  edges: Array<{ fromStageId: string; toStageId: string; edgeType?: string }>,
): string {
  const h = createHash('sha1');
  const sortedStages = [...stages].sort((a, b) => a.id.localeCompare(b.id));
  for (const s of sortedStages) {
    h.update(`${s.id}|${s.order}|${JSON.stringify(s.condition ?? null)}\n`);
  }
  const sortedEdges = [...edges].sort((a, b) =>
    (a.fromStageId + a.toStageId).localeCompare(b.fromStageId + b.toStageId),
  );
  for (const e of sortedEdges) {
    h.update(`${e.fromStageId}->${e.toStageId}:${e.edgeType ?? ''}\n`);
  }
  return h.digest('hex');
}

export class DAGScheduler implements IDAGScheduler {
  /**
   * Cached DAG per workflow definition (keyed by definitionId). The stored
   * `hash` of (stages, edges) is compared on every build; a mismatch — e.g. the
   * definition was edited mid-run — rebuilds and replaces the entry, so a stale
   * topology is never reused (resolves the old DAG-01 stale-cache risk).
   */
  private dagCache = new Map<string, { hash: string; dag: DAG }>();

  constructor(
    private stageDefRepo: IStageDefinitionRepository,
    private edgeRepo: IStageEdgeRepository,
    private stageRunRepo: IStageRunRepository,
    /**
     * Optional run repository. When provided, the run's `variables` are passed
     * into edge-condition evaluation so `expression` conditions referencing
     * `variables.*` resolve to real values instead of always `undefined`
     * (SCHEMA-3). Without it, `variables.*` references resolve to undefined
     * (the prior behaviour) — status/parentStatus conditions are unaffected.
     */
    private runRepo?: IWorkflowRunRepository,
  ) {}

  /**
   * Fetch the run's variables for condition evaluation. Returns undefined when
   * no run repo is wired or the run can't be read (conditions then fall back to
   * status-only evaluation). SCHEMA-3.
   */
  private async getRunVariables(
    workflowRunId: string,
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.runRepo) return undefined;
    try {
      const run = await this.runRepo.getById(workflowRunId);
      return run.variables ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Build the DAG for a workflow definition, reusing the cached value only
   * when the (stages, edges) hash matches. This replaces the old
   * "cache-forever-until-explicit-clearCache" behaviour that left runs
   * using a stale topology when the definition was edited mid-run.
   */
  async buildDAGForDefinition(workflowDefinitionId: string): Promise<DAG> {
    const stages = await this.stageDefRepo.getByDefinitionId(workflowDefinitionId);
    const edges = await this.edgeRepo.getByDefinitionId(workflowDefinitionId);
    const hash = hashDefinition(stages, edges);

    const cached = this.dagCache.get(workflowDefinitionId);
    if (cached && cached.hash === hash) return cached.dag;

    const dag = buildDAG(stages, edges);
    this.dagCache.set(workflowDefinitionId, { hash, dag });
    return dag;
  }

  /**
   * Get the root stages (no incoming edges) — first to execute.
   */
  async getRootStages(workflowRunId: string, workflowDefinitionId: string): Promise<string[]> {
    const dag = await this.buildDAGForDefinition(workflowDefinitionId);
    return [...dag.rootIds];
  }

  /**
   * Get stages that are ready to execute (all predecessors completed).
   */
  async getReadyStages(workflowRunId: string, workflowDefinitionId: string): Promise<string[]> {
    return withLock(workflowRunId, async () => {
      const dag = await this.buildDAGForDefinition(workflowDefinitionId);
      const stageRuns = await this.stageRunRepo.getByRunId(workflowRunId);

      // Build status map: stageDefinitionId → status
      const statusMap = new Map<string, StageRunStatus>();
      for (const sr of stageRuns) {
        statusMap.set(sr.stageDefinitionId, sr.status);
      }

      const ready: string[] = [];

      for (const [nodeId, node] of dag.nodes) {
        const status = statusMap.get(nodeId);
        // Only consider pending stages
        if (status !== 'pending') continue;

        // Check if all predecessors are in terminal state
        const allPredsComplete = node.dependencyIds.every((predId: string) => {
          const predStatus = statusMap.get(predId);
          return predStatus === 'completed' || predStatus === 'failed' || predStatus === 'skipped';
        });

        if (allPredsComplete) {
          ready.push(nodeId);
        }
      }

      return ready;
    });
  }

  /**
   * Schedule next stages after a stage completes.
   * Returns the stageDefinitionIds that should be enqueued.
   */
  async scheduleNext(
    workflowRunId: string,
    workflowDefinitionId: string,
    _completedStageDefId: string,
  ): Promise<string[]> {
    return this.getReadyStages(workflowRunId, workflowDefinitionId);
  }

  /**
   * Determine whether an edge is "active" given the source predecessor's status.
   *  - on_success    → only when pred completed
   *  - on_failure    → only when pred failed
   *  - on_completion → completed or failed
   *  - always        → any terminal status (incl. skipped/cancelled)
   * Defaults to on_success semantics when edgeType is missing on legacy data.
   */
  private isEdgeActiveForStatus(
    edgeType: string | undefined,
    predStatus: StageRunStatus | undefined,
  ): boolean {
    if (!predStatus) return false;
    const type = edgeType ?? 'on_success';
    if (type === 'always') return true;
    if (type === 'on_completion') return predStatus === 'completed' || predStatus === 'failed';
    if (type === 'on_success') return predStatus === 'completed';
    if (type === 'on_failure') return predStatus === 'failed';
    return false;
  }

  /**
   * Handle stage completion — evaluate edge conditions and determine next stages.
   */
  async onStageCompleted(
    workflowRunId: string,
    workflowDefinitionId: string,
    completedStageDefId: string,
  ): Promise<string[]> {
    return this.routeFromTerminalStage(
      workflowRunId,
      workflowDefinitionId,
      completedStageDefId,
      'completed',
    );
  }

  /**
   * Handle stage failure — evaluate on_failure / on_completion / always edges
   * outgoing from the failed stage. Unlike previous versions which delegated
   * to onStageCompleted, this now correctly filters by edge type so that
   * on_success edges do NOT fire when the stage failed.
   */
  async onStageFailed(
    workflowRunId: string,
    workflowDefinitionId: string,
    failedStageDefId: string,
  ): Promise<string[]> {
    return this.routeFromTerminalStage(
      workflowRunId,
      workflowDefinitionId,
      failedStageDefId,
      'failed',
    );
  }

  /**
   * Shared implementation for onStageCompleted and onStageFailed.
   * Filters outgoing edges by predecessor status so the correct branch fires.
   */
  private async routeFromTerminalStage(
    workflowRunId: string,
    workflowDefinitionId: string,
    sourceStageDefId: string,
    sourceStatus: StageRunStatus,
  ): Promise<string[]> {
    const dag = await this.buildDAGForDefinition(workflowDefinitionId);
    const stageRuns = await this.stageRunRepo.getByRunId(workflowRunId);
    const edges = await this.edgeRepo.getByDefinitionId(workflowDefinitionId);
    const stages = await this.stageDefRepo.getByDefinitionId(workflowDefinitionId);
    const runVariables = await this.getRunVariables(workflowRunId);

    // Build status map; ensure the just-finished stage carries the new status
    // even if the DB write hasn't fully propagated to subsequent reads yet.
    const statusMap = new Map<string, StageRunStatus>();
    for (const sr of stageRuns) {
      statusMap.set(sr.stageDefinitionId, sr.status);
    }
    statusMap.set(sourceStageDefId, sourceStatus);

    // Find outgoing edges from the source stage that are ACTIVE for this status.
    const outEdges = edges.filter(
      (e) =>
        e.fromStageId === sourceStageDefId &&
        this.isEdgeActiveForStatus(e.edgeType, sourceStatus),
    );

    const toSchedule: string[] = [];

    for (const edge of outEdges) {
      const targetStageDefId = edge.toStageId;
      const targetStatus = statusMap.get(targetStageDefId);
      if (targetStatus !== 'pending') continue;

      // Check if ALL predecessors of the target are done
      const targetNode = dag.nodes.get(targetStageDefId);
      if (!targetNode) continue;

      const allPredsReady = targetNode.dependencyIds.every((predId: string) => {
        const st = statusMap.get(predId);
        return st === 'completed' || st === 'failed' || st === 'skipped';
      });
      if (!allPredsReady) continue;

      // Evaluate edge condition
      const targetStageDef = stages.find((s) => s.id === targetStageDefId);
      if (targetStageDef?.condition) {
        const predStatus = statusMap.get(sourceStageDefId) ?? sourceStatus;
        const shouldRun = evaluateCondition(
          targetStageDef.condition,
          { parentStatus: predStatus as StageRunStatus, variables: runVariables },
        );
        if (!shouldRun) continue;
      }

      toSchedule.push(targetStageDefId);
    }

    return toSchedule;
  }

  /**
   * Handle stage skip — route the `always` edges outgoing from a skipped
   * stage. on_success / on_failure / on_completion edges are NOT activated by
   * a skip (their terminal status was never "reached"), but `always` edges
   * must still fire so a fan-in/convergence stage downstream of a skipped
   * branch is not stranded. Previously skipped stages dropped ALL outgoing
   * edges, so an `always` fan-in after a skipped branch never ran.
   */
  async onStageSkipped(
    workflowRunId: string,
    workflowDefinitionId: string,
    skippedStageDefId: string,
  ): Promise<string[]> {
    return this.routeFromTerminalStage(
      workflowRunId,
      workflowDefinitionId,
      skippedStageDefId,
      'skipped',
    );
  }

  /**
   * Compute the terminal status for a run whose DAG is complete.
   *
   * A run is `failed` only when it contains an *unhandled* failure. A failed
   * stage's failure is considered "handled" (recovered) when it has at least
   * one outgoing edge that is active for the `failed` status
   * (on_failure | on_completion | always) whose target reached a non-failed
   * terminal state (`completed`) — or whose target is itself a failed stage
   * that was, transitively, handled. This makes recovery DAGs (the headline
   * use of on_failure / on_completion edges) report `completed` when the
   * recovery branch succeeds, and makes the run status deterministic
   * regardless of which handler (onStageCompleted vs onStageFailed) observes
   * DAG completion first.
   */
  async computeTerminalRunStatus(
    workflowRunId: string,
    workflowDefinitionId: string,
  ): Promise<'completed' | 'failed'> {
    const stageRuns = await this.stageRunRepo.getByRunId(workflowRunId);
    const edges = await this.edgeRepo.getByDefinitionId(workflowDefinitionId);

    const statusMap = new Map<string, StageRunStatus>();
    for (const sr of stageRuns) {
      statusMap.set(sr.stageDefinitionId, sr.status);
    }

    const failedIds = stageRuns
      .filter((sr) => sr.status === 'failed')
      .map((sr) => sr.stageDefinitionId);
    if (failedIds.length === 0) return 'completed';

    // Iterate to a fixpoint so multi-level recovery (A fails → R fails → R2
    // completes) resolves correctly.
    const resolved = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const fid of failedIds) {
        if (resolved.has(fid)) continue;
        const outEdges = edges.filter(
          (e) =>
            e.fromStageId === fid &&
            this.isEdgeActiveForStatus(e.edgeType, 'failed'),
        );
        const handled = outEdges.some((e) => {
          const targetStatus = statusMap.get(e.toStageId);
          return (
            targetStatus === 'completed' ||
            (targetStatus === 'failed' && resolved.has(e.toStageId))
          );
        });
        if (handled) {
          resolved.add(fid);
          changed = true;
        }
      }
    }

    return failedIds.every((fid) => resolved.has(fid)) ? 'completed' : 'failed';
  }

  /**
   * Check if the entire DAG is complete (all stages in terminal state).
   */
  async isDAGComplete(workflowRunId: string, workflowDefinitionId: string): Promise<boolean> {
    const dag = await this.buildDAGForDefinition(workflowDefinitionId);
    const stageRuns = await this.stageRunRepo.getByRunId(workflowRunId);

    const statusMap = new Map<string, StageRunStatus>();
    for (const sr of stageRuns) {
      statusMap.set(sr.stageDefinitionId, sr.status);
    }

    for (const nodeId of dag.nodes.keys()) {
      const status = statusMap.get(nodeId);
      if (!status) return false;
      if (
        status !== 'completed' &&
        status !== 'failed' &&
        status !== 'cancelled' &&
        status !== 'skipped'
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get stages that should be skipped — all predecessors are terminal
   * but the stage's condition is not met by any predecessor.
   */
  async getSkippableStages(
    workflowRunId: string,
    workflowDefinitionId: string,
  ): Promise<string[]> {
    const dag = await this.buildDAGForDefinition(workflowDefinitionId);
    const stageRuns = await this.stageRunRepo.getByRunId(workflowRunId);
    const stages = await this.stageDefRepo.getByDefinitionId(workflowDefinitionId);
    const edges = await this.edgeRepo.getByDefinitionId(workflowDefinitionId);
    const runVariables = await this.getRunVariables(workflowRunId);

    const statusMap = new Map<string, StageRunStatus>();
    for (const sr of stageRuns) {
      statusMap.set(sr.stageDefinitionId, sr.status);
    }

    const toSkip: string[] = [];

    for (const [nodeId, node] of dag.nodes) {
      const status = statusMap.get(nodeId);
      if (status !== 'pending') continue;

      // All predecessors must be in terminal state
      const allPredsDone = node.dependencyIds.every((predId: string) => {
        const predStatus = statusMap.get(predId);
        return predStatus === 'completed' || predStatus === 'failed' || predStatus === 'skipped';
      });
      if (!allPredsDone) continue;

      // Skip when no inbound edge from any predecessor is active for that
      // predecessor's status. `isEdgeActiveForStatus` already encodes the
      // correct semantics per edge type — in particular an `always` edge IS
      // active even when its predecessor was skipped (so the target must run,
      // not be skipped), whereas on_success/on_failure/on_completion edges are
      // never activated by a skipped predecessor. See onStageSkipped, which
      // routes those `always` edges forward.
      const inboundEdges = edges.filter((e) => e.toStageId === nodeId);
      const anyEdgeActive = inboundEdges.some((edge) => {
        const predStatus = statusMap.get(edge.fromStageId);
        return this.isEdgeActiveForStatus(edge.edgeType, predStatus);
      });
      if (inboundEdges.length > 0 && !anyEdgeActive) {
        toSkip.push(nodeId);
        continue;
      }

      // Check if the stage has a condition (legacy behaviour preserved)
      const stageDef = stages.find((s) => s.id === nodeId);
      if (!stageDef?.condition) continue; // No condition = unconditional, should run not skip

      // Check if the condition is met by ANY predecessor
      const anyConditionMet = node.dependencyIds.some((predId: string) => {
        const predStatus = statusMap.get(predId) ?? 'completed';
        const result = evaluateCondition(stageDef.condition!, {
          parentStatus: predStatus as StageRunStatus,
          variables: runVariables,
        });
        return result;
      });

      if (!anyConditionMet) {
        toSkip.push(nodeId);
      }
    }

    return toSkip;
  }

  /**
   * Clear cached DAG for a definition. With hash-based invalidation the
   * cache now self-corrects on the next `buildDAGForDefinition` call, but
   * this remains useful for explicit "I know the DB state changed outside
   * my process" resets.
   */
  clearCache(workflowDefinitionId: string): void {
    this.dagCache.delete(workflowDefinitionId);
  }
}
