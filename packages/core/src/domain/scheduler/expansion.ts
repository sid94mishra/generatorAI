// ────────────────────────────────────────────────────────────────
// Dynamic expansion (P08 WP-8.4, G5 §4.7), inside the
// pure decide(). The engine knows only the implicit `expansion` node kind;
// the planner-then-stages scenario is a template.
//
//   planner          an agent stage with `expands`; its output contract is
//                    the plan schema (the executor repairs a plan that does
//                    not hold, `validateExpansion` included)
//   <planner>~x      the implicit container compile() adds after the
//                    planner (the planner's success edges leave from it);
//                    it becomes ready when the planner completes — in the
//                    SAME decide() call, so the same store transaction
//   ~x ready         validate the plan against `expands` (the allow-lists,
//                    maxStages, keys, an acyclic graph) and compile it into
//                    full agent stages; invalid → the node fails with
//                    expansion_invalid. Valid → the plan is stored in the
//                    node's state and every planned stage gets its instance
//                    `<path>~x/<key>` (deterministic ids): recovery and
//                    replay read the stored plan, never the planner again
//   scope terminal   join all: a failed planned stage (not handled by an
//                    edge) fails the node (expansion_failed); tolerate:
//                    it completes and lists the failures. Output
//                    `{count, results, failures}`; `stages.<planner>.expansion`
//                    reads it
//
// Planned stages are agent stages only: no hooks, MCP servers, checks,
// loops or custom-script rules exist in the plan's shape; agents and models
// come from the allow-lists; `readOnly` can only lower the permission, and
// the run's permission ceiling applies as to every stage.
// ────────────────────────────────────────────────────────────────

import {
  AgentStageSchema,
  analyzeGraph,
  EXPANSION_SUFFIX,
  ExpansionPlanSchema,
  isTerminalStageRunState,
  type AgentStage,
  type DynamicExpansion,
  type ExpansionResult,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import { classified } from '../errors/StageError.js';
import type { CompiledNode, CompiledWorkflow } from '../workflow-graph/compile.js';
import { instanceId } from './ids.js';
import { winnerPending } from './maps.js';
import { expansionNodes, expansionStateOf } from './scope.js';
import { computeScopeOutcome } from './terminal.js';
import type { ExpansionState, InstanceState, RunState } from './types.js';
import { failInstance, stageEvent, type Working } from './working.js';

export type ExpansionCheck = { ok: true; stages: AgentStage[]; edges: Array<{ from: string; to: string }> } | { ok: false; message: string };

/**
 * Validate and clamp a planner's plan (pure): the executor runs it as part
 * of the output contract (a repair turn can fix the plan), and the expansion
 * node runs it again before it stores the plan.
 */
export function validateExpansion(plan: unknown, cfg: DynamicExpansion, reserved: ReadonlySet<string>): ExpansionCheck {
  const fail = (message: string): ExpansionCheck => ({ ok: false, message });
  const parsed = ExpansionPlanSchema.safeParse(plan);
  if (!parsed.success) {
    const first = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(the plan)'}: ${i.message}`);
    return fail(`The plan does not have the plan shape: ${first.join('; ')}`);
  }
  const { stages, edges } = parsed.data;
  if (stages.length > cfg.maxStages) return fail(`The plan has ${stages.length} stages; at most ${cfg.maxStages} are allowed (expands.maxStages)`);
  const keys = new Set<string>();
  for (const s of stages) {
    if (keys.has(s.key)) return fail(`Two planned stages have the key '${s.key}'`);
    if (reserved.has(s.key)) return fail(`'${s.key}' is already a stage of the workflow: give the planned stage another key`);
    keys.add(s.key);
    if (s.agentRef !== undefined && !cfg.allowedAgentRefs.includes(s.agentRef)) {
      return fail(`'${s.key}' names the agent '${s.agentRef}'; allowed: ${cfg.allowedAgentRefs.join(', ') || 'none (the default agent only)'}`);
    }
    if (s.model !== undefined && !cfg.allowedModels.includes(s.model)) {
      return fail(`'${s.key}' names the model '${s.model}'; allowed: ${cfg.allowedModels.join(', ') || 'none (the default model only)'}`);
    }
  }
  const pairs = new Set<string>();
  const out: Array<{ from: string; to: string }> = [];
  for (const e of edges) {
    if (!keys.has(e.from) || !keys.has(e.to)) return fail(`The edge ${e.from} → ${e.to} names a stage the plan does not have`);
    if (e.from === e.to) return fail(`The edge ${e.from} → ${e.to} connects a stage to itself`);
    const pair = `${e.from}\u0000${e.to}`;
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    out.push({ from: e.from, to: e.to });
  }
  const cyclic = analyzeGraph([...keys], out).unordered;
  if (cyclic.length > 0) return fail(`The planned edges form a cycle through ${cyclic.slice(0, 5).join(', ')}`);
  const specs = stages.map((s) => {
    const session = {
      ...(s.agentRef !== undefined ? { agentRef: s.agentRef } : {}),
      ...(s.model !== undefined ? { model: s.model } : {}),
      ...(s.readOnly ? { permissionMode: 'plan' as const } : {}),
    };
    return AgentStageSchema.parse({
      key: s.key,
      name: s.name,
      kind: 'agent',
      prompts: [{ label: 'task', text: s.prompt }],
      ...(Object.keys(session).length > 0 ? { session } : {}),
    });
  });
  return { ok: true, stages: specs, edges: out };
}

/**
 * The run's graph as an instance inside an expansion sees it: the pinned
 * version plus the planned stages and edges (the executor reads the stage
 * spec, its context sources and its session from it). Unchanged elsewhere.
 */
export function graphForInstance(graph: WorkflowGraph, state: RunState, inst: InstanceState): WorkflowGraph {
  const container = inst.scopeId ? state.instances.find((i) => i.id === inst.scopeId) : undefined;
  const xs = container ? expansionStateOf(container) : null;
  if (!xs) return graph;
  return {
    ...graph,
    stages: [...graph.stages, ...xs.stages],
    edges: [...graph.edges, ...xs.edges.map((e) => ({ from: e.from, to: e.to, on: 'success' as const }))],
  };
}

function results(w: Working, inst: InstanceState, xs: ExpansionState): ExpansionResult[] {
  const byKey = new Map(w.scopeInstances(inst.id, null).map((i) => [i.stageKey, i]));
  return xs.stages.map((s) => {
    const i = byKey.get(s.key);
    return {
      key: s.key,
      name: s.name,
      status: i?.status ?? 'pending',
      output: i?.output ?? null,
      summary: i?.summary ?? null,
      error: i?.error ?? null,
    };
  });
}

// ── Start ─────────────────────────────────────────────────────────

/** A ready expansion node: validate the planner's plan, store it, instantiate its scope. */
function startExpansion(w: Working, inst: InstanceState, node: CompiledNode): void {
  const planner = node.plannerKey ? w.sibling(inst, node.plannerKey) : undefined;
  const cfg = planner ? w.node(planner)?.expands : undefined;
  const invalid = (message: string, xs: Partial<ExpansionState> = {}) => {
    w.transition(inst, 'running', {
      statusReason: null,
      containerState: { kind: 'expansion', phase: 'done', plannerId: planner?.id ?? '', stages: [], edges: [], join: cfg?.join ?? 'all', ...xs },
    });
    failInstance(w, inst, classified('expansion_invalid', message), 'expansion:invalid');
  };
  if (!planner || !cfg) return invalid(`The planner '${node.plannerKey ?? '?'}' of this expansion is missing`);
  const r = validateExpansion(planner.output, cfg, new Set(w.graph.nodes.keys()));
  if (!r.ok) return invalid(`The plan of '${planner.stageKey}' was refused: ${r.message}`);
  const state: ExpansionState = { kind: 'expansion', phase: 'running', plannerId: planner.id, stages: r.stages, edges: r.edges, join: cfg.join };
  w.transition(inst, 'running', { statusReason: null, containerState: state });
  stageEvent(w, 'stage_run.running', inst, { kind: 'expansion' });
  w.emit('expansion.started', {
    stageRunId: inst.id,
    stageKey: inst.stageKey,
    instancePath: inst.instancePath,
    plannerId: planner.id,
    count: r.stages.length,
    keys: r.stages.map((s) => s.key),
  });
  w.addInstances(
    r.stages.map((s) => {
      const path = `${inst.instancePath}/${s.key}`;
      return { id: instanceId(w.run.id, path), stageKey: s.key, kind: 'agent', name: s.name, instancePath: path, scopeId: inst.id };
    }),
  );
}

// ── The end ───────────────────────────────────────────────────────

function completeExpansion(w: Working, inst: InstanceState, xs: ExpansionState): void {
  const scope = w.scopeInstances(inst.id, null);
  const outcome = computeScopeOutcome({ ...w.graph, nodes: expansionNodes(xs) } as CompiledWorkflow, scope, w.scopeFor);
  const all = results(w, inst, xs);
  const failures = all.filter((r) => r.status !== 'completed' && r.status !== 'skipped');
  const output = { count: all.length, results: all, failures };
  w.instancePatch(inst, { containerState: { ...xs, phase: 'done' } });
  if (outcome === 'cancelled' || (outcome === 'failed' && xs.join === 'all')) {
    w.instancePatch(inst, { outputData: output });
    const first = failures[0];
    const err = classified('expansion_failed', `${failures.length} of ${all.length} planned stages did not complete${first ? `; '${first.key}' ${first.status}${first.error ? `: ${first.error}` : ''}` : ''}`);
    return failInstance(w, inst, err, `expansion:${outcome}`);
  }
  w.transition(inst, 'completed', {
    statusReason: null,
    outputData: output,
    summary: `${node(w, inst)}: ${all.length - failures.length} of ${all.length} planned stages completed`,
    error: null,
    errorClass: null,
    errorCode: null,
  });
  stageEvent(w, 'stage_run.completed', inst, { count: all.length, failures: failures.length });
}

const node = (w: Working, inst: InstanceState) => w.node(inst)?.name ?? inst.stageKey;

// ── Settle ────────────────────────────────────────────────────────

/** Expansion nodes that can move: a ready one starts, one whose planned stages all ended completes. */
export function settleExpansions(w: Working): boolean {
  let changed = false;
  for (const inst of w.sorted()) {
    if (!inst.stageKey.endsWith(EXPANSION_SUFFIX)) continue;
    const n = w.node(inst);
    if (n?.kind !== 'expansion') continue;
    if (inst.status === 'ready' && inst.containerState == null) {
      startExpansion(w, inst, n);
      changed = true;
      continue;
    }
    const xs = expansionStateOf(inst);
    if (!xs || inst.status !== 'running' || xs.phase !== 'running') continue;
    const scope = w.scopeInstances(inst.id, null);
    if (scope.length > 0 && scope.every((i) => isTerminalStageRunState(i.status)) && !winnerPending(scope)) {
      completeExpansion(w, inst, xs);
      changed = true;
    }
  }
  return changed;
}

/** The scopes readiness runs in: every running expansion's planned stages. */
export function expansionScopes(w: Working): Array<{ containerId: string; iteration: null }> {
  return w
    .sorted()
    .filter((i) => i.status === 'running' && expansionStateOf(i)?.phase === 'running')
    .map((i) => ({ containerId: i.id, iteration: null }));
}
