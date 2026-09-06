// ────────────────────────────────────────────────────────────────
// DAGScheduler — decides which stages of a run launch, which are skipped,
// and when the run is finished.
//
// WS-D1 / review §5.5 — there is exactly ONE readiness predicate
// (`resolveStageReadiness`) and exactly ONE reconcile (`reconcileDAG`) here.
// Every public entry point — `getReadyStages`, `getSkippableStages`,
// `onStageCompleted/Failed/Skipped`, `scheduleNext`, the run service's
// reconciler tick and crash re-drive — goes through them. The previous
// version had four answers to "is this stage ready?" (a router that looked
// only at the just-finished predecessor, a skipper that asked whether ANY
// inbound edge was active, an edge-blind restart path, and a terminal-status
// computation that ignored `cancelled`), and the most common branching shape
// — a diamond with one failed branch — hung forever in the gap between them.
// ────────────────────────────────────────────────────────────────

import type {
  ILogger,
  StageDefinition,
  StageEdge,
  StageRunStatus,
  WorkflowDefinitionSnapshot,
  WorkflowRun,
} from '@generatorai/shared';
import type { IStageDefinitionRepository } from '../domain/ports/IStageDefinitionRepository.js';
import type { IStageEdgeRepository } from '../domain/ports/IStageEdgeRepository.js';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import type { IDAGScheduler } from '../domain/ports/IServiceInterfaces.js';
import { buildDAG } from '../domain/dag/DAGValidator.js';
import { evaluateCondition } from '../domain/dag/ConditionEvaluator.js';
import type { DAG } from '../domain/dag/types.js';
import { createHash } from 'node:crypto';

// ── Pure scheduling semantics ──────────────────────────────────────
//
// Everything in this section is a pure function of (DAG, status map,
// variables). Keeping it free of repositories is what lets the run service,
// the tests and the scheduler class itself share one definition of "ready".

/** What a single pending stage should do right now. */
export type StageReadiness = 'ready' | 'skip' | 'blocked';

/** Terminal status of a run whose every stage is terminal. */
export type TerminalRunStatus = 'completed' | 'failed' | 'cancelled';

/** The full answer for one run after any change. */
export interface RunReconciliation {
  /** Stage definition ids that are `pending` and may be launched now. */
  toLaunch: string[];
  /**
   * Stage definition ids that are `pending` and can never run — every
   * predecessor is terminal but no inbound edge is active (or one vetoes,
   * or the stage's own condition is false). Already cascaded: a stage whose
   * only path runs through another entry here is included too.
   */
  toSkip: string[];
  /**
   * Set when, once `toSkip` is applied, every stage in the DAG is terminal
   * and nothing is left to launch. Undefined while anything is still
   * pending, queued, running, paused, sleeping or awaiting input.
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
 * the ONLY place that set is defined — `cancelled` used to be missing from
 * the readiness copy while present in the completion copy, which is the
 * second hang mode §5.5 describes.
 */
export function isTerminalStageStatus(status: StageRunStatus | undefined): boolean {
  return status !== undefined && TERMINAL_STAGE_STATUSES.has(status);
}

/**
 * Whether an edge lets control flow through, given its source's status.
 *  - on_success    → only when the predecessor completed
 *  - on_failure    → only when it failed
 *  - on_completion → completed or failed
 *  - always        → any terminal status, including skipped and cancelled
 * Missing `edgeType` on legacy rows means on_success.
 */
export function isEdgeActiveForStatus(
  edgeType: string | undefined,
  predStatus: StageRunStatus | undefined,
): boolean {
  if (!predStatus) return false;
  const type = edgeType ?? 'on_success';
  if (type === 'always') return isTerminalStageStatus(predStatus);
  if (type === 'on_completion') return predStatus === 'completed' || predStatus === 'failed';
  if (type === 'on_success') return predStatus === 'completed';
  if (type === 'on_failure') return predStatus === 'failed';
  return false;
}

/**
 * THE readiness predicate.
 *
 *  1. Only a `pending` stage can be ready or skipped; anything else is
 *     `blocked` (it is running, or already decided).
 *  2. Every predecessor must be terminal, else `blocked`.
 *  3. Inbound edges are gates. An edge from a predecessor that reached a real
 *     outcome (completed / failed / cancelled) but is NOT active for that
 *     outcome vetoes the stage — an `on_success` edge from a failed branch is
 *     exactly "this stage required that branch to succeed, and it did not".
 *     An inactive edge from a *skipped* predecessor neither vetoes nor
 *     activates: that path simply never happened. At least one inbound edge
 *     must be active, otherwise the stage is unreachable. Both cases → `skip`.
 *  4. The stage's own `condition`, if any, is evaluated against the status of
 *     each activating predecessor (a root uses `completed`); false → `skip`.
 *
 * With A → (B, C) → D on default edges and C failed, step 3 skips D and the
 * run ends `failed` instead of hanging. With A → R on `on_failure` and A → B
 * on `on_success`, A failing skips B and runs R — the recovery shape.
 */
export function resolveStageReadiness(
  nodeId: string,
  dag: DAG,
  statusMap: ReadonlyMap<string, StageRunStatus>,
  variables?: Record<string, unknown>,
): StageReadiness {
  const node = dag.nodes.get(nodeId);
  if (!node) return 'blocked';
  if (statusMap.get(nodeId) !== 'pending') return 'blocked';

  for (const predId of node.dependencyIds) {
    if (!isTerminalStageStatus(statusMap.get(predId))) return 'blocked';
  }

  const activatingParents: StageRunStatus[] = [];
  if (node.incomingEdges.length > 0) {
    for (const edge of node.incomingEdges) {
      const predStatus = statusMap.get(edge.fromStageId);
      if (isEdgeActiveForStatus(edge.edgeType, predStatus)) {
        activatingParents.push(predStatus!);
        continue;
      }
      if (predStatus === 'completed' || predStatus === 'failed' || predStatus === 'cancelled') {
        return 'skip';
      }
    }
    if (activatingParents.length === 0) return 'skip';
  }

  const condition = node.stage.condition;
  if (condition) {
    const parents: StageRunStatus[] =
      activatingParents.length > 0 ? activatingParents : ['completed'];
    const met = parents.some((parentStatus) =>
      evaluateCondition(condition, { parentStatus, variables }),
    );
    if (!met) return 'skip';
  }

  return 'ready';
}

/**
 * Terminal status of a run whose stages are all terminal.
 *
 * A failed (or cancelled) stage is "handled" when one of its outgoing edges
 * that is active for that status leads to a stage that completed — or to
 * another failed stage that is itself, transitively, handled. Recovery DAGs
 * (the headline use of `on_failure`) therefore report `completed` when the
 * recovery branch succeeds. Any unhandled failure → `failed`; otherwise any
 * unhandled cancellation → `cancelled` (previously a cancelled leaf reported
 * `completed`); otherwise `completed`.
 */
export function computeTerminalRunStatusFor(
  dag: DAG,
  statusMap: ReadonlyMap<string, StageRunStatus>,
): TerminalRunStatus {
  const unresolved = new Map<string, StageRunStatus>();
  for (const nodeId of dag.nodes.keys()) {
    const status = statusMap.get(nodeId);
    if (status === 'failed' || status === 'cancelled') unresolved.set(nodeId, status);
  }
  if (unresolved.size === 0) return 'completed';

  const resolved = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [nodeId, status] of unresolved) {
      if (resolved.has(nodeId)) continue;
      const node = dag.nodes.get(nodeId);
      const handled = (node?.outgoingEdges ?? []).some((edge) => {
        if (!isEdgeActiveForStatus(edge.edgeType, status)) return false;
        const targetStatus = statusMap.get(edge.toStageId);
        return (
          targetStatus === 'completed' ||
          (unresolved.has(edge.toStageId) && resolved.has(edge.toStageId))
        );
      });
      if (handled) {
        resolved.add(nodeId);
        changed = true;
      }
    }
  }

  let sawCancelled = false;
  for (const [nodeId, status] of unresolved) {
    if (resolved.has(nodeId)) continue;
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
  variables?: Record<string, unknown>,
): RunReconciliation {
  const working = new Map(statusMap);
  const toLaunch: string[] = [];
  const toSkip: string[] = [];

  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of dag.nodes.keys()) {
      if (working.get(nodeId) !== 'pending') continue;
      const readiness = resolveStageReadiness(nodeId, dag, working, variables);
      if (readiness === 'skip') {
        working.set(nodeId, 'skipped');
        toSkip.push(nodeId);
        changed = true;
      } else if (readiness === 'ready') {
        toLaunch.push(nodeId);
        // Mark it so this pass does not report it twice; `queued` is
        // non-terminal, so successors stay blocked as they should.
        working.set(nodeId, 'queued');
      }
    }
  }

  let runTerminal: TerminalRunStatus | undefined;
  if (toLaunch.length === 0) {
    let allTerminal = true;
    for (const nodeId of dag.nodes.keys()) {
      if (!isTerminalStageStatus(working.get(nodeId))) {
        allTerminal = false;
        break;
      }
    }
    if (allTerminal) runTerminal = computeTerminalRunStatusFor(dag, working);
  }

  return runTerminal ? { toLaunch, toSkip, runTerminal } : { toLaunch, toSkip };
}

// ── Definition cache validation (P1-19) ──
//
// △ The cache used to be validated by SHA-1'ing EVERY stage and EVERY edge on
// every call. Validation is two-tier: tier 1 (`structuralSignature`) is an
// integer fold — no allocation, no sort, no crypto — that catches everything
// except an edit to the *body* of a stage condition; tier 2
// (`conditionSignature`) digests only the stages that carry a condition and
// is reached only when tier 1 already matched.

const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

/** Fold a string into a 32-bit FNV-1a accumulator without allocating. */
function foldString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), FNV_PRIME);
  }
  return h;
}

// Scratch view used to fold a number by its exact IEEE-754 bits. Only ever
// written and read back within one synchronous statement.
const numberScratch = new Float64Array(1);
const numberBits = new Uint32Array(numberScratch.buffer);

/** Fold a number into a 32-bit FNV-1a accumulator without allocating. */
function foldNumber(h: number, n: number): number {
  numberScratch[0] = n;
  h = Math.imul(h ^ numberBits[0]!, FNV_PRIME);
  return Math.imul(h ^ numberBits[1]!, FNV_PRIME);
}

/**
 * Tier 1: cheap, order-independent signature of (stage ids + order +
 * condition presence) and (edge tuples). Counts are included so duplicate
 * rows, which xor cancels in pairs, still shift the signature.
 */
function structuralSignature(
  stages: Array<{ id: string; order: number; condition?: unknown }>,
  edges: Array<{ fromStageId: string; toStageId: string; edgeType?: string }>,
): string {
  let stageSum = 0;
  let stageXor = 0;
  for (const s of stages) {
    let h = foldString(FNV_OFFSET, s.id);
    h = foldNumber(h, s.order);
    h = Math.imul(h ^ (s.condition != null ? 1 : 0), FNV_PRIME);
    stageSum = (stageSum + h) | 0;
    stageXor ^= h;
  }

  let edgeSum = 0;
  let edgeXor = 0;
  for (const e of edges) {
    let h = foldString(FNV_OFFSET, e.fromStageId);
    h = foldString(Math.imul(h ^ 0x3e, FNV_PRIME), e.toStageId);
    h = foldString(Math.imul(h ^ 0x3a, FNV_PRIME), e.edgeType ?? '');
    edgeSum = (edgeSum + h) | 0;
    edgeXor ^= h;
  }

  return `${stages.length}:${stageSum}:${stageXor}|${edges.length}:${edgeSum}:${edgeXor}`;
}

/** Tier 2: digest of the condition bodies only. */
function conditionSignature(stages: Array<{ id: string; condition?: unknown }>): string {
  const conditional = stages.filter((s) => s.condition != null);
  if (conditional.length === 0) return '';
  conditional.sort((a, b) => a.id.localeCompare(b.id));
  const h = createHash('sha1');
  for (const s of conditional) {
    h.update(`${s.id}|${JSON.stringify(s.condition)}\n`);
  }
  return h.digest('hex');
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

export class DAGScheduler implements IDAGScheduler {
  /**
   * Cached DAG per workflow definition (keyed by definitionId), validated by
   * the two signatures on every build so a mid-run edit of a definition is
   * never served stale. Used for runs that have no snapshot (created before
   * the column landed) and for definition-level questions.
   */
  private dagCache = new Map<string, { signature: string; conditions: string; dag: DAG }>();

  /**
   * WS-D1 — DAG per in-flight run, built from the run's frozen
   * `definitionSnapshot`. The snapshot never changes once written, so the
   * entry is valid for the life of the run; `forgetRun` drops it when the
   * run is finished and the map is capped so a long-lived scheduler does not
   * grow by one entry per run it has ever seen.
   */
  private runDagCache = new Map<string, { capturedAt: string; dag: DAG }>();
  private static readonly MAX_TRACKED_RUNS = 512;

  // W33 / P1-19 — per-run FIFO lock queues as INSTANCE state.
  private runQueues = new Map<string, Array<QueuedOp<unknown>>>();
  private runQueueActive = new Set<string>();

  /**
   * △ Diagnostics counters. Not part of `IDAGScheduler`; nothing in
   * production reads them. They let a test see whether the cache and the
   * crypto digest were touched.
   */
  readonly stats = {
    /** DAGs built from scratch, i.e. cache misses (definition or snapshot). */
    dagBuilds: 0,
    /** Tier-2 digests actually computed with crypto. */
    conditionDigests: 0,
    /** Reconciles performed. */
    reconciles: 0,
  };

  constructor(
    private stageDefRepo: IStageDefinitionRepository,
    private edgeRepo: IStageEdgeRepository,
    private stageRunRepo: IStageRunRepository,
    /**
     * Optional run repository. When provided, the run's `variables` are passed
     * into condition evaluation so `variables.*` expressions resolve to real
     * values (SCHEMA-3), and the run's `definitionSnapshot` is used to build
     * its DAG (WS-D1). Without it, `variables.*` resolve to undefined and the
     * live definition is used.
     */
    private runRepo?: IWorkflowRunRepository,
    /** Optional logger — a run that cannot be read is reported, not swallowed. */
    private logger?: ILogger,
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

  // ── Run access ──

  /**
   * Read the run for its variables and snapshot. Returns undefined when no
   * run repo is wired or the run cannot be read — and in the latter case
   * SAYS SO. This used to be a bare `catch { return undefined }`, so a
   * transient DB error silently evaluated every `variables.*` condition as
   * false and took the wrong branch with no trace anywhere.
   */
  private async loadRun(workflowRunId: string): Promise<WorkflowRun | undefined> {
    if (!this.runRepo) return undefined;
    try {
      return await this.runRepo.getById(workflowRunId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn(
        `[DAGScheduler] Could not read run ${workflowRunId} for scheduling; ` +
          `variables.* conditions evaluate as undefined and the live definition is used: ${message}`,
      );
      return undefined;
    }
  }

  /** Tier-2 signature, counted so a test can see whether crypto ran. */
  private conditionSignatureOf(stages: Array<{ id: string; condition?: unknown }>): string {
    const signature = conditionSignature(stages);
    if (signature !== '') this.stats.conditionDigests++;
    return signature;
  }

  // ── DAG construction ──

  /**
   * Build the DAG for a workflow definition from its LIVE stages and edges,
   * reusing the cached value only when both signatures match.
   */
  async buildDAGForDefinition(workflowDefinitionId: string): Promise<DAG> {
    const stages = await this.stageDefRepo.getByDefinitionId(workflowDefinitionId);
    const edges = await this.edgeRepo.getByDefinitionId(workflowDefinitionId);
    const signature = structuralSignature(stages, edges);

    const cached = this.dagCache.get(workflowDefinitionId);
    if (
      cached &&
      cached.signature === signature &&
      cached.conditions === this.conditionSignatureOf(stages)
    ) {
      return cached.dag;
    }

    const dag = buildDAG(stages, edges);
    this.stats.dagBuilds++;
    this.dagCache.set(workflowDefinitionId, {
      signature,
      conditions: this.conditionSignatureOf(stages),
      dag,
    });
    return dag;
  }

  /**
   * WS-D1 — the topology a run executes against. A run carrying a
   * `definitionSnapshot` gets a DAG built from that snapshot, so editing the
   * definition while the run is in flight changes nothing about it. Runs
   * without a snapshot fall back to the live definition.
   */
  async buildDAGForRun(run: WorkflowRun): Promise<DAG> {
    const snapshot = run.definitionSnapshot;
    if (!snapshot) return this.buildDAGForDefinition(run.workflowDefinitionId);

    const cached = this.runDagCache.get(run.id);
    if (cached && cached.capturedAt === snapshot.capturedAt) return cached.dag;

    const dag = buildDAG(snapshot.stages, snapshot.edges);
    this.stats.dagBuilds++;
    if (!this.runDagCache.has(run.id) && this.runDagCache.size >= DAGScheduler.MAX_TRACKED_RUNS) {
      const oldest = this.runDagCache.keys().next();
      if (!oldest.done) this.runDagCache.delete(oldest.value);
    }
    this.runDagCache.set(run.id, { capturedAt: snapshot.capturedAt, dag });
    return dag;
  }

  /**
   * WS-D1 — read the definition's current stages + edges as a snapshot to
   * freeze onto a run at creation.
   */
  async captureDefinitionSnapshot(workflowDefinitionId: string): Promise<WorkflowDefinitionSnapshot> {
    const [stages, edges]: [StageDefinition[], StageEdge[]] = await Promise.all([
      this.stageDefRepo.getByDefinitionId(workflowDefinitionId),
      this.edgeRepo.getByDefinitionId(workflowDefinitionId),
    ]);
    return { stages, edges, capturedAt: new Date().toISOString() };
  }

  /** DAG for a run id: snapshot when the run has one, live definition otherwise. */
  private async dagForRun(
    workflowRunId: string,
    workflowDefinitionId: string,
    run?: WorkflowRun,
  ): Promise<DAG> {
    if (run) return this.buildDAGForRun(run);
    return this.buildDAGForDefinition(workflowDefinitionId);
  }

  /** Build status map: stageDefinitionId → status. */
  private async loadStatusMap(workflowRunId: string): Promise<Map<string, StageRunStatus>> {
    const stageRuns = await this.stageRunRepo.getByRunId(workflowRunId);
    const statusMap = new Map<string, StageRunStatus>();
    for (const sr of stageRuns) {
      statusMap.set(sr.stageDefinitionId, sr.status);
    }
    return statusMap;
  }

  // ── The one reconcile ──

  /**
   * Re-evaluate every pending stage of a run. Serialized per run so two
   * callers (an event and the poll backstop) never interleave their reads.
   * See {@link reconcileDAG} for the semantics.
   */
  async reconcileRun(workflowRunId: string, workflowDefinitionId: string): Promise<RunReconciliation> {
    return this.withLock(workflowRunId, async () => {
      const run = await this.loadRun(workflowRunId);
      const dag = await this.dagForRun(workflowRunId, workflowDefinitionId, run);
      const statusMap = await this.loadStatusMap(workflowRunId);
      this.stats.reconciles++;
      return reconcileDAG(dag, statusMap, run?.variables ?? undefined);
    });
  }

  // ── IDAGScheduler surface — every method below is a view of reconcileRun ──

  /** Root stages (no incoming edges) — first to execute. */
  async getRootStages(workflowRunId: string, workflowDefinitionId: string): Promise<string[]> {
    const run = await this.loadRun(workflowRunId);
    const dag = await this.dagForRun(workflowRunId, workflowDefinitionId, run);
    return [...dag.rootIds];
  }

  /** Stages that may be launched now. */
  async getReadyStages(workflowRunId: string, workflowDefinitionId: string): Promise<string[]> {
    return (await this.reconcileRun(workflowRunId, workflowDefinitionId)).toLaunch;
  }

  /**
   * Stages that may be launched after a stage finished. The finished stage's
   * id is accepted for interface compatibility; the answer is the whole-run
   * reconcile, which is what a completion must trigger anyway (a fan-in's
   * readiness depends on every predecessor, not the one that just moved).
   */
  async scheduleNext(
    workflowRunId: string,
    workflowDefinitionId: string,
    _completedStageDefId: string,
  ): Promise<string[]> {
    return this.getReadyStages(workflowRunId, workflowDefinitionId);
  }

  /** Alias of {@link getReadyStages} kept for the `IDAGScheduler` contract. */
  async onStageCompleted(
    workflowRunId: string,
    workflowDefinitionId: string,
    _completedStageDefId: string,
  ): Promise<string[]> {
    return this.getReadyStages(workflowRunId, workflowDefinitionId);
  }

  /** Alias of {@link getReadyStages} kept for the `IDAGScheduler` contract. */
  async onStageFailed(
    workflowRunId: string,
    workflowDefinitionId: string,
    _failedStageDefId: string,
  ): Promise<string[]> {
    return this.getReadyStages(workflowRunId, workflowDefinitionId);
  }

  /** Alias of {@link getReadyStages}: `always` edges out of a skipped stage are part of the reconcile. */
  async onStageSkipped(
    workflowRunId: string,
    workflowDefinitionId: string,
    _skippedStageDefId: string,
  ): Promise<string[]> {
    return this.getReadyStages(workflowRunId, workflowDefinitionId);
  }

  /** Stages that can never run (cascaded). */
  async getSkippableStages(workflowRunId: string, workflowDefinitionId: string): Promise<string[]> {
    return (await this.reconcileRun(workflowRunId, workflowDefinitionId)).toSkip;
  }

  /** Terminal status for a run whose DAG is complete. */
  async computeTerminalRunStatus(
    workflowRunId: string,
    workflowDefinitionId: string,
  ): Promise<TerminalRunStatus> {
    const run = await this.loadRun(workflowRunId);
    const dag = await this.dagForRun(workflowRunId, workflowDefinitionId, run);
    const statusMap = await this.loadStatusMap(workflowRunId);
    return computeTerminalRunStatusFor(dag, statusMap);
  }

  /** True when every stage of the DAG has a terminal status. */
  async isDAGComplete(workflowRunId: string, workflowDefinitionId: string): Promise<boolean> {
    const run = await this.loadRun(workflowRunId);
    const dag = await this.dagForRun(workflowRunId, workflowDefinitionId, run);
    const statusMap = await this.loadStatusMap(workflowRunId);
    for (const nodeId of dag.nodes.keys()) {
      if (!isTerminalStageStatus(statusMap.get(nodeId))) return false;
    }
    return true;
  }

  // ── Cache management ──

  /**
   * Clear the cached live DAG for a definition. With signature-based
   * validation the cache self-corrects on the next build; this remains useful
   * for an explicit "the DB changed outside my process" reset. Run snapshots
   * are unaffected — they are frozen by design.
   */
  clearCache(workflowDefinitionId: string): void {
    this.dagCache.delete(workflowDefinitionId);
  }

  /** Drop the per-run DAG once the run is terminal. */
  forgetRun(workflowRunId: string): void {
    this.runDagCache.delete(workflowRunId);
  }
}
