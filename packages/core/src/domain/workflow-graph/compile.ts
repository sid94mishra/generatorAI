// ────────────────────────────────────────────────────────────────
// compile(graph) — the executable form of a pinned definition version
// (P03 WP-3.3, G5 §5.1).
//
// The v2 scheduler never reads a `WorkflowGraph` directly: it reads the
// compiled form, in which
//   - every engine default is applied once (retry, repair, onExhausted,
//     timeouts, join, maxParallel — `STAGE_DEFAULTS` and the schema
//     defaults), so `decide()` has no optional policy to interpret;
//   - guards and edge `when` are parsed once (a parse error is kept and
//     surfaces as `condition_error` when the expression is needed, never as
//     a silent skip);
//   - edges are indexed both ways, in a stable order.
// Versions are immutable, so a compiled workflow can be cached by version
// id. P01's `RunDefinitionReader` serves the v1 engine until the cutover.
// ────────────────────────────────────────────────────────────────

import {
  parseExpression,
  RepairPolicySchema,
  RetryPolicySchema,
  STAGE_DEFAULTS,
  type Budget,
  type EdgeOn,
  type ExprNode,
  type JoinPolicy,
  type RepairPolicy,
  type RetryPolicy,
  type StageNodeClass,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';

/** A parsed expression, or the parse error to report when it is evaluated. */
export type CompiledExpr = { source: string; ast: ExprNode } | { source: string; error: string };

export interface CompiledEdge {
  from: string;
  to: string;
  on: EdgeOn;
  when?: CompiledExpr;
  /** A `failure` edge, or one marked `handlesFailure`: it absorbs a failure of `from` (W-29). */
  handlesFailure: boolean;
}

export interface CompiledTimeouts {
  queueMs: number;
  idleMs: number;
  attemptMs?: number;
  totalMs?: number;
}

export interface CompiledNode {
  key: string;
  kind: string;
  class: StageNodeClass;
  name: string;
  /** Position in the version's stage list (display order). */
  ordinal: number;
  parentKey?: string;
  join: JoinPolicy;
  guard?: CompiledExpr;
  retry: RetryPolicy;
  repair: RepairPolicy;
  onExhausted: 'pause' | 'fail';
  timeouts: CompiledTimeouts;
  budget?: Budget;
  sessionGroup?: string;
  /** The stage declares compensation actions (run in LIFO order on failure/cancel). */
  compensates: boolean;
  /** Edges into the node, sorted by source key. */
  incoming: CompiledEdge[];
  /** Edges out of the node, sorted by target key. */
  outgoing: CompiledEdge[];
}

export interface CompiledWorkflow {
  nodes: ReadonlyMap<string, CompiledNode>;
  /** Top-level node keys in key order (the instance-path order of the root scope). */
  rootKeys: readonly string[];
  maxParallel: number;
  budget?: Budget;
}

function compileExpr(source: string | undefined): CompiledExpr | undefined {
  if (source === undefined) return undefined;
  const parsed = parseExpression(source);
  return parsed.ok ? { source, ast: parsed.ast } : { source, error: parsed.error.message };
}

const DEFAULT_RETRY: RetryPolicy = RetryPolicySchema.parse({});
const DEFAULT_REPAIR: RepairPolicy = RepairPolicySchema.parse({});

/** Container kinds (P05) own child scopes; none exist before P05. */
function nodeClass(kind: string): StageNodeClass {
  if (kind === 'wait') return 'wait';
  if (kind === 'loop' || kind === 'map' || kind === 'subworkflow') return 'container';
  return 'work';
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Compile a parsed (defaults-applied) `WorkflowGraph`. Pure. */
export function compile(graph: WorkflowGraph): CompiledWorkflow {
  const nodes = new Map<string, CompiledNode>();
  graph.stages.forEach((stage, ordinal) => {
    // Per-kind fields (P05 §1.3): only agent and check stages run attempts.
    const agent = stage.kind === 'agent' ? stage : undefined;
    const work = stage.kind === 'agent' || stage.kind === 'check' ? stage : undefined;
    const timeouts: { queueMs?: number; idleMs?: number; attemptMs?: number; totalMs?: number } | undefined = work?.timeouts;
    nodes.set(stage.key, {
      key: stage.key,
      kind: stage.kind,
      class: nodeClass(stage.kind),
      name: stage.name,
      ordinal,
      ...(stage.parentKey ? { parentKey: stage.parentKey } : {}),
      join: stage.join,
      ...(stage.guard !== undefined ? { guard: compileExpr(stage.guard)! } : {}),
      retry: work?.retry ?? DEFAULT_RETRY,
      repair: agent?.repair ?? DEFAULT_REPAIR,
      onExhausted: agent?.onExhausted ?? STAGE_DEFAULTS.onExhausted,
      timeouts: {
        queueMs: timeouts?.queueMs ?? STAGE_DEFAULTS.timeouts.queueMs,
        idleMs: timeouts?.idleMs ?? STAGE_DEFAULTS.timeouts.idleMs,
        ...(timeouts?.attemptMs !== undefined ? { attemptMs: timeouts.attemptMs } : {}),
        ...(timeouts?.totalMs !== undefined ? { totalMs: timeouts.totalMs } : {}),
      },
      ...(stage.kind !== 'check' && stage.budget ? { budget: stage.budget } : {}),
      ...(agent?.sessionGroup ? { sessionGroup: agent.sessionGroup } : {}),
      compensates: (stage.compensate?.length ?? 0) > 0,
      incoming: [],
      outgoing: [],
    });
  });
  for (const e of graph.edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to) continue; // validateWorkflow rejects dangling edges before a version exists
    const edge: CompiledEdge = {
      from: e.from,
      to: e.to,
      on: e.on,
      ...(e.when !== undefined ? { when: compileExpr(e.when)! } : {}),
      handlesFailure: e.on === 'failure' || e.handlesFailure === true,
    };
    from.outgoing.push(edge);
    to.incoming.push(edge);
  }
  for (const n of nodes.values()) {
    n.incoming.sort((a, b) => byKey(a.from, b.from));
    n.outgoing.sort((a, b) => byKey(a.to, b.to));
  }
  const rootKeys = [...nodes.values()].filter((n) => !n.parentKey).map((n) => n.key).sort(byKey);
  return {
    nodes,
    rootKeys,
    maxParallel: graph.workflow.maxParallel ?? STAGE_DEFAULTS.maxParallel,
    ...(graph.workflow.budget ? { budget: graph.workflow.budget } : {}),
  };
}
