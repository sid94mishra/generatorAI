// ────────────────────────────────────────────────────────────────
// DAGScheduler — decides which stages of a run launch, which are skipped,
// and when the run is finished.
//
// WS-D1 / review §5.5 — there is exactly ONE readiness predicate
// (`resolveStageReadiness`) and exactly ONE reconcile (`reconcileDAG`) here.
// The one public entry point, `reconcileRun` — used by the run service's
// reconciler tick, stage completions and crash re-drive — goes through them.
//
// P01 WP-1.7 — the graph is the run's pinned definition version (a v2
// `WorkflowGraph`, read through `RunDefinitionReader`), nodes are keyed by
// stage KEY, and stage guards and edge `when` are Expression v2
// (`@generatorai/workflow-spec`).
// ────────────────────────────────────────────────────────────────

import type { EdgeSpec, EdgeOn } from '@generatorai/workflow-spec';
import { conditionHolds } from '@generatorai/workflow-spec';
import type { ILogger, StageRunStatus, WorkflowRun } from '@generatorai/shared';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import { buildDAG } from '../domain/dag/buildDAG.js';
import type { DAG } from '../domain/dag/types.js';
import type { RunDefinitionReader } from './definitions/RunDefinitionReader.js';
import { runScope, stagesScope, userVariables, type RunScope, type StageScope } from './definitions/runScope.js';

// ── Pure scheduling semantics ──────────────────────────────────────
//
// Everything in this section is a pure function of (DAG, status map,
// expression scope). Keeping it free of repositories is what lets the run
// service, the tests and the scheduler class itself share one definition
// of "ready".

/** What a single pending stage should do right now. */
export type StageReadiness = 'ready' | 'skip' | 'blocked';

/** Terminal status of a run whose every stage is terminal. */
export type TerminalRunStatus = 'completed' | 'failed' | 'cancelled';

/** What guards and edge `when` expressions read. */
export interface SchedulingScope {
  variables: Record<string, unknown>;
  run: RunScope;
  /** Outputs and summaries by stage key; statuses come from the status map. */
  stages: Record<string, StageScope>;
}

/** The full answer for one run after any change. */
export interface RunReconciliation {
  /** Stage keys that are `pending` and may be launched now. */
  toLaunch: string[];
  /**
   * Stage keys that are `pending` and can never run — every predecessor is
   * terminal but no inbound edge is active (or one vetoes, or the stage's
   * guard is false). Already cascaded: a stage whose only path runs through
   * another entry here is included too.
   */
  toSkip: string[];
  /**
   * Set when, once `toSkip` is applied, every stage in the DAG is terminal
   * and nothing is left to launch. Undefined while anything is still
   * pending, queued, running, paused or awaiting input.
   */
  runTerminal?: TerminalRunStatus;
}

const TERMINAL_STAGE_STATUSES: ReadonlySet<StageRunStatus> = new Set<StageRunStatus>([
  'completed',
  'failed',
  'skipped',
  'cancelled',
]);

/**
 * A predecessor stops blocking its successors once it is terminal. This is
 * the ONLY place that set is defined.
 */
export function isTerminalStageStatus(status: StageRunStatus | undefined): boolean {
  return status !== undefined && TERMINAL_STAGE_STATUSES.has(status);
}

/**
 * Whether an edge's `on` lets control flow through, given its source's status.
 *  - success    → only when the predecessor completed
 *  - failure    → only when it failed
 *  - completion → completed or failed
 *  - always     → any terminal status, including skipped and cancelled
 */
export function isEdgeActiveForStatus(on: EdgeOn, predStatus: StageRunStatus | undefined): boolean {
  if (!predStatus) return false;
  if (on === 'always') return isTerminalStageStatus(predStatus);
  if (on === 'completion') return predStatus === 'completed' || predStatus === 'failed';
  if (on === 'success') return predStatus === 'completed';
  if (on === 'failure') return predStatus === 'failed';
  return false;
}

/** The scope an expression sees, with every stage's CURRENT status. */
function exprScope(
  scope: SchedulingScope | undefined,
  statusMap: ReadonlyMap<string, StageRunStatus>,
  parentStatus?: StageRunStatus,
): Record<string, unknown> {
  const stages: Record<string, StageScope> = {};
  for (const [key, status] of statusMap) {
    stages[key] = { output: null, summary: null, ...scope?.stages[key], status };
  }
  return {
    variables: scope?.variables ?? {},
    run: scope?.run ?? { id: '', name: '', codebases: {} },
    stages,
    ...(parentStatus ? { parent: { status: parentStatus } } : {}),
  };
}

/** An edge carries control: its `on` matches the source outcome and its `when` holds. */
function edgeActive(
  edge: EdgeSpec,
  predStatus: StageRunStatus | undefined,
  statusMap: ReadonlyMap<string, StageRunStatus>,
  scope: SchedulingScope | undefined,
): boolean {
  if (!isEdgeActiveForStatus(edge.on, predStatus)) return false;
  return edge.when === undefined || conditionHolds(edge.when, exprScope(scope, statusMap, predStatus));
}

/**
 * THE readiness predicate.
 *
 *  1. Only a `pending` stage can be ready or skipped; anything else is
 *     `blocked` (it is running, or already decided).
 *  2. Every predecessor must be terminal, else `blocked`.
 *  3. Inbound edges are gates. An edge from a predecessor that reached a real
 *     outcome (completed / failed / cancelled) but is NOT active for it (its
 *     `on` does not match, or its `when` is false) vetoes the stage — an
 *     `on: success` edge from a failed branch is exactly "this stage required
 *     that branch to succeed, and it did not". An inactive edge from a
 *     *skipped* predecessor neither vetoes nor activates: that path simply
 *     never happened. At least one inbound edge must be active, otherwise the
 *     stage is unreachable. Both cases → `skip`.
 *  4. The stage's `guard`, if any, must hold (Expression v2: only exactly
 *     `true` holds; a missing path or a type mismatch never does), else `skip`.
 *
 * With A → (B, C) → D on default edges and C failed, step 3 skips D and the
 * run ends `failed` instead of hanging. With A → R on `failure` and A → B on
 * `success`, A failing skips B and runs R — the recovery shape.
 */
export function resolveStageReadiness(
  key: string,
  dag: DAG,
  statusMap: ReadonlyMap<string, StageRunStatus>,
  scope?: SchedulingScope,
): StageReadiness {
  const node = dag.nodes.get(key);
  if (!node) return 'blocked';
  if (statusMap.get(key) !== 'pending') return 'blocked';

  for (const pred of node.dependencyIds) {
    if (!isTerminalStageStatus(statusMap.get(pred))) return 'blocked';
  }

  if (node.incomingEdges.length > 0) {
    let activated = false;
    for (const edge of node.incomingEdges) {
      const predStatus = statusMap.get(edge.from);
      if (edgeActive(edge, predStatus, statusMap, scope)) {
        activated = true;
        continue;
      }
      if (predStatus === 'completed' || predStatus === 'failed' || predStatus === 'cancelled') return 'skip';
    }
    if (!activated) return 'skip';
  }

  const guard = node.stage.guard;
  if (guard !== undefined && !conditionHolds(guard, exprScope(scope, statusMap))) return 'skip';

  return 'ready';
}

/**
 * Terminal status of a run whose stages are all terminal.
 *
 * A failed (or cancelled) stage is "handled" when one of its outgoing edges
 * that is active for that status leads to a stage that completed — or to
 * another failed stage that is itself, transitively, handled. Recovery DAGs
 * therefore report `completed` when the recovery branch succeeds. Any
 * unhandled failure → `failed`; otherwise any unhandled cancellation →
 * `cancelled`; otherwise `completed`.
 */
export function computeTerminalRunStatusFor(
  dag: DAG,
  statusMap: ReadonlyMap<string, StageRunStatus>,
): TerminalRunStatus {
  const unresolved = new Map<string, StageRunStatus>();
  for (const key of dag.nodes.keys()) {
    const status = statusMap.get(key);
    if (status === 'failed' || status === 'cancelled') unresolved.set(key, status);
  }
  if (unresolved.size === 0) return 'completed';

  const resolved = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, status] of unresolved) {
      if (resolved.has(key)) continue;
      const node = dag.nodes.get(key);
      const handled = (node?.outgoingEdges ?? []).some((edge) => {
        if (!isEdgeActiveForStatus(edge.on, status)) return false;
        const targetStatus = statusMap.get(edge.to);
        return targetStatus === 'completed' || (unresolved.has(edge.to) && resolved.has(edge.to));
      });
      if (handled) {
        resolved.add(key);
        changed = true;
      }
    }
  }

  let sawCancelled = false;
  for (const [key, status] of unresolved) {
    if (resolved.has(key)) continue;
    if (status === 'failed') return 'failed';
    sawCancelled = true;
  }
  return sawCancelled ? 'cancelled' : 'completed';
}

/**
 * THE reconcile. Re-evaluates every pending stage against the current
 * statuses, cascading skips in memory until nothing changes, and reports
 * what to launch, what to skip and whether the run is now finished.
 *
 * Pure: callers persist `toSkip`, launch `toLaunch` (the DUR-06 atomic
 * `pending → queued` claim makes a duplicate launch a no-op, so two
 * concurrent reconciles are safe) and finalize on `runTerminal`.
 */
export function reconcileDAG(
  dag: DAG,
  statusMap: ReadonlyMap<string, StageRunStatus>,
  scope?: SchedulingScope,
): RunReconciliation {
  const working = new Map(statusMap);
  const toLaunch: string[] = [];
  const toSkip: string[] = [];

  let changed = true;
  while (changed) {
    changed = false;
    for (const key of dag.nodes.keys()) {
      if (working.get(key) !== 'pending') continue;
      const readiness = resolveStageReadiness(key, dag, working, scope);
      if (readiness === 'skip') {
        working.set(key, 'skipped');
        toSkip.push(key);
        changed = true;
      } else if (readiness === 'ready') {
        toLaunch.push(key);
        // Mark it so this pass does not report it twice; `queued` is
        // non-terminal, so successors stay blocked as they should.
        working.set(key, 'queued');
      }
    }
  }

  let runTerminal: TerminalRunStatus | undefined;
  if (toLaunch.length === 0) {
    let allTerminal = true;
    for (const key of dag.nodes.keys()) {
      if (!isTerminalStageStatus(working.get(key))) {
        allTerminal = false;
        break;
      }
    }
    if (allTerminal) runTerminal = computeTerminalRunStatusFor(dag, working);
  }

  return runTerminal ? { toLaunch, toSkip, runTerminal } : { toLaunch, toSkip };
}

/**
 * Per-run FIFO queue entry. W33/P1-19 — defined here (not as a module global)
 * so two DAGScheduler instances each get their own isolated queue state.
 */
interface QueuedOp<T> {
  fn: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (err: Error) => void;
}

export class DAGScheduler {
  /**
   * DAG per definition version. A version never changes, so an entry is
   * valid forever; the map is capped so a long-lived scheduler does not grow
   * by one entry per version it has ever seen.
   */
  private dagCache = new Map<string, DAG>();
  private static readonly MAX_CACHED_DAGS = 512;

  // W33 / P1-19 — per-run FIFO lock queues as INSTANCE state.
  private runQueues = new Map<string, Array<QueuedOp<unknown>>>();
  private runQueueActive = new Set<string>();

  /** Diagnostics counters; nothing in production reads them. */
  readonly stats = {
    /** DAGs built from scratch (cache misses). */
    dagBuilds: 0,
    /** Reconciles performed. */
    reconciles: 0,
  };

  constructor(
    private readonly definitions: RunDefinitionReader,
    private readonly stageRunRepo: IStageRunRepository,
    private readonly runRepo: IWorkflowRunRepository,
    /** Optional logger — a run that cannot be read is reported, not swallowed. */
    private readonly logger?: ILogger,
  ) {}

  // ── Per-run FIFO lock ──

  private async processQueue(runId: string): Promise<void> {
    if (this.runQueueActive.has(runId)) return;
    this.runQueueActive.add(runId);
    try {
      for (;;) {
        const queue = this.runQueues.get(runId);
        if (!queue || queue.length === 0) break;
        const op = queue.shift()!;
        try {
          const result = await op.fn();
          op.resolve(result);
        } catch (err) {
          op.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
      this.runQueues.delete(runId);
    } finally {
      this.runQueueActive.delete(runId);
    }
  }

  private withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queue = this.runQueues.get(runId) ?? [];
      queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.runQueues.set(runId, queue);
      void this.processQueue(runId);
    });
  }

  // ── DAG construction ──

  /** The DAG of the run's pinned definition version. */
  async buildDAGForRun(run: Pick<WorkflowRun, 'definitionVersionId'>): Promise<DAG> {
    const cached = this.dagCache.get(run.definitionVersionId);
    if (cached) return cached;
    const dag = buildDAG(await this.definitions.get(run.definitionVersionId));
    this.stats.dagBuilds++;
    if (this.dagCache.size >= DAGScheduler.MAX_CACHED_DAGS) {
      const oldest = this.dagCache.keys().next();
      if (!oldest.done) this.dagCache.delete(oldest.value);
    }
    this.dagCache.set(run.definitionVersionId, dag);
    return dag;
  }

  // ── The one reconcile ──

  /**
   * Re-evaluate every pending stage of a run. Serialized per run so two
   * callers (an event and the poll backstop) never interleave their reads.
   * See {@link reconcileDAG} for the semantics.
   */
  async reconcileRun(workflowRunId: string): Promise<RunReconciliation> {
    return this.withLock(workflowRunId, async () => {
      let run: WorkflowRun;
      try {
        run = await this.runRepo.getById(workflowRunId);
      } catch (err) {
        this.logger?.warn(
          `[DAGScheduler] Could not read run ${workflowRunId} for scheduling: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
      const dag = await this.buildDAGForRun(run);
      const stageRuns = await this.stageRunRepo.getByRunId(workflowRunId);
      const statusMap = new Map<string, StageRunStatus>(stageRuns.map((sr) => [sr.stageKey, sr.status]));
      this.stats.reconciles++;
      return reconcileDAG(dag, statusMap, {
        variables: userVariables(run.variables),
        run: runScope(run),
        stages: stagesScope(stageRuns),
      });
    });
  }
}
