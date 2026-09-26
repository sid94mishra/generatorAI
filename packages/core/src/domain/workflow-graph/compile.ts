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
  expansionNodeKey,
  mapMergeMode,
  parseExpression,
  stagesRead,
  RepairPolicySchema,
  RetryPolicySchema,
  STAGE_DEFAULTS,
  type Budget,
  type CheckSpec,
  type DynamicExpansion,
  type EdgeOn,
  type EdgeSpec,
  type ExprNode,
  type JoinPolicy,
  type LoopSpec,
  type MapMergeMode,
  type MapSpec,
  type PromptDefinition,
  type RepairPolicy,
  type RetryPolicy,
  type StageNodeClass,
  type StageSpec,
  type SubworkflowSpec,
  type WaitSpec,
  type WorkflowGraph,
  type WorkflowRef,
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

export interface CompiledExitRule {
  when: CompiledExpr;
  action: 'complete' | 'fail' | 'pause' | 'exhaust';
  consecutive: number;
  reason: string;
}

/** A loop's settings, defaults applied and expressions parsed (P05 §2.1). */
export interface CompiledLoop {
  maxIterations: number;
  exits: CompiledExitRule[];
  carryInit: Array<[string, CompiledExpr]>;
  carry: Array<[string, CompiledExpr]>;
  onLimit: { mode: 'pause' | 'fail' | 'accept_last' } | { mode: 'accept_best'; score: CompiledExpr };
  wrapUp?: { stage: string; prompt: { label: string; text: string }; maxTurns: number; maxCostShare: number };
  onBodyFailure: 'fail' | 'next_iteration';
  /** Checkpoint every iteration (default: on with accept_best). */
  checkpointEachIteration: boolean;
  select: Array<[string, CompiledExpr]>;
}

/** A map's settings, defaults applied and expressions parsed (P05 §4.1). */
export interface CompiledMap {
  items: CompiledExpr;
  itemKey?: CompiledExpr;
  maxItems: number;
  concurrency: number;
  toleratedFailurePercent: number;
  workspace: 'shared' | 'mount_per_item';
  merge: MapMergeMode;
  /**
   * A winner merge (P08 §7): the key, and the stages of the map's scope it
   * reads — once they settled the key is evaluated and the winner merged;
   * the stages after them wait for that merge.
   */
  winner?: { key: CompiledExpr; after: string[] };
  itemSetup: CheckSpec[];
  select: Array<[string, CompiledExpr]>;
}

/** A wait's settings (P05 §4.3). */
export type CompiledWait =
  | { type: 'approval'; prompt: PromptDefinition; form?: Record<string, unknown>; timeoutMs?: number; onTimeout: 'fail' | 'complete' }
  | { type: 'event'; eventKey: CompiledExpr; timeoutMs?: number; onTimeout: 'fail' | 'complete' }
  | { type: 'timer'; durationMs: number };

/** A sub-workflow's settings (P05 §4.2). */
export interface CompiledSubworkflow {
  ref: WorkflowRef;
  version: 'pin_at_run_start' | number;
  inputs: Array<[string, CompiledExpr]>;
  workspace: 'inherit' | 'isolated';
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
  /** An agent stage's summary policy (P07 WP-7.1): `llm` summaries are written after completion. */
  summary?: 'none' | 'auto' | 'llm';
  /** An agent stage's context sources and mode: a `summary` reader waits for a pending `llm` summary. */
  context?: { mode: 'summary' | 'output' | 'structured' | 'none'; from?: readonly string[] };
  /** The stage declares compensation actions (run in LIFO order on failure/cancel). */
  compensates: boolean;
  /** Edges into the node, sorted by source key. */
  incoming: CompiledEdge[];
  /** Edges out of the node, sorted by target key. */
  outgoing: CompiledEdge[];
  /** A loop container's settings. */
  loop?: CompiledLoop;
  /** A map container's settings. */
  map?: CompiledMap;
  /** A wait stage's settings. */
  wait?: CompiledWait;
  /** A sub-workflow stage's settings. */
  subworkflow?: CompiledSubworkflow;
  /** A container's direct body stages, in key order. */
  body: readonly string[];
  /** A planner's plan-then-execute settings (P08 §8). */
  expands?: DynamicExpansion;
  /** The implicit expansion node of this planner (kind `expansion`, key `<planner>~x`). */
  plannerKey?: string;
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

/** Node classes: work nodes run attempts, a wait parks, containers own child scopes (a sub-workflow's is its child run). */
function nodeClass(kind: string): StageNodeClass {
  if (kind === 'wait') return 'wait';
  if (kind === 'loop' || kind === 'map' || kind === 'subworkflow') return 'container';
  return 'work';
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function compileLoop(spec: LoopSpec): CompiledLoop {
  return {
    maxIterations: spec.maxIterations,
    exits: spec.exits.map((r) => ({ when: compileExpr(r.when)!, action: r.action, consecutive: r.consecutive, reason: r.reason })),
    carryInit: exprs(spec.carryInit),
    carry: exprs(spec.carry),
    onLimit: spec.onLimit.mode === 'accept_best' ? { mode: 'accept_best', score: compileExpr(spec.onLimit.score)! } : { mode: spec.onLimit.mode },
    ...(spec.wrapUp
      ? { wrapUp: { stage: spec.wrapUp.stage, prompt: spec.wrapUp.prompt, maxTurns: spec.wrapUp.maxTurns, maxCostShare: spec.wrapUp.maxCostShare } }
      : {}),
    onBodyFailure: spec.onBodyFailure,
    checkpointEachIteration: spec.checkpointEachIteration ?? spec.onLimit.mode === 'accept_best',
    select: exprs(spec.output.select),
  };
}

const exprs = (rec: Record<string, string> | undefined): Array<[string, CompiledExpr]> =>
  Object.keys(rec ?? {})
    .sort(byKey)
    .map((name) => [name, compileExpr(rec![name])!]);

function compileMap(spec: MapSpec, siblings: ReadonlySet<string>): CompiledMap {
  const winner = typeof spec.merge === 'object' ? compileExpr(spec.merge.key)! : undefined;
  return {
    items: compileExpr(spec.items)!,
    ...(spec.itemKey !== undefined ? { itemKey: compileExpr(spec.itemKey)! } : {}),
    maxItems: spec.maxItems,
    concurrency: spec.concurrency,
    toleratedFailurePercent: spec.toleratedFailurePercent,
    workspace: spec.workspace,
    merge: mapMergeMode(spec.merge),
    ...(winner ? { winner: { key: winner, after: 'ast' in winner ? stagesRead(winner.ast).filter((k) => siblings.has(k)).sort(byKey) : [] } } : {}),
    itemSetup: spec.itemSetup ?? [],
    select: exprs(spec.output.select),
  };
}

function compileWait(spec: WaitSpec): CompiledWait {
  switch (spec.type) {
    case 'approval':
      return {
        type: 'approval',
        prompt: spec.prompt,
        ...(spec.form ? { form: spec.form } : {}),
        ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
        onTimeout: spec.onTimeout,
      };
    case 'event':
      return {
        type: 'event',
        eventKey: compileExpr(spec.eventKey)!,
        ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
        onTimeout: spec.onTimeout,
      };
    case 'timer':
      return { type: 'timer', durationMs: spec.durationMs };
  }
}

function compileSubworkflow(spec: SubworkflowSpec): CompiledSubworkflow {
  return { ref: spec.workflowRef, version: spec.version, inputs: exprs(spec.inputs), workspace: spec.workspace };
}

/** Compile a parsed (defaults-applied) `WorkflowGraph`. Pure. */
export function compile(graph: WorkflowGraph): CompiledWorkflow {
  const nodes = compileNodes(graph.stages, graph.edges);
  const rootKeys = [...nodes.values()].filter((n) => !n.parentKey).map((n) => n.key).sort(byKey);
  return {
    nodes,
    rootKeys,
    maxParallel: graph.workflow.maxParallel ?? STAGE_DEFAULTS.maxParallel,
    ...(graph.workflow.budget ? { budget: graph.workflow.budget } : {}),
  };
}

/**
 * The nodes of a set of stages and edges: a workflow's, or a planner's
 * stored expansion (P08 §8). A planner gets its implicit expansion node
 * `<planner>~x` (a container in the planner's scope): the edge planner →
 * `~x` is added and the planner's SUCCESS edges leave from `~x` instead, so
 * its successors wait for the planned stages; its failure, completion and
 * always edges stay on the planner.
 */
export function compileNodes(stages: readonly StageSpec[], edgeSpecs: readonly EdgeSpec[]): Map<string, CompiledNode> {
  const graph = { stages, edges: edgeSpecs };
  const nodes = new Map<string, CompiledNode>();
  const bodies = new Map<string, string[]>();
  for (const s of graph.stages) {
    if (!s.parentKey) continue;
    bodies.set(s.parentKey, [...(bodies.get(s.parentKey) ?? []), s.key]);
  }
  const siblingsOf = (key: string, parentKey: string | undefined) =>
    new Set(graph.stages.filter((s) => s.parentKey === parentKey && s.key !== key).map((s) => s.key));
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
      ...((stage.kind === 'agent' || stage.kind === 'loop' || stage.kind === 'map' || stage.kind === 'subworkflow') && stage.budget ? { budget: stage.budget } : {}),
      ...(agent?.sessionGroup ? { sessionGroup: agent.sessionGroup } : {}),
      ...(agent ? { summary: agent.output.summary, context: { mode: agent.context.mode, ...(agent.context.from ? { from: agent.context.from } : {}) } } : {}),
      compensates: (stage.compensate?.length ?? 0) > 0,
      incoming: [],
      outgoing: [],
      body: [...(bodies.get(stage.key) ?? [])].sort(byKey),
      ...(stage.kind === 'loop' ? { loop: compileLoop(stage.loop) } : {}),
      ...(stage.kind === 'map' ? { map: compileMap(stage.map, siblingsOf(stage.key, stage.parentKey)) } : {}),
      ...(stage.kind === 'wait' ? { wait: compileWait(stage.wait) } : {}),
      ...(stage.kind === 'subworkflow' ? { subworkflow: compileSubworkflow(stage.subworkflow) } : {}),
    });
  });
  // Plan-then-execute (P08 §8): each planner's implicit expansion node.
  const planners = new Set<string>();
  for (const stage of graph.stages) {
    if (stage.kind !== 'agent' || !stage.expands) continue;
    const planner = nodes.get(stage.key)!;
    planner.expands = stage.expands;
    planners.add(stage.key);
    const key = expansionNodeKey(stage.key);
    nodes.set(key, {
      ...containerDefaults(key, `Planned by ${stage.name}`, planner.ordinal + 0.5),
      kind: 'expansion',
      ...(stage.parentKey ? { parentKey: stage.parentKey } : {}),
      plannerKey: stage.key,
    });
    if (stage.parentKey) bodies.set(stage.parentKey, [...(bodies.get(stage.parentKey) ?? []), key]);
  }
  const edges: EdgeSpec[] = [];
  for (const e of graph.edges) edges.push(planners.has(e.from) && e.on === 'success' ? { ...e, from: expansionNodeKey(e.from) } : e);
  for (const p of [...planners].sort(byKey)) edges.push({ from: p, to: expansionNodeKey(p), on: 'success' });
  for (const [parent, keys] of bodies) {
    const n = nodes.get(parent);
    if (n) n.body = [...keys].sort(byKey);
  }
  for (const e of edges) {
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
  // A winner key waits only for the stages it reads AFTER the map (upstream ones have settled).
  for (const n of nodes.values()) {
    if (!n.map?.winner) continue;
    const after = new Set<string>();
    const frontier = n.outgoing.map((e) => e.to);
    while (frontier.length > 0) {
      const k = frontier.pop()!;
      if (after.has(k)) continue;
      after.add(k);
      frontier.push(...(nodes.get(k)?.outgoing.map((e) => e.to) ?? []));
    }
    n.map.winner.after = n.map.winner.after.filter((k) => after.has(k));
  }
  return nodes;
}

/** A node with the engine defaults and no settings: an implicit container. */
function containerDefaults(key: string, name: string, ordinal: number): CompiledNode {
  return {
    key,
    kind: 'expansion',
    class: 'container',
    name,
    ordinal,
    join: { mode: 'all' },
    retry: DEFAULT_RETRY,
    repair: DEFAULT_REPAIR,
    onExhausted: STAGE_DEFAULTS.onExhausted,
    timeouts: { queueMs: STAGE_DEFAULTS.timeouts.queueMs, idleMs: STAGE_DEFAULTS.timeouts.idleMs },
    compensates: false,
    incoming: [],
    outgoing: [],
    body: [],
  };
}
