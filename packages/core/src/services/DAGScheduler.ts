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
 * Per-run FIFO queue entry. W33/P1-19 — defined here (not as a module global)
 * so two DAGScheduler instances each get their own isolated queue state.
 */
interface QueuedOp<T> {
  fn: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (err: Error) => void;
}

// ── Definition cache validation (P1-19) ──
//
// △ The cache used to be validated by SHA-1'ing EVERY stage and EVERY edge on
// every call — i.e. on every stage completion, since every scheduler entry
// point funnels through `buildDAGForDefinition`. That is two array copies, two
// O(n log n) `localeCompare` sorts, a `JSON.stringify` per stage and a crypto
// digest over the whole definition, just to answer "did anything change?".
//
// Validation is now two-tier. Tier 1 (`structuralSignature`) is an integer
// fold — no allocation, no sort, no crypto — that catches everything except an
// edit to the *body* of a stage condition. Tier 2 (`conditionSignature`) is
// the old digest, but restricted to the stages that actually carry a condition
// and reached only when tier 1 already matched, so the invalidation guarantee
// is unchanged while the common case (no conditions, nothing edited) touches
// crypto zero times.

const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

/** Fold a string into a 32-bit FNV-1a accumulator without allocating. */
function foldString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), FNV_PRIME);
  }
  return h;
}

// Scratch view used to fold a number by its exact IEEE-754 bits, so two
// distinct `order` values can never collide the way a truncating bit-shift
// would. Module-scoped and reused rather than allocated per row; it is only
// ever written and read back within one synchronous statement, so the
// single-threaded event loop cannot interleave another folder into it.
const numberScratch = new Float64Array(1);
const numberBits = new Uint32Array(numberScratch.buffer);

/** Fold a number into a 32-bit FNV-1a accumulator without allocating. */
function foldNumber(h: number, n: number): number {
  numberScratch[0] = n;
  h = Math.imul(h ^ numberBits[0]!, FNV_PRIME);
  return Math.imul(h ^ numberBits[1]!, FNV_PRIME);
}

/**
 * Tier 1: cheap signature of (stage ids + order + condition presence) and
 * (edge tuples). Per-row hashes are combined with sum AND xor, which is
 * order-independent — that is deliberate: the repositories make no ordering
 * promise, and combining this way removes the need to sort (the old digest
 * sorted purely to be stable against row order). Counts are included so that
 * duplicate rows, which xor cancels in pairs, still shift the signature.
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

/**
 * Tier 2: digest of the condition bodies only. A condition is an arbitrary
 * object, so nothing cheaper than serialising it can prove it is unchanged —
 * but only conditional stages need paying for, and a definition with no
 * conditions never reaches `createHash` at all.
 */
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
 * Snapshot of one run's scheduling frontier. P1-19 — instance state, keyed by
 * runId, so `scheduleNext` can answer from the successors of the stage that
 * just finished instead of re-scanning every node of the DAG.
 *
 * `statuses` is what the last full scan saw. The next call compares it against
 * freshly-read statuses: if nothing but the completed stage moved, the only
 * stages that can have become newly ready are that stage's successors — every
 * other ready stage must already be in `ready`. Anything else (a concurrent
 * status change, a rebuilt DAG, a different definition) falls back to the full
 * scan, because a stranded stage hangs the run.
 */
interface RunFrontier {
  workflowDefinitionId: string;
  /** Identity of the DAG the snapshot was taken against — a mid-run edit
   *  replaces the cached DAG object, which invalidates the snapshot. */
  dag: DAG;
  statuses: Map<string, StageRunStatus>;
  /** Exactly what the last scan returned, in `dag.nodes` order. */
  ready: string[];
}

export class DAGScheduler implements IDAGScheduler {
  /**
   * Cached DAG per workflow definition (keyed by definitionId). The stored
   * signatures of (stages, edges) are compared on every build; a mismatch —
   * e.g. the definition was edited mid-run — rebuilds and replaces the entry,
   * so a stale topology is never reused (resolves the old DAG-01 stale-cache
   * risk). See the two-tier note above `structuralSignature`.
   */
  private dagCache = new Map<string, { signature: string; conditions: string; dag: DAG }>();

  /**
   * Position of each node in `dag.nodes` iteration order, filled lazily and
   * keyed by the DAG object so a rebuilt DAG drops its entry automatically.
   * The incremental frontier visits nodes out of order and has to re-sort its
   * result into the order a full scan would have produced.
   */
  private dagNodeOrder = new WeakMap<DAG, Map<string, number>>();

  // W33 / P1-19 — per-run FIFO lock queues as INSTANCE state.
  // Module-level globals caused all DAGScheduler instances to share one lock
  // table, making two schedulers in the same process contend on the same runId
  // keys. Instance fields give each scheduler its own isolated queue state.
  private runQueues = new Map<string, Array<QueuedOp<unknown>>>();
  private runQueueActive = new Set<string>();

  /** P1-19 — per-run frontier snapshots (see {@link RunFrontier}). */
  private runFrontiers = new Map<string, RunFrontier>();

  /**
   * Frontier state is a pure cache — dropping an entry only costs one full
   * scan — so a long-lived scheduler evicts the oldest entries rather than
   * growing a map keyed by every run it has ever seen.
   */
  private static readonly MAX_TRACKED_FRONTIERS = 512;

  /**
   * △ Diagnostics counters for the P1-19 work-avoidance paths. Not part of
   * `IDAGScheduler`; nothing in production reads them. They exist because the
   * cost this optimisation removes (nodes walked, digests computed) is
   * otherwise invisible from the outside, so a regression test could not tell
   * an incremental scan from a full one.
   */
  readonly stats = {
    /** DAGs built from scratch, i.e. cache misses. */
    dagBuilds: 0,
    /** Tier-2 digests actually computed with crypto. */
    conditionDigests: 0,
    /** Readiness computations that walked every node. */
    fullScans: 0,
    /** `scheduleNext` calls answered from the frontier. */
    incrementalScans: 0,
    /** Nodes whose readiness predicate was evaluated, across both paths. */
    nodesExamined: 0,
  };

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

  // ── Per-run FIFO lock (W33/P1-19 — instance state, not module globals) ──

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
      // Kick off processing asynchronously so the caller's try/await path
      // completes before we start draining the queue.
      void this.processQueue(runId);
    });
  }

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

  /** Tier-2 signature, counted so a test can see whether crypto ran. */
  private conditionSignatureOf(stages: Array<{ id: string; condition?: unknown }>): string {
    const signature = conditionSignature(stages);
    if (signature !== '') this.stats.conditionDigests++;
    return signature;
  }

  /**
   * Build the DAG for a workflow definition, reusing the cached value only
   * when both signatures match. This replaces the old
   * "cache-forever-until-explicit-clearCache" behaviour that left runs
   * using a stale topology when the definition was edited mid-run.
   */
  async buildDAGForDefinition(workflowDefinitionId: string): Promise<DAG> {
    const stages = await this.stageDefRepo.getByDefinitionId(workflowDefinitionId);
    const edges = await this.edgeRepo.getByDefinitionId(workflowDefinitionId);
    const signature = structuralSignature(stages, edges);

    const cached = this.dagCache.get(workflowDefinitionId);
    // Tier 2 is evaluated only once tier 1 has already matched, so a structural
    // edit costs no digest and an unchanged condition-free definition costs no
    // crypto at all — while a condition body edit is still caught.
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
    return this.withLock(workflowRunId, async () => {
      const dag = await this.buildDAGForDefinition(workflowDefinitionId);
      const statusMap = await this.loadStatusMap(workflowRunId);
      return this.fullScan(workflowRunId, workflowDefinitionId, dag, statusMap);
    });
  }

  // ── Readiness (P1-19: full scan vs incremental frontier) ──

  /** Build status map: stageDefinitionId → status. */
  private async loadStatusMap(workflowRunId: string): Promise<Map<string, StageRunStatus>> {
    const stageRuns = await this.stageRunRepo.getByRunId(workflowRunId);
    const statusMap = new Map<string, StageRunStatus>();
    for (const sr of stageRuns) {
      statusMap.set(sr.stageDefinitionId, sr.status);
    }
    return statusMap;
  }

  /** A predecessor no longer blocks its successors once it is terminal. */
  private isTerminalForReadiness(status: StageRunStatus | undefined): boolean {
    return status === 'completed' || status === 'failed' || status === 'skipped';
  }

  /**
   * The readiness predicate — pending, with every predecessor terminal. Shared
   * so the incremental path can never drift from the full scan's definition of
   * "ready"; `routeFromTerminalStage` applies the same rule to the successors
   * it routes.
   */
  private isReady(
    nodeId: string,
    dag: DAG,
    statusMap: Map<string, StageRunStatus>,
  ): boolean {
    const node = dag.nodes.get(nodeId);
    if (!node) return false;
    this.stats.nodesExamined++;
    if (statusMap.get(nodeId) !== 'pending') return false;
    return node.dependencyIds.every((predId: string) =>
      this.isTerminalForReadiness(statusMap.get(predId)),
    );
  }

  /** Walk every node. The authoritative answer, and the fallback whenever the
   *  frontier cannot prove it would produce the same set. */
  private fullScan(
    workflowRunId: string,
    workflowDefinitionId: string,
    dag: DAG,
    statusMap: Map<string, StageRunStatus>,
  ): string[] {
    this.stats.fullScans++;
    const ready: string[] = [];
    for (const nodeId of dag.nodes.keys()) {
      if (this.isReady(nodeId, dag, statusMap)) ready.push(nodeId);
    }
    this.rememberFrontier(workflowRunId, workflowDefinitionId, dag, statusMap, ready);
    return ready;
  }

  private rememberFrontier(
    workflowRunId: string,
    workflowDefinitionId: string,
    dag: DAG,
    statuses: Map<string, StageRunStatus>,
    ready: string[],
  ): void {
    if (
      !this.runFrontiers.has(workflowRunId) &&
      this.runFrontiers.size >= DAGScheduler.MAX_TRACKED_FRONTIERS
    ) {
      // Map iteration is insertion-ordered, so this drops the oldest entry.
      const oldest = this.runFrontiers.keys().next();
      if (!oldest.done) this.runFrontiers.delete(oldest.value);
    }
    // Copy: the same array is handed to the caller, and the snapshot's
    // correctness argument collapses if a caller mutates it.
    this.runFrontiers.set(workflowRunId, {
      workflowDefinitionId,
      dag,
      statuses,
      ready: [...ready],
    });
  }

  /** Node index in `dag.nodes` iteration order, computed once per DAG. */
  private nodeOrderFor(dag: DAG): Map<string, number> {
    let order = this.dagNodeOrder.get(dag);
    if (!order) {
      order = new Map<string, number>();
      let i = 0;
      for (const nodeId of dag.nodes.keys()) order.set(nodeId, i++);
      this.dagNodeOrder.set(dag, order);
    }
    return order;
  }

  /**
   * Schedule next stages after a stage completes.
   * Returns the stageDefinitionIds that should be enqueued.
   *
   * △ This used to discard `completedStageDefId` and re-scan the whole DAG, so
   * a 200-stage workflow paid O(stages + edges) on every single completion.
   * The completed stage is exactly the information needed to avoid that: when
   * nothing else has moved since the last scan, the newly-ready stages can
   * only be its successors, and everything else that is ready was already
   * reported. The result is identical to the full scan — provably so, see the
   * guard below — and any doubt falls back to the full scan.
   */
  async scheduleNext(
    workflowRunId: string,
    workflowDefinitionId: string,
    completedStageDefId: string,
  ): Promise<string[]> {
    return this.withLock(workflowRunId, async () => {
      const dag = await this.buildDAGForDefinition(workflowDefinitionId);
      const statusMap = await this.loadStatusMap(workflowRunId);
      const frontier = this.runFrontiers.get(workflowRunId);

      // The frontier only holds if the previous snapshot was taken against
      // this same DAG object (a mid-run definition edit rebuilds it) and the
      // only stage whose status moved since then is the one that just
      // finished. Given that, a stage that is ready now but is neither the
      // completed stage nor one of its successors had the same status, and the
      // same predecessor statuses, at snapshot time — so it is already in
      // `frontier.ready`. Anything else and we cannot make that argument.
      const usable =
        frontier !== undefined &&
        frontier.workflowDefinitionId === workflowDefinitionId &&
        frontier.dag === dag &&
        frontier.statuses.size === statusMap.size &&
        this.onlyChangedStage(frontier.statuses, statusMap, completedStageDefId);

      if (!usable) {
        return this.fullScan(workflowRunId, workflowDefinitionId, dag, statusMap);
      }

      this.stats.incrementalScans++;

      // The completed stage itself is a candidate too: a retry can put it back
      // to `pending`, and it is not its own successor.
      const candidates = new Set<string>(frontier.ready);
      candidates.add(completedStageDefId);
      const completedNode = dag.nodes.get(completedStageDefId);
      if (completedNode) {
        for (const successorId of completedNode.dependentIds) candidates.add(successorId);
      }

      const ready: string[] = [];
      for (const candidateId of candidates) {
        if (this.isReady(candidateId, dag, statusMap)) ready.push(candidateId);
      }

      // Callers compare against `getReadyStages`, so the order must match the
      // full scan's `dag.nodes` order rather than candidate discovery order.
      const nodeOrder = this.nodeOrderFor(dag);
      ready.sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));

      this.rememberFrontier(workflowRunId, workflowDefinitionId, dag, statusMap, ready);
      return ready;
    });
  }

  /**
   * True when `fresh` differs from `snapshot` at `exemptStageDefId` and
   * nowhere else. Walking the freshly-read rows is O(rows) — the same order as
   * reading them — so this guard costs nothing the read did not already.
   */
  private onlyChangedStage(
    snapshot: Map<string, StageRunStatus>,
    fresh: Map<string, StageRunStatus>,
    exemptStageDefId: string,
  ): boolean {
    for (const [stageDefId, status] of fresh) {
      if (stageDefId === exemptStageDefId) continue;
      if (snapshot.get(stageDefId) !== status) return false;
    }
    return true;
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

      const allPredsReady = targetNode.dependencyIds.every((predId: string) =>
        this.isTerminalForReadiness(statusMap.get(predId)),
      );
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

    // The run has nothing left to schedule, so its frontier snapshot is dead
    // weight; dropping it here keeps a long-lived scheduler from accumulating
    // one entry per run it has ever advanced.
    this.runFrontiers.delete(workflowRunId);
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
      const allPredsDone = node.dependencyIds.every((predId: string) =>
        this.isTerminalForReadiness(statusMap.get(predId)),
      );
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
    // Frontier snapshots are taken against a specific DAG object. Rebuilding
    // produces a new one, which the identity check would reject anyway, but
    // dropping them here means an explicit reset leaves no state behind.
    for (const [runId, frontier] of this.runFrontiers) {
      if (frontier.workflowDefinitionId === workflowDefinitionId) {
        this.runFrontiers.delete(runId);
      }
    }
  }
}
