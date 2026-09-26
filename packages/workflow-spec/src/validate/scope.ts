// ────────────────────────────────────────────────────────────────
// Type environments for expressions and templates, per place of use.
//
//   guard, prompts, hooks   variables, run, stages (upstream only)
//   edge when               the same, from the source's view, plus parent
//   workflow outputs,
//   post-processing         variables, run, every top-level stage
//   preprocessing           variables, run
//
// Inside a loop body (P05 §2.2) the `loop` root is bound to the evaluation
// context of the place: T(k) for the templates, guards and edges of body
// stages, C(k) for `carry`, E(k) for exits, `onLimit.score` and
// `output.select`. `loops.<key>` is every enclosing loop. A body stage sees
// the stages upstream of it in its body and everything upstream of its
// container; body stages are never visible outside the loop, which exposes
// them through `stages.<loop>.output.last`. `item`, `map`, `maps` and
// `child` report `expr-scope-unavailable` until the 5B kinds bind them.
// ────────────────────────────────────────────────────────────────

import { checkExpression, type TypeEnv } from '../expr/typecheck.js';
import { T, kindsOf, nullable, typeFromJsonSchema, typeToString, union, withoutNull, type ExprType } from '../expr/types.js';
import { STAGE_RUN_STATES } from '../state/stageRun.js';
import type { VariableDefinition } from '../schemas/common.js';
import { CONTAINER_STAGE_KINDS, LOOP_EXIT_ACTIONS, type CheckStage, type LoopStage, type StageSpec } from '../schemas/stage.js';
import type { WorkflowGraph } from '../schemas/graph.js';
import type { PreprocessingStep } from '../schemas/workflow.js';

export function variableType(v: VariableDefinition): ExprType {
  let t: ExprType;
  switch (v.type) {
    case 'number':
      t = T.number;
      break;
    case 'boolean':
      t = T.boolean;
      break;
    case 'choice':
      t = v.options && v.options.length ? T.enumOf(v.options) : T.string;
      break;
    case 'list':
      t = T.list(T.string);
      break;
    case 'json':
      return T.any;
    default:
      t = T.string;
  }
  return v.required || v.defaultValue !== undefined ? t : nullable(t);
}

/** Names set by `set_variable` preprocessing steps, recursively. */
export function preprocessingVariableNames(steps: readonly PreprocessingStep[]): string[] {
  const out: string[] = [];
  const visit = (list: readonly PreprocessingStep[]) => {
    for (const s of list) {
      if (s.config.type === 'set_variable') out.push(s.config.variableName);
      if (s.config.type === 'conditional') {
        visit(s.config.thenSteps);
        visit(s.config.elseSteps ?? []);
      }
    }
  };
  visit(steps);
  return out;
}

export const USAGE_TYPE: ExprType = T.object({ turns: T.number, costUsd: nullable(T.number), tokens: nullable(T.number) });

/** `stages.<check>.output` (P05 §1.2). */
export function checkOutputType(stage: CheckStage): ExprType {
  return T.object({
    exitCode: T.number,
    passed: T.boolean,
    timedOut: T.boolean,
    stdoutTail: T.string,
    stderrTail: T.string,
    durationMs: T.number,
    json: stage.check.parseJson ? T.any : T.null,
    jsonError: nullable(T.string),
  });
}

/** The output type of an agent or check stage (loops need the graph: `GraphTypes.outputType`). */
export function stageOutputType(stage: StageSpec): ExprType {
  if (stage.kind === 'check') return checkOutputType(stage);
  if (stage.kind === 'agent') {
    if (stage.output.format === 'json') return stage.output.schema ? typeFromJsonSchema(stage.output.schema) : T.any;
    return T.string;
  }
  return T.any;
}

export function stageTypeOf(output: ExprType): ExprType {
  return T.object({
    status: T.enumOf(STAGE_RUN_STATES),
    output: nullable(output),
    summary: nullable(T.string),
    attempts: T.number,
    usage: USAGE_TYPE,
  });
}

/** `stages.<key>` of an agent or check stage. */
export function stageType(stage: StageSpec): ExprType {
  return stageTypeOf(stageOutputType(stage));
}

const CONTAINER_ROOTS: Record<string, string> = {
  loop: 'loop is only available inside a loop body and in the loop settings',
  loops: 'loops is only available inside a loop body',
  item: 'item is only available inside a map body',
  map: 'map is only available inside a map body',
  maps: 'maps is only available inside a nested map body',
  child: 'child is only available in a sub-workflow stage',
};

/** Where an expression or template sits: what it may read follows from this. */
export type ExprPlace =
  /** A stage's guard, prompts, hooks, check env (context T of its enclosing loops). */
  | { kind: 'stage'; key: string; self?: boolean }
  /** An edge `when`: the source's view, the source itself and `parent`. */
  | { kind: 'edge'; from: string }
  /** A loop's settings: exits/score/select (E), carry (C), carryInit (before the first iteration). */
  | { kind: 'loop'; key: string; context: 'E' | 'C' | 'init' }
  /** Workflow outputs and post-processing: every top-level stage. */
  | { kind: 'workflow' }
  /** Preprocessing: no stage has run. */
  | { kind: 'pre' };

export interface ScopeContext {
  graph: WorkflowGraph;
  /** Stages that always run before `key` (in its body and above its container). */
  upstream: (key: string) => ReadonlySet<string>;
  /** Extra variable names (set by preprocessing), typed as nullable strings. */
  extraVariables: readonly string[];
}

export interface CarryIssue {
  name: string;
  message: string;
}

/**
 * The types of one workflow document: stage outputs (loops included, their
 * carried state inferred), the loop contexts and the environment of every
 * place an expression may appear. Memoised; build one per validation.
 */
export class GraphTypes {
  private readonly byKey = new Map<string, StageSpec>();
  private readonly children = new Map<string, string[]>();
  private readonly outputs = new Map<string, ExprType>();
  private readonly carries = new Map<string, Record<string, ExprType>>();
  private readonly inProgress = new Set<string>();
  readonly carryIssues = new Map<string, CarryIssue[]>();
  private readonly base: Record<string, ExprType>;
  private readonly variableNames: Set<string>;

  constructor(private readonly ctx: ScopeContext) {
    const { graph } = ctx;
    for (const s of graph.stages) if (!this.byKey.has(s.key)) this.byKey.set(s.key, s);
    for (const s of graph.stages) {
      if (s.parentKey === undefined) continue;
      const list = this.children.get(s.parentKey) ?? [];
      list.push(s.key);
      this.children.set(s.parentKey, list);
    }
    const vars: Record<string, ExprType> = {};
    for (const v of graph.workflow.variables) vars[v.name] = variableType(v);
    for (const name of ctx.extraVariables) if (!vars[name]) vars[name] = nullable(T.string);
    this.variableNames = new Set(Object.keys(vars));
    const codebase = T.object({ path: T.string, branch: nullable(T.string), baseRef: nullable(T.string) });
    const codebases: Record<string, ExprType> = {};
    for (const a of graph.workflow.lifecycle.codebaseAliases) codebases[a] = codebase;
    this.base = {
      variables: T.object(vars),
      run: T.object({ id: T.string, name: T.string, codebases: T.object(codebases, nullable(codebase)) }),
    };
  }

  stage(key: string): StageSpec | undefined {
    return this.byKey.get(key);
  }

  /** Direct body stages of a container, in declaration order. */
  body(key: string): string[] {
    return this.children.get(key) ?? [];
  }

  /** Enclosing containers, nearest first. */
  containersOf(key: string): StageSpec[] {
    const out: StageSpec[] = [];
    const seen = new Set<string>([key]);
    let p = this.byKey.get(key)?.parentKey;
    while (p !== undefined && !seen.has(p)) {
      seen.add(p);
      const s = this.byKey.get(p);
      if (!s) break;
      out.push(s);
      p = s.parentKey;
    }
    return out;
  }

  /** The output type of any stage; a loop's is its loop output. */
  outputType(key: string): ExprType {
    const cached = this.outputs.get(key);
    if (cached) return cached;
    const stage = this.byKey.get(key);
    if (!stage) return T.any;
    if (stage.kind !== 'loop') {
      const t = stageOutputType(stage);
      this.outputs.set(key, t);
      return t;
    }
    if (this.inProgress.has(key)) return T.any; // a malformed self-reference; reported elsewhere
    this.inProgress.add(key);
    try {
      const t = this.loopOutputType(stage);
      this.outputs.set(key, t);
      return t;
    } finally {
      this.inProgress.delete(key);
    }
  }

  private stageRootType(key: string): ExprType {
    return stageTypeOf(this.outputType(key));
  }

  // ── Loops ────────────────────────────────────────────────────

  private signalsType(loop: LoopStage): ExprType {
    const perStage: Record<string, ExprType> = {};
    const entry = T.object({ toolCalls: nullable(T.number), outputHash: nullable(T.string), status: nullable(T.enumOf(STAGE_RUN_STATES)) });
    for (const k of this.body(loop.key)) perStage[k] = entry;
    return T.object({ toolCalls: nullable(T.number), workspaceChanged: nullable(T.boolean), stages: T.object(perStage) });
  }

  private iterationViewType(loop: LoopStage): ExprType {
    const stages: Record<string, ExprType> = {};
    for (const k of this.body(loop.key)) {
      stages[k] = T.object({
        status: T.enumOf(STAGE_RUN_STATES),
        output: nullable(this.outputType(k)),
        summary: nullable(T.string),
      });
    }
    return T.object({
      stages: { kind: 'object', fields: stages, unknown: { code: 'expr-unknown-stage', noun: 'body stage' } },
      signals: this.signalsType(loop),
      failures: T.list(T.object({ stageKey: T.string, code: nullable(T.string), message: nullable(T.string) })),
    });
  }

  private historyType(loop: LoopStage): ExprType {
    return T.list(
      T.object({
        k: T.number,
        exitValues: T.object({}, nullable(T.boolean)),
        signals: this.signalsType(loop),
        usage: USAGE_TYPE,
        score: nullable(T.number),
        durationMs: nullable(T.number),
      }),
    );
  }

  /** The `loop` root in context T, C or E of `loop`, with the given carry types. */
  loopRootType(loop: LoopStage, context: 'T' | 'C' | 'E', carry: Record<string, ExprType>): ExprType {
    const view = this.iterationViewType(loop);
    const carryT = T.object(carry);
    return T.object({
      iteration: T.number,
      number: T.number,
      maxIterations: T.number,
      remaining: T.number,
      last: context === 'T' ? nullable(view) : view,
      previous: nullable(view),
      carry: carryT,
      priorCarry: nullable(carryT),
      history: this.historyType(loop),
      usage: USAGE_TYPE,
      operatorInput: nullable(T.string),
    });
  }

  /** Types of the carried values of a loop: explicit (`carrySchema`) or inferred by fixed point. */
  carryTypes(loop: LoopStage): Record<string, ExprType> {
    const cached = this.carries.get(loop.key);
    if (cached) return cached;
    const spec = loop.loop;
    const names = [...new Set([...Object.keys(spec.carryInit ?? {}), ...Object.keys(spec.carry ?? {})])];
    const issues: CarryIssue[] = [];
    const initEnv = this.env({ kind: 'loop', key: loop.key, context: 'init' });
    const init: Record<string, ExprType> = {};
    for (const [name, src] of Object.entries(spec.carryInit ?? {})) init[name] = checkExpression(src, initEnv).type;

    const schema: Record<string, ExprType> = {};
    for (const [name, s] of Object.entries(spec.carrySchema ?? {})) schema[name] = typeFromJsonSchema(s);

    // A carry without carryInit is null in iteration 0 (the nullable-first-iteration rule).
    let guess: Record<string, ExprType> = {};
    for (const name of names) {
      guess[name] = schema[name] ? (init[name] ? schema[name]! : nullable(schema[name]!)) : init[name] ? init[name]! : T.null;
    }
    this.carries.set(loop.key, guess); // provisional: a self-reference reads the current guess
    const exprTypes: Record<string, ExprType> = {};
    for (let round = 0; round < 4; round++) {
      const env = this.loopEnv(loop, 'C', guess);
      const next: Record<string, ExprType> = {};
      for (const name of names) {
        const src = spec.carry?.[name];
        if (src === undefined || schema[name]) {
          next[name] = guess[name]!;
          continue;
        }
        const t = checkExpression(src, env).type;
        exprTypes[name] = t;
        next[name] = union([init[name] ?? T.null, t]);
      }
      const unstable = names.filter((n) => typeToString(next[n]!) !== typeToString(guess[n]!));
      // A carry whose type keeps growing (a self-reference that nests) is typed `any`.
      if (round === 3) for (const n of unstable) next[n] = T.any;
      guess = next;
      this.carries.set(loop.key, guess);
      if (unstable.length === 0) break;
    }
    // Checks: an explicit schema must accept the expression; carryInit and carry must agree.
    const env = this.loopEnv(loop, 'C', guess);
    for (const [name, src] of Object.entries(spec.carry ?? {})) {
      const t = exprTypes[name] ?? checkExpression(src, env).type;
      if (schema[name] && !compatible(schema[name]!, t)) {
        issues.push({ name, message: `carry '${name}' is ${typeToString(t)}, but carrySchema declares ${typeToString(schema[name]!)}` });
      }
      if (init[name] && !compatible(init[name]!, t)) {
        issues.push({ name, message: `carryInit '${name}' is ${typeToString(init[name]!)}, but its carry expression is ${typeToString(t)}` });
      }
    }
    this.carryIssues.set(loop.key, issues);
    this.carries.set(loop.key, guess);
    return guess;
  }

  private loopOutputType(loop: LoopStage): ExprType {
    const last: Record<string, ExprType> = {};
    for (const k of this.body(loop.key)) last[k] = nullable(this.outputType(k));
    const carry = this.carryTypes(loop);
    const fields: Record<string, ExprType> = {
      iterations: T.number,
      exitReason: nullable(T.string),
      exitAction: nullable(T.enumOf([...LOOP_EXIT_ACTIONS, 'accept', 'accept_iteration', 'accept_last', 'accept_best'])),
      last: T.object(last),
      wrapUp: nullable(T.object({ text: T.string })),
      carry: T.object(carry),
      history: this.historyType(loop),
    };
    const select = loop.loop.output.select ?? {};
    if (Object.keys(select).length > 0) {
      const env = this.loopEnv(loop, 'E', carry);
      for (const [name, src] of Object.entries(select)) {
        if (fields[name]) continue; // select cannot shadow a built-in field (reported by the validator)
        fields[name] = checkExpression(src, env).type;
      }
    }
    return T.object(fields);
  }

  // ── Environments ─────────────────────────────────────────────

  /**
   * The `stages` root for a set of visible keys, seen from inside the given
   * containers: a hidden stage in one of those bodies has not run yet; one
   * in any other body is out of scope.
   */
  private stagesRoot(visible: ReadonlySet<string> | 'top', inside: ReadonlySet<string> = new Set()): ExprType {
    const fields: Record<string, ExprType> = {};
    for (const s of this.ctx.graph.stages) {
      if (fields[s.key]) continue;
      const shown = visible === 'top' ? s.parentKey === undefined : visible.has(s.key);
      if (shown) {
        fields[s.key] = this.stageRootType(s.key);
      } else if (s.parentKey !== undefined && !inside.has(s.parentKey)) {
        fields[s.key] = T.unavailable(
          'expr-scope-unavailable',
          `Stage '${s.key}' is in the body of '${s.parentKey}': outside the body read it as stages.${s.parentKey}.output.last.${s.key}`,
        );
      } else {
        fields[s.key] = T.unavailable(
          'expr-stage-not-upstream',
          `Stage '${s.key}' has not run yet here: only stages upstream of this point can be read`,
          'Add an edge so that it runs first',
        );
      }
    }
    // A key that is not a stage at all gets its own code.
    return { kind: 'object', fields, unknown: { code: 'expr-unknown-stage', noun: 'stage' } };
  }

  private rootsWith(stages: ExprType, extra: Record<string, ExprType>): TypeEnv {
    const roots: Record<string, ExprType> = { ...this.base, stages };
    roots['parent'] = T.unavailable('expr-scope-unavailable', 'parent is only available in an edge `when` expression');
    for (const [root, message] of Object.entries(CONTAINER_ROOTS)) roots[root] = T.unavailable('expr-scope-unavailable', message);
    Object.assign(roots, extra);
    return { roots, variableNames: this.variableNames };
  }

  /** `loop` and `loops` for a place inside the body of the given containers (nearest first), context T. */
  private loopRoots(containers: readonly StageSpec[]): Record<string, ExprType> {
    const loops = containers.filter((c): c is LoopStage => c.kind === 'loop');
    if (loops.length === 0) return {};
    const byLoop: Record<string, ExprType> = {};
    for (const l of loops) byLoop[l.key] = this.loopRootType(l, 'T', this.carryTypes(l));
    return {
      loop: byLoop[loops[0]!.key]!,
      loops: { kind: 'object', fields: byLoop, unknown: { code: 'expr-unknown-field', noun: 'enclosing loop' } },
    };
  }

  /** The environment of a loop's own settings. */
  private loopEnv(loop: LoopStage, context: 'E' | 'C', carry: Record<string, ExprType>): TypeEnv {
    const visible = new Set([...this.ctx.upstream(loop.key), ...this.body(loop.key)]);
    const outer = this.loopRoots(this.containersOf(loop.key));
    const loopsField = outer['loops'] as Extract<ExprType, { kind: 'object' }> | undefined;
    const own = this.loopRootType(loop, context, carry);
    return this.rootsWith(this.stagesRoot(visible, this.insideOf(loop.key, true)), {
      loop: own,
      loops: { kind: 'object', fields: { ...(loopsField?.fields ?? {}), [loop.key]: own }, unknown: { code: 'expr-unknown-field', noun: 'enclosing loop' } },
    });
  }

  /** Keys of the containers a place sits in (and the container itself, for its own settings). */
  private insideOf(key: string, self = false): Set<string> {
    const out = new Set(this.containersOf(key).map((c) => c.key));
    if (self) out.add(key);
    return out;
  }

  /** The type environment of a place. */
  env(place: ExprPlace): TypeEnv {
    switch (place.kind) {
      case 'pre':
        return this.rootsWith(T.unavailable('expr-scope-unavailable', 'Stages have not run yet during preprocessing'), {});
      case 'workflow':
        return this.rootsWith(this.stagesRoot('top'), {});
      case 'stage': {
        const visible = new Set(this.ctx.upstream(place.key));
        if (place.self) visible.add(place.key);
        return this.rootsWith(this.stagesRoot(visible, this.insideOf(place.key)), this.loopRoots(this.containersOf(place.key)));
      }
      case 'edge': {
        const visible = new Set([...this.ctx.upstream(place.from), place.from]);
        return this.rootsWith(this.stagesRoot(visible, this.insideOf(place.from)), {
          ...this.loopRoots(this.containersOf(place.from)),
          parent: T.object({ status: T.enumOf(STAGE_RUN_STATES) }),
        });
      }
      case 'loop': {
        const loop = this.byKey.get(place.key);
        if (!loop || loop.kind !== 'loop') return this.rootsWith(this.stagesRoot(new Set()), {});
        if (place.context === 'init') {
          return this.rootsWith(this.stagesRoot(new Set(this.ctx.upstream(loop.key)), this.insideOf(loop.key)), {
            ...this.loopRoots(this.containersOf(loop.key)),
            loop: T.unavailable('expr-scope-unavailable', 'carryInit is evaluated before the first iteration: it cannot read loop'),
          });
        }
        return this.loopEnv(loop, place.context, this.carryTypes(loop));
      }
    }
  }
}

/** Whether two types can hold the same value (null and `list<any>` are compatible with anything of their kind). */
function compatible(a: ExprType, b: ExprType): boolean {
  if (a.kind === 'any' || b.kind === 'any') return true;
  const ka = kindsOf(withoutNull(a));
  const kb = kindsOf(withoutNull(b));
  if (ka.has('null') || kb.has('null')) return true;
  for (const k of ka) if (kb.has(k)) return true;
  return false;
}

/** Whether a stage kind owns a body. */
export function isContainerKind(kind: string): boolean {
  return CONTAINER_STAGE_KINDS.includes(kind);
}
