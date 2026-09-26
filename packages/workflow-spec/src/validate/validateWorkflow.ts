// ────────────────────────────────────────────────────────────────
// validateWorkflow: the one validator for workflow documents.
//
// Pure: the builder runs it in the browser, the server runs it on every
// save, import and publish, and the CLI and the authoring skill run it
// offline. Layers, in order:
//   1. strict schema (unknown fields are errors, with hints; a field of
//      another stage kind is `field-not-applicable`);
//   2. the graph (keys, edges, one edge per pair, cycles per scope,
//      containers: parents, nesting depth, edges crossing a scope, bodies);
//   3. references (variables, context sources, output contracts, joins,
//      loop and map settings, check commands, wait forms, sub-workflow
//      references when a resolver is given);
//   4. expressions and templates (parse and type-check, per evaluation
//      context: P05 §2.2);
//   5. security (literal commands, secretref-only secrets);
//   6. the engine capability gate.
// A schema failure stops validation: later layers need a parsed document.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { COST_REPORTING_PROVIDERS, DEFAULT_COMMAND_ALLOWLIST, ENGINE_LEVEL, MAX_CONTAINER_DEPTH, type EngineLevel } from '../constants.js';
import { MAX_INVOCATION_DEPTH } from '../schemas/invocation.js';
import { walkExpr, type ExprDiagnostic, type ExprNode } from '../expr/ast.js';
import { parseExpression } from '../expr/parse.js';
import { checkTemplate } from '../expr/template.js';
import { checkExpression, type TypeEnv } from '../expr/typecheck.js';
import { T, kindsOf, withoutNull, type ExprType } from '../expr/types.js';
import { compileSafeRegex } from '../regex/safeRegex.js';
import { WorkflowGraphSchema, type WorkflowGraph } from '../schemas/graph.js';
import {
  TimeoutsSchema,
  kindFields,
  stageTemplateFields,
  STAGE_KINDS,
  type LoopStage,
  type MapStage,
  type StageSpec,
  type SubworkflowStage,
  type WorkflowRef,
} from '../schemas/stage.js';
import type { PreprocessingStep } from '../schemas/workflow.js';
import { unwrap } from '../util/zodWalk.js';
import { engineIssues } from './capability.js';
import { analyzeGraph, ancestorsOf, type GraphAnalysis } from './dag.js';
import { unknownFieldHint } from './hints.js';
import { pointerToken, toPointer, type ValidationIssue } from './issues.js';
import { GraphTypes, isContainerKind, preprocessingVariableNames, type ExprPlace } from './scope.js';
import { securityIssues } from './security.js';

export interface ValidateOptions {
  /** Engine whose capabilities gate the document (default: ENGINE_LEVEL). */
  engine?: EngineLevel;
  /**
   * Commands a `check` stage may run (default: DEFAULT_COMMAND_ALLOWLIST).
   * The server passes its effective list (the defaults plus the operator's
   * extras); offline tools keep the default.
   */
  commandAllowlist?: readonly string[];
  /**
   * Resolves a sub-workflow's `workflowRef` (P05 §4.2). With it the
   * validator checks the reference, the child's status, its inputs, the
   * nesting depth and cycles, and types `stages.<sub>.output` from the
   * child's declared outputs. The server pre-resolves the refs of a
   * document (recursively) before validating; offline tools omit it.
   */
  resolveWorkflowRef?: ((ref: WorkflowRef, fromProjectId: string | null) => ResolvedWorkflowRef | undefined) | undefined;
  /** The id of the definition being validated (a sub-workflow cycle through it is an error). */
  definitionId?: string | undefined;
}

/** A resolved sub-workflow reference. */
export interface ResolvedWorkflowRef {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  /** The graph a run would use: the latest published version, else the draft. */
  graph: WorkflowGraph;
  projectId: string | null;
}

export interface ValidationResult {
  /** True when no issue has severity `error`. */
  valid: boolean;
  issues: ValidationIssue[];
  /** The parsed document (defaults applied), when the schema layer passed. */
  graph?: WorkflowGraph;
}

export function validateWorkflow(input: unknown, opts: ValidateOptions = {}): ValidationResult {
  const engine = opts.engine ?? ENGINE_LEVEL;
  const parsed = WorkflowGraphSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, issues: schemaIssues(parsed.error, input) };
  }
  const graph = parsed.data;
  const issues: ValidationIssue[] = [];
  const ctx = new GraphContext(graph, opts.resolveWorkflowRef);
  issues.push(...ctx.dagIssues());
  issues.push(...referenceIssues(graph, ctx, opts));
  issues.push(...expressionIssues(graph, ctx));
  issues.push(...securityIssues(graph));
  issues.push(...engineIssues(graph, engine));
  return { valid: !issues.some((i) => i.severity === 'error'), issues, graph };
}

// ── 1. Schema ────────────────────────────────────────────────────

function stageKeyAt(input: unknown, path: ReadonlyArray<string | number>): string | undefined {
  if (path[0] !== 'stages' || typeof path[1] !== 'number') return undefined;
  const stages = (input as { stages?: unknown })?.stages;
  if (!Array.isArray(stages)) return undefined;
  const key = (stages[path[1]] as { key?: unknown } | undefined)?.key;
  return typeof key === 'string' ? key : undefined;
}

function valueAt(input: unknown, path: ReadonlyArray<string | number>): unknown {
  let v = input;
  for (const p of path) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Record<string | number, unknown>)[p];
  }
  return v;
}

/** The object schema at `path` (resolving discriminated unions from the data), for sibling-key hints. */
function objectKeysAt(root: z.ZodTypeAny, input: unknown, path: ReadonlyArray<string | number>): string[] | undefined {
  let schema: z.ZodTypeAny = root;
  const resolve = (s: z.ZodTypeAny, at: ReadonlyArray<string | number>): z.ZodTypeAny => {
    const u = unwrap(s);
    if (u instanceof z.ZodDiscriminatedUnion) {
      const value = valueAt(input, at) as Record<string, unknown> | undefined;
      const opt = u.optionsMap.get(value?.[u.discriminator] as never);
      return opt ? resolve(opt, at) : u;
    }
    if (u instanceof z.ZodUnion) {
      const obj = (u.options as z.ZodTypeAny[]).map(unwrap).find((o) => o instanceof z.ZodObject);
      return obj ?? u;
    }
    return u;
  };
  schema = resolve(schema, []);
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const at = path.slice(0, i + 1);
    if (schema instanceof z.ZodObject && typeof p === 'string') {
      const next = (schema.shape as Record<string, z.ZodTypeAny>)[p];
      if (!next) return undefined;
      schema = resolve(next, at);
    } else if (schema instanceof z.ZodArray) {
      schema = resolve(schema.element, at);
    } else if (schema instanceof z.ZodRecord) {
      schema = resolve(schema.valueSchema, at);
    } else {
      return undefined;
    }
  }
  return schema instanceof z.ZodObject ? Object.keys(schema.shape) : undefined;
}

/** A field that exists on another stage kind (P05 §1.3): `field-not-applicable`, not a typo. */
function notApplicable(input: unknown, path: ReadonlyArray<string | number>, key: string): string | undefined {
  if (path[0] !== 'stages' || typeof path[1] !== 'number') return undefined;
  const kind = valueAt(input, [...path.slice(0, 2), 'kind']);
  if (typeof kind !== 'string' || !(STAGE_KINDS as readonly string[]).includes(kind)) return undefined;
  if (path.length === 2) {
    const owners = STAGE_KINDS.filter((k) => k !== kind && kindFields(k).includes(key));
    return owners.length > 0 ? `'${key}' does not apply to a ${kind} stage (it is a field of ${owners.join(' and ')} stages)` : undefined;
  }
  if (path.length === 3 && path[2] === 'timeouts' && kind === 'check' && Object.keys(TimeoutsSchema.shape).includes(key)) {
    return `timeouts.${key} does not apply to a check stage: it has only timeouts.queueMs (the command has check.timeoutMs)`;
  }
  return undefined;
}

export function schemaIssues(error: z.ZodError, input: unknown): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const seen = new Set<string>();
  const push = (issue: ValidationIssue) => {
    const k = `${issue.code}|${issue.path}|${issue.message}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(issue);
  };
  for (const zi of error.issues) {
    const stageKey = stageKeyAt(input, zi.path);
    const withStage = stageKey ? { stageKey } : {};
    if (zi.code === z.ZodIssueCode.unrecognized_keys) {
      const siblings = objectKeysAt(WorkflowGraphSchema, input, zi.path);
      for (const key of zi.keys) {
        const na = notApplicable(input, zi.path, key);
        if (na) {
          push({ code: 'field-not-applicable', severity: 'error', path: toPointer([...zi.path, key]), ...withStage, message: na });
          continue;
        }
        const hint = unknownFieldHint(key, siblings);
        push({
          code: 'unknown-field',
          severity: 'error',
          path: toPointer([...zi.path, key]),
          ...withStage,
          message: `Unknown field '${key}'`,
          ...(hint ? { hint } : {}),
        });
      }
      continue;
    }
    if (zi.code === z.ZodIssueCode.custom) {
      const code = (zi.params as { code?: unknown } | undefined)?.code;
      push({
        code: typeof code === 'string' ? code : 'schema',
        severity: 'error',
        path: toPointer(zi.path),
        ...withStage,
        message: zi.message,
      });
      continue;
    }
    let hint: string | undefined;
    if (zi.code === z.ZodIssueCode.invalid_union_discriminator && zi.path[zi.path.length - 1] !== 'kind') {
      hint = `Expected one of: ${zi.options.map(String).join(', ')}`;
    }
    const atKind = zi.path[0] === 'stages' && (zi.path.length === 2 || (zi.path.length === 3 && zi.path[2] === 'kind'));
    if (zi.code === z.ZodIssueCode.invalid_union_discriminator && atKind) {
      hint = `The stage kinds are ${STAGE_KINDS.join(', ')}`;
    }
    if (zi.path.length === 1 && zi.path[0] === 'formatVersion') hint = 'Set "formatVersion": 2';
    push({
      code: 'schema',
      severity: 'error',
      path: toPointer(zi.path),
      ...withStage,
      message: zi.message,
      ...(hint ? { hint } : {}),
    });
  }
  return out;
}

// ── 2. Graph ─────────────────────────────────────────────────────

class GraphContext {
  readonly analysis: GraphAnalysis;
  readonly keys: string[];
  readonly indexByKey = new Map<string, number>();
  readonly acyclic: boolean;
  private readonly ancestors = new Map<string, Set<string>>();
  /** Stage keys by enclosing container ('' = top level). */
  readonly scopes = new Map<string, string[]>();
  readonly types: GraphTypes;

  constructor(
    readonly graph: WorkflowGraph,
    readonly resolveRef?: ValidateOptions['resolveWorkflowRef'],
  ) {
    graph.stages.forEach((s, i) => {
      if (!this.indexByKey.has(s.key)) this.indexByKey.set(s.key, i);
    });
    this.keys = [...this.indexByKey.keys()];
    for (const key of this.keys) {
      const scope = this.stage(key)!.parentKey ?? '';
      const list = this.scopes.get(scope) ?? [];
      list.push(key);
      this.scopes.set(scope, list);
    }
    const edges = graph.edges.filter((e) => e.from !== e.to && this.indexByKey.has(e.from) && this.indexByKey.has(e.to) && this.sameScope(e.from, e.to));
    this.analysis = analyzeGraph(this.keys, edges);
    this.acyclic = this.analysis.unordered.length === 0;
    this.types = new GraphTypes({
      graph,
      upstream: (key) => this.upstream(key),
      extraVariables: preprocessingVariableNames(graph.workflow.lifecycle.preprocessingSteps),
      childOutputType: (stage) => (stage.kind === 'subworkflow' ? this.childOutputType(stage) : undefined),
    });
  }

  /** The resolved child of a sub-workflow stage, when a resolver is given and knows it. */
  child(stage: SubworkflowStage): ResolvedWorkflowRef | undefined {
    return this.resolveRef?.(stage.subworkflow.workflowRef, this.graph.workflow.projectId ?? null);
  }

  /** `stages.<sub>.output`: the child's declared outputs, typed in the child's own graph. */
  private childOutputType(stage: SubworkflowStage): ExprType | undefined {
    const child = this.child(stage);
    if (!child) return undefined;
    const outputs = child.graph.workflow.outputs ?? {};
    // The child's own sub-workflows are not resolved again: their outputs read as any.
    const env = new GraphContext(child.graph).types.env({ kind: 'workflow' });
    const fields: Record<string, ExprType> = {};
    for (const [name, src] of Object.entries(outputs)) fields[name] = checkExpression(src, env).type;
    return T.object(fields);
  }

  sameScope(a: string, b: string): boolean {
    return (this.stage(a)?.parentKey ?? '') === (this.stage(b)?.parentKey ?? '');
  }

  /**
   * Stages that always run before `key`: its ancestors in its own scope and,
   * for a body stage, everything upstream of its container (never the
   * container itself). With a cycle, every other stage of the scope (to
   * avoid cascading errors).
   */
  upstream(key: string): Set<string> {
    let a = this.ancestors.get(key);
    if (!a) {
      a = new Set<string>();
      this.ancestors.set(key, a); // a parent cycle stops here
      const scope = this.scopes.get(this.stage(key)?.parentKey ?? '') ?? [];
      const own = this.acyclic ? ancestorsOf(key, this.analysis) : new Set(scope.filter((k) => k !== key));
      for (const k of own) a.add(k);
      const parent = this.stage(key)?.parentKey;
      if (parent !== undefined && this.stage(parent)) for (const k of this.upstream(parent)) a.add(k);
    }
    return a;
  }

  stage(key: string): StageSpec | undefined {
    const i = this.indexByKey.get(key);
    return i === undefined ? undefined : this.graph.stages[i];
  }

  /** Number of enclosing containers, or -1 when the parent chain loops. */
  depth(key: string): number {
    const seen = new Set<string>([key]);
    let d = 0;
    let p = this.stage(key)?.parentKey;
    while (p !== undefined) {
      if (seen.has(p)) return -1;
      seen.add(p);
      d += 1;
      p = this.stage(p)?.parentKey;
    }
    return d;
  }

  dagIssues(): ValidationIssue[] {
    const { graph } = this;
    const out: ValidationIssue[] = [];
    if (graph.stages.length === 0) {
      out.push({ code: 'empty-graph', severity: 'warning', path: '/stages', message: 'The workflow has no stages' });
    }
    graph.stages.forEach((s, i) => {
      if (this.indexByKey.get(s.key) !== i) {
        out.push({
          code: 'duplicate-key',
          severity: 'error',
          path: `/stages/${i}/key`,
          stageKey: s.key,
          message: `Stage key '${s.key}' is used by more than one stage`,
          hint: 'Keys identify stages in edges, context sources and expressions; make each unique',
        });
      }
      if (s.parentKey !== undefined) {
        const parent = this.stage(s.parentKey);
        if (!parent) {
          out.push({
            code: 'unknown-parent',
            severity: 'error',
            path: `/stages/${i}/parentKey`,
            stageKey: s.key,
            message: `parentKey '${s.parentKey}' is not a stage`,
          });
        } else if (!isContainerKind(parent.kind)) {
          out.push({
            code: 'parent-not-container',
            severity: 'error',
            path: `/stages/${i}/parentKey`,
            stageKey: s.key,
            message: `Stage '${s.parentKey}' is a${parent.kind === 'agent' ? 'n' : ''} ${parent.kind} stage and cannot contain other stages`,
            hint: 'Only container stages (loop, map) have a body; a sub-workflow runs another workflow',
          });
        } else {
          const d = this.depth(s.key);
          if (d < 0 || d > MAX_CONTAINER_DEPTH) {
            out.push({
              code: 'nesting-too-deep',
              severity: 'error',
              path: `/stages/${i}/parentKey`,
              stageKey: s.key,
              message: d < 0 ? `The parentKey chain of '${s.key}' loops back on itself` : `'${s.key}' is nested ${d} containers deep; at most ${MAX_CONTAINER_DEPTH} are allowed`,
            });
          }
        }
      }
      if (isContainerKind(s.kind) && this.indexByKey.get(s.key) === i && (this.scopes.get(s.key)?.length ?? 0) === 0) {
        out.push({
          code: 'empty-body',
          severity: 'error',
          path: `/stages/${i}`,
          stageKey: s.key,
          message: `The ${s.kind} '${s.key}' has no body: no stage has parentKey '${s.key}'`,
          hint: s.kind === 'map' ? 'Give the stages to run per item parentKey set to this key' : 'Give the stages to repeat parentKey set to this key',
        });
      }
    });
    const pairs = new Set<string>();
    graph.edges.forEach((e, i) => {
      const p = `/edges/${i}`;
      if (e.from === e.to) {
        out.push({ code: 'self-edge', severity: 'error', path: p, stageKey: e.from, message: `Edge from '${e.from}' to itself` });
      }
      if (!this.indexByKey.has(e.from)) {
        out.push({ code: 'unknown-edge-source', severity: 'error', path: `${p}/from`, message: `Edge source '${e.from}' is not a stage key` });
      }
      if (!this.indexByKey.has(e.to)) {
        out.push({ code: 'unknown-edge-target', severity: 'error', path: `${p}/to`, message: `Edge target '${e.to}' is not a stage key` });
      }
      if (this.indexByKey.has(e.from) && this.indexByKey.has(e.to) && !this.sameScope(e.from, e.to)) {
        const scopeOf = (k: string) => (this.stage(k)?.parentKey ? `the body of '${this.stage(k)!.parentKey}'` : 'the top level');
        out.push({
          code: 'edge-crosses-scope',
          severity: 'error',
          path: p,
          stageKey: e.to,
          message: `The edge '${e.from}' → '${e.to}' crosses a scope: '${e.from}' is in ${scopeOf(e.from)}, '${e.to}' in ${scopeOf(e.to)}`,
          hint: 'Connect outer stages to the container itself; body stages connect only to stages of the same body',
        });
      }
      const pair = `${e.from}\u0000${e.to}`;
      if (pairs.has(pair)) {
        out.push({
          code: 'edge-pair',
          severity: 'error',
          path: p,
          stageKey: e.to,
          message: `More than one edge from '${e.from}' to '${e.to}'`,
          hint: 'Keep one edge per pair: use on: completion or always to fire on several outcomes',
        });
      }
      pairs.add(pair);
    });
    if (!this.acyclic) {
      // Edges never cross a scope here (those are excluded above), so each cycle lies in one scope.
      const unordered = new Set(this.analysis.unordered);
      const onCycle = this.analysis.unordered.filter((n) => reaches(n, n, this.analysis, unordered));
      const byScope = new Map<string, string[]>();
      for (const n of onCycle) {
        const s = this.stage(n)?.parentKey ?? '';
        byScope.set(s, [...(byScope.get(s) ?? []), n]);
      }
      for (const [scope, nodes] of byScope) {
        out.push({
          code: 'cycle',
          severity: 'error',
          path: '/edges',
          ...(nodes[0] ? { stageKey: nodes[0] } : {}),
          message: `The edges ${scope ? `in the body of '${scope}' ` : ''}form a cycle through: ${nodes.join(', ')}`,
          hint: 'A workflow graph is acyclic; repeat work with a loop stage instead',
        });
      }
    }
    return out;
  }
}

function reaches(from: string, target: string, a: GraphAnalysis, within: ReadonlySet<string>): boolean {
  const seen = new Set<string>();
  const stack = [...(a.successors.get(from) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === target) return true;
    if (seen.has(n) || !within.has(n)) continue;
    seen.add(n);
    stack.push(...(a.successors.get(n) ?? []));
  }
  return false;
}

// ── 3. References ────────────────────────────────────────────────

function isUsableJsonSchema(schema: Record<string, unknown>): boolean {
  const types = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
  const t = schema['type'];
  if (t !== undefined) {
    const list = Array.isArray(t) ? t : [t];
    if (list.length === 0 || !list.every((x) => typeof x === 'string' && types.includes(x))) return false;
  }
  const props = schema['properties'];
  if (props !== undefined && (typeof props !== 'object' || props === null || Array.isArray(props))) return false;
  const req = schema['required'];
  if (req !== undefined && (!Array.isArray(req) || !req.every((r) => typeof r === 'string'))) return false;
  return true;
}

function regexIssue(pattern: string, flags: string | undefined, path: string, stageKey?: string): ValidationIssue | null {
  const r = compileSafeRegex(pattern, flags ?? '');
  if (r.ok) return null;
  return {
    code: 'invalid-regex',
    severity: 'error',
    path,
    ...(stageKey ? { stageKey } : {}),
    message: `Invalid pattern: ${r.error.message}`,
    hint: 'Patterns run on a linear-time engine: no backreferences or lookaround',
  };
}

function duplicateIds(list: ReadonlyArray<{ id: string }>, pointer: string, stageKey?: string): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  list.forEach((h, i) => {
    if (seen.has(h.id)) {
      out.push({
        code: 'duplicate-hook-id',
        severity: 'error',
        path: `${pointer}/${i}/id`,
        ...(stageKey ? { stageKey } : {}),
        message: `Hook id '${h.id}' is used twice`,
      });
    }
    seen.add(h.id);
  });
  return out;
}

/** Whether a variable default matches its declared type. */
function defaultMatches(type: string, d: unknown, options: readonly string[] | undefined): boolean {
  switch (type) {
    case 'number':
      return typeof d === 'number' && Number.isFinite(d);
    case 'boolean':
      return typeof d === 'boolean';
    case 'choice':
      return typeof d === 'string' && (!options || options.includes(d));
    case 'list':
      return Array.isArray(d) && d.every((x) => typeof x === 'string');
    case 'json':
      return true;
    default:
      return typeof d === 'string';
  }
}

/** Whether the stage sits (at any depth) inside a loop body. */
function insideLoop(ctx: GraphContext, key: string): boolean {
  return ctx.types.containersOf(key).some((c) => c.kind === 'loop');
}

/** The provider a stage's session resolves to, when the document names one. */
function providerOf(graph: WorkflowGraph, stage: StageSpec): string | undefined {
  if (stage.kind !== 'agent') return undefined;
  return stage.session?.harnessType ?? graph.workflow.session.harnessType;
}

function referenceIssues(graph: WorkflowGraph, ctx: GraphContext, opts: ValidateOptions): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const wf = graph.workflow;

  const names = new Set<string>();
  wf.variables.forEach((v, i) => {
    const p = `/workflow/variables/${i}`;
    if (names.has(v.name)) {
      out.push({ code: 'duplicate-variable', severity: 'error', path: `${p}/name`, message: `Variable '${v.name}' is declared twice` });
    }
    names.add(v.name);
    if (v.type === 'choice' && !v.options?.length) {
      out.push({ code: 'choice-without-options', severity: 'error', path: `${p}/options`, message: `Choice variable '${v.name}' has no options` });
    }
    if (v.type !== 'choice' && v.options !== undefined) {
      out.push({ code: 'options-without-choice', severity: 'warning', path: `${p}/options`, message: `options are ignored on a ${v.type} variable` });
    }
    if (v.defaultValue !== undefined && !defaultMatches(v.type, v.defaultValue, v.options)) {
      out.push({
        code: 'variable-default-type',
        severity: 'error',
        path: `${p}/defaultValue`,
        message: `The default of '${v.name}' does not match its type ${v.type}${v.type === 'choice' ? ' (or is not an option)' : v.type === 'list' ? ' (a list of strings)' : ''}`,
      });
    }
  });

  out.push(...duplicateIds(wf.hooks, '/workflow/hooks'));
  for (const name of Object.keys(wf.outputs ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      out.push({ code: 'invalid-output-name', severity: 'error', path: `/workflow/outputs/${pointerToken(name)}`, message: `Output name '${name}' is not an identifier` });
    }
  }

  const aliases = new Set(wf.lifecycle.codebaseAliases);
  const aliasCheck = (alias: string | undefined, path: string, stageKey?: string) => {
    if (alias !== undefined && aliases.size > 0 && !aliases.has(alias)) {
      out.push({
        code: 'unknown-codebase-alias',
        severity: 'warning',
        path,
        ...(stageKey ? { stageKey } : {}),
        message: `Codebase alias '${alias}' is not in lifecycle.codebaseAliases`,
      });
    }
  };
  const declared = new Set([...names, ...preprocessingVariableNames(wf.lifecycle.preprocessingSteps)]);
  const visitPre = (steps: readonly PreprocessingStep[], pointer: string) =>
    steps.forEach((s, i) => {
      const p = `${pointer}/${i}/config`;
      const c = s.config;
      if (c.type === 'clone_repo') aliasCheck(c.repoAlias, `${p}/repoAlias`);
      if (c.type === 'validate_input') {
        if (!declared.has(c.variableName)) {
          out.push({ code: 'unknown-input-variable', severity: 'warning', path: `${p}/variableName`, message: `'${c.variableName}' is not a declared variable` });
        }
        c.rules.forEach((r, j) => {
          if (r.type !== 'regex') return;
          const issue = regexIssue(r.pattern, r.flags, `${p}/rules/${j}/pattern`);
          if (issue) out.push(issue);
        });
      }
      if (c.type === 'conditional') {
        visitPre(c.thenSteps, `${p}/thenSteps`);
        visitPre(c.elseSteps ?? [], `${p}/elseSteps`);
      }
    });
  visitPre(wf.lifecycle.preprocessingSteps, '/workflow/lifecycle/preprocessingSteps');
  wf.lifecycle.postProcessing.steps.forEach((s, i) => {
    if (s.config.type !== 'run_script') aliasCheck(s.config.repoAlias, `/workflow/lifecycle/postProcessing/steps/${i}/config/repoAlias`);
  });

  const allowlist = new Set((opts.commandAllowlist ?? DEFAULT_COMMAND_ALLOWLIST).map((c) => c.toLowerCase()));
  const commandCheck = (command: string, path: string, stageKey: string) => {
    if (allowlist.has(command.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, ''))) return;
    out.push({
      code: 'check-command',
      severity: 'error',
      path,
      stageKey,
      message: `'${command}' is not on the command allow-list`,
      hint: `Allowed: ${[...allowlist].sort().join(', ')} (an operator can add commands to scripts.extraAllowlist)`,
    });
  };
  const costWarned = new Set<string>();
  const budgetCost = (pointer: string, stageKey: string | undefined, stages: readonly StageSpec[]) => {
    const blind = [...new Set(stages.map((s) => providerOf(graph, s)).filter((p): p is string => !!p && !(COST_REPORTING_PROVIDERS as readonly string[]).includes(p)))];
    if (blind.length === 0 || costWarned.has(pointer)) return;
    costWarned.add(pointer);
    out.push({
      code: 'budget-cost-unsupported',
      severity: 'warning',
      path: pointer,
      ...(stageKey ? { stageKey } : {}),
      message: `maxCostUsd cannot fire for stages on ${blind.join(', ')}: the provider reports no cost`,
      hint: 'Bound the spend with maxTurns or maxTokens',
    });
  };
  if (wf.budget?.maxCostUsd !== undefined) budgetCost('/workflow/budget/maxCostUsd', undefined, graph.stages);

  graph.stages.forEach((s, i) => {
    const p = `/stages/${i}`;
    const k = s.key;
    const preds = ctx.analysis.predecessors.get(k)?.length ?? 0;
    if (s.join.mode === 'n_of_m' && s.join.n > preds) {
      out.push({
        code: 'join-n-exceeds-predecessors',
        severity: 'error',
        path: `${p}/join/n`,
        stageKey: k,
        message: `The join needs ${s.join.n} predecessors but '${k}' has ${preds}`,
      });
    } else if (s.join.mode !== 'all' && preds <= 1) {
      out.push({ code: 'join-single-predecessor', severity: 'warning', path: `${p}/join`, stageKey: k, message: `A ${s.join.mode} join on a stage with ${preds} predecessor(s) has no effect` });
    }
    if ((s.kind === 'agent' || s.kind === 'check') && s.retry && s.retry.maxDelayMs < s.retry.initialDelayMs) {
      out.push({ code: 'retry-delay-bounds', severity: 'warning', path: `${p}/retry/maxDelayMs`, stageKey: k, message: 'maxDelayMs is below initialDelayMs, so every delay is maxDelayMs' });
    }

    if (s.kind === 'agent') {
      if (s.prompts.length === 0 && !s.session?.agentRef) {
        out.push({
          code: 'stage-without-prompts',
          severity: 'warning',
          path: `${p}/prompts`,
          stageKey: k,
          message: `Stage '${k}' has no prompts and no agent: it has nothing to do`,
        });
      }
      s.context.from?.forEach((from, j) => {
        const path = `${p}/context/from/${j}`;
        if (!ctx.indexByKey.has(from)) {
          out.push({ code: 'unknown-context-source', severity: 'error', path, stageKey: k, message: `context.from names '${from}', which is not a stage key` });
        } else if (from === k || !ctx.upstream(k).has(from)) {
          out.push({
            code: 'context-source-not-upstream',
            severity: 'error',
            path,
            stageKey: k,
            message: `Stage '${from}' does not run before '${k}', so its output cannot be context here`,
            hint: 'Add an edge path from the source stage to this stage',
          });
        }
      });
      if (s.output.schema !== undefined) {
        if (s.output.format !== 'json') {
          out.push({ code: 'schema-requires-json', severity: 'error', path: `${p}/output/schema`, stageKey: k, message: 'output.schema needs output.format json' });
        }
        if (!isUsableJsonSchema(s.output.schema)) {
          out.push({ code: 'invalid-output-schema', severity: 'error', path: `${p}/output/schema`, stageKey: k, message: 'output.schema is not a valid JSON Schema object' });
        }
      } else if (s.output.format === 'json') {
        out.push({
          code: 'json-without-schema',
          severity: 'warning',
          path: `${p}/output`,
          stageKey: k,
          message: 'A json output without a schema: expressions cannot check its fields',
          hint: 'Add output.schema',
        });
      }
      s.output.rules.forEach((r, j) => {
        if (r.type === 'regex') {
          const issue = regexIssue(r.pattern, r.flags, `${p}/output/rules/${j}/pattern`, k);
          if (issue) out.push(issue);
        } else if (r.type === 'json_schema' && !isUsableJsonSchema(r.schema)) {
          out.push({ code: 'invalid-output-schema', severity: 'error', path: `${p}/output/rules/${j}/schema`, stageKey: k, message: 'The rule schema is not a valid JSON Schema object' });
        }
      });
      out.push(...duplicateIds(s.hooks, `${p}/hooks`, k));
      const loopBody = insideLoop(ctx, k);
      if (s.sessionReuse === 'continue' && !loopBody) {
        out.push({
          code: 'session-continue-outside-loop',
          severity: 'warning',
          path: `${p}/sessionReuse`,
          stageKey: k,
          message: 'sessionReuse continue only has an effect inside a loop body',
        });
      }
      if (s.compactAfter !== undefined && s.sessionReuse !== 'continue') {
        out.push({
          code: 'compact-without-continue',
          severity: 'error',
          path: `${p}/compactAfter`,
          stageKey: k,
          message: 'compactAfter compacts a continuing conversation: it needs sessionReuse continue',
        });
      }
      if (s.followUpPrompts !== undefined && !loopBody) {
        out.push({
          code: 'follow-up-outside-loop',
          severity: 'warning',
          path: `${p}/followUpPrompts`,
          stageKey: k,
          message: 'followUpPrompts are only used from the second iteration of a loop',
        });
      }
      if (s.budget?.maxCostUsd !== undefined) budgetCost(`${p}/budget/maxCostUsd`, k, [s]);
    }

    if (s.kind === 'check') {
      commandCheck(s.check.command, `${p}/check/command`, k);
      aliasCheck(s.check.mount, `${p}/check/mount`, k);
    }

    if (s.kind === 'loop') out.push(...loopIssues(ctx, s, p, budgetCost));
    if (s.kind === 'map') {
      s.map.itemSetup?.forEach((c, j) => {
        commandCheck(c.command, `${p}/map/itemSetup/${j}/command`, k);
        aliasCheck(c.mount, `${p}/map/itemSetup/${j}/mount`, k);
      });
      out.push(...mapIssues(ctx, s, p, budgetCost));
    }
    if (s.kind === 'wait' && s.wait.type === 'approval' && s.wait.form !== undefined && !isUsableJsonSchema(s.wait.form)) {
      out.push({ code: 'wait-form', severity: 'error', path: `${p}/wait/form`, stageKey: k, message: 'wait.form is not a usable JSON Schema object' });
    }
    if (s.kind === 'subworkflow' && ctx.resolveRef) out.push(...subworkflowIssues(ctx, s, p, opts.definitionId));
  });

  graph.edges.forEach((e, i) => {
    if (e.handlesFailure && (e.on === 'failure')) {
      out.push({ code: 'handles-failure-redundant', severity: 'warning', path: `/edges/${i}/handlesFailure`, message: 'A failure edge already handles failures' });
    }
  });
  return out;
}

/** The loop's own settings: exits, wrap-up, output names, budget. */
function loopIssues(
  ctx: GraphContext,
  s: LoopStage,
  p: string,
  budgetCost: (pointer: string, stageKey: string | undefined, stages: readonly StageSpec[]) => void,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const k = s.key;
  const spec = s.loop;
  const body = ctx.types.body(k);
  if (spec.exits.length === 0) {
    out.push({
      code: 'loop-no-exit',
      severity: 'warning',
      path: `${p}/loop/exits`,
      stageKey: k,
      message: `The loop '${k}' has no exit rule: it always runs ${spec.maxIterations} iteration(s), then applies onLimit (${spec.onLimit.mode})`,
      hint: 'Add an Until rule (action complete)',
    });
  }
  spec.exits.forEach((rule, j) => {
    if (rule.consecutive > spec.maxIterations) {
      out.push({
        code: 'exit-unreachable',
        severity: 'warning',
        path: `${p}/loop/exits/${j}/consecutive`,
        stageKey: k,
        message: `The rule '${rule.reason}' needs ${rule.consecutive} iterations in a row, but the loop runs at most ${spec.maxIterations}`,
      });
    }
    const parsed = parseExpression(rule.when);
    if (parsed.ok && !readsIteration(parsed.ast, new Set(body))) {
      out.push({
        code: 'exit-unbound',
        severity: 'error',
        path: `${p}/loop/exits/${j}/when`,
        stageKey: k,
        message: `The rule '${rule.reason}' reads nothing that changes between iterations, so it can never change its value`,
        hint: 'Read a body stage (stages.<bodyKey>) or loop.carry, loop.priorCarry, loop.last, loop.previous, loop.history, loop.usage or loop.iteration',
      });
    }
  });
  if (spec.wrapUp) {
    const target = ctx.stage(spec.wrapUp.stage);
    const problem = !target
      ? `'${spec.wrapUp.stage}' is not a stage`
      : target.parentKey !== k
        ? `'${spec.wrapUp.stage}' is not in the body of '${k}'`
        : target.kind !== 'agent'
          ? `'${spec.wrapUp.stage}' is a ${target.kind} stage, not an agent`
          : target.sessionReuse !== 'continue'
            ? `'${spec.wrapUp.stage}' does not continue its conversation (sessionReuse fresh): the wrap-up would start from nothing`
            : undefined;
    if (problem) {
      out.push({
        code: 'wrapup-stage',
        severity: 'error',
        path: `${p}/loop/wrapUp/stage`,
        stageKey: k,
        message: `The wrap-up stage ${problem}`,
        hint: 'Name a body agent stage with sessionReuse continue',
      });
    }
    if (s.budget?.maxCostUsd === undefined && s.budget?.maxTurns === undefined && s.budget?.maxTokens === undefined && s.budget?.maxWallClockMs === undefined) {
      out.push({
        code: 'wrapup-stage',
        severity: 'warning',
        path: `${p}/loop/wrapUp`,
        stageKey: k,
        message: 'A wrap-up runs when the loop budget is exhausted, but the loop has no budget',
      });
    }
  }
  const builtIn = new Set(['iterations', 'exitReason', 'exitAction', 'last', 'wrapUp', 'carry', 'history']);
  for (const name of Object.keys(spec.output.select ?? {})) {
    if (builtIn.has(name)) {
      out.push({
        code: 'invalid-output-name',
        severity: 'error',
        path: `${p}/loop/output/select/${pointerToken(name)}`,
        stageKey: k,
        message: `'${name}' is a field of every loop output; pick another name`,
      });
    }
  }
  ctx.types.carryTypes(s); // infers the carried types and records their issues
  for (const issue of ctx.types.carryIssues.get(k) ?? []) {
    out.push({ code: 'carry-type', severity: 'error', path: `${p}/loop/carry/${pointerToken(issue.name)}`, stageKey: k, message: issue.message });
  }
  if (s.budget?.maxCostUsd !== undefined) {
    const bodyStages: StageSpec[] = [];
    const visit = (key: string) => {
      for (const c of ctx.types.body(key)) {
        const st = ctx.stage(c);
        if (!st) continue;
        bodyStages.push(st);
        visit(c);
      }
    };
    visit(k);
    budgetCost(`${p}/budget/maxCostUsd`, k, bodyStages);
  }
  return out;
}

/** Every body stage of a container, at any depth. */
function bodyStages(ctx: GraphContext, key: string): StageSpec[] {
  const out: StageSpec[] = [];
  const visit = (k: string) => {
    for (const c of ctx.types.body(k)) {
      const st = ctx.stage(c);
      if (!st) continue;
      out.push(st);
      visit(c);
    }
  };
  visit(key);
  return out;
}

/** A map's own settings: merges and setup need item mounts, shared parallel writers, output names, budget. */
function mapIssues(
  ctx: GraphContext,
  s: MapStage,
  p: string,
  budgetCost: (pointer: string, stageKey: string | undefined, stages: readonly StageSpec[]) => void,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const k = s.key;
  const spec = s.map;
  if (spec.merge !== 'none' && spec.workspace !== 'mount_per_item') {
    out.push({
      code: 'map-merge-needs-mount',
      severity: 'error',
      path: `${p}/map/merge`,
      stageKey: k,
      message: `merge ${spec.merge} brings item mounts back: it needs workspace mount_per_item`,
      hint: 'Set workspace to mount_per_item, or merge to none',
    });
  }
  if (spec.itemSetup?.length && spec.workspace !== 'mount_per_item') {
    out.push({
      code: 'map-item-setup-needs-mount',
      severity: 'error',
      path: `${p}/map/itemSetup`,
      stageKey: k,
      message: 'itemSetup runs in each item mount: it needs workspace mount_per_item',
    });
  }
  if (spec.workspace === 'shared' && spec.concurrency > 1) {
    // Only a save-time warning: an agent's tool groups resolve at run time
    // (the invocation re-checks them against the agent snapshots).
    const writers = bodyStages(ctx, k).filter((b) => b.kind === 'check' || (b.kind === 'agent' && b.session?.permissionMode !== 'plan'));
    if (writers.length > 0) {
      out.push({
        code: 'map-shared-write-concurrency',
        severity: 'warning',
        path: `${p}/map/concurrency`,
        stageKey: k,
        message: `${spec.concurrency} items run at once in one shared workspace, and '${writers[0]!.key}' may write to it`,
        hint: 'Use workspace mount_per_item, concurrency 1, or read-only body agents (session permissionMode plan)',
      });
    }
  }
  const builtIn = new Set(['index', 'key', 'item', 'status', 'error', 'stages', 'pr']);
  for (const name of Object.keys(spec.output.select ?? {})) {
    if (builtIn.has(name)) {
      out.push({
        code: 'invalid-output-name',
        severity: 'error',
        path: `${p}/map/output/select/${pointerToken(name)}`,
        stageKey: k,
        message: `'${name}' is a field of every map result entry; pick another name`,
      });
    }
  }
  if (s.budget?.maxCostUsd !== undefined) budgetCost(`${p}/budget/maxCostUsd`, k, bodyStages(ctx, k));
  return out;
}

/** A sub-workflow's reference (with a resolver): it exists, is published, takes these inputs, nests at most 3 deep, no cycle. */
function subworkflowIssues(ctx: GraphContext, s: SubworkflowStage, p: string, selfId: string | undefined): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const k = s.key;
  const ref = s.subworkflow.workflowRef;
  const label = 'id' in ref ? `id '${ref.id}'` : `'${ref.name}'`;
  const child = ctx.child(s);
  if (!child || child.status === 'archived') {
    // A missing child is a warning while drafting (publish and invoke refuse it); an archived one is an error.
    out.push({
      code: 'subworkflow-ref',
      severity: child ? 'error' : 'warning',
      path: `${p}/subworkflow/workflowRef`,
      stageKey: k,
      message: child ? `The workflow ${label} is archived` : `No workflow ${label} exists`,
    });
    return out;
  }
  if (child.status === 'draft') {
    out.push({
      code: 'subworkflow-draft',
      severity: 'warning',
      path: `${p}/subworkflow/workflowRef`,
      stageKey: k,
      message: `The workflow ${label} is a draft: publish it before this workflow is published or run`,
    });
  }
  const vars = new Map(child.graph.workflow.variables.map((v) => [v.name, v]));
  for (const name of Object.keys(s.subworkflow.inputs)) {
    if (!vars.has(name)) {
      out.push({
        code: 'subworkflow-input',
        severity: 'error',
        path: `${p}/subworkflow/inputs/${pointerToken(name)}`,
        stageKey: k,
        message: `The workflow ${label} has no variable '${name}'`,
        hint: `Its variables: ${[...vars.keys()].join(', ') || 'none'}`,
      });
    }
  }
  for (const v of vars.values()) {
    if (v.required && v.defaultValue === undefined && s.subworkflow.inputs[v.name] === undefined) {
      out.push({
        code: 'subworkflow-input',
        severity: 'error',
        path: `${p}/subworkflow/inputs`,
        stageKey: k,
        message: `The workflow ${label} needs its variable '${v.name}'`,
      });
    }
  }
  // Depth and cycles over the chain of children (the root run is depth 0).
  const stack = [...(selfId ? [selfId] : []), child.id];
  let problem: { code: 'subworkflow-depth' | 'subworkflow-cycle'; message: string } | undefined;
  const walk = (graph: WorkflowGraph, depth: number): void => {
    if (problem) return;
    if (depth > MAX_INVOCATION_DEPTH) {
      problem = { code: 'subworkflow-depth', message: `Sub-workflows nest more than ${MAX_INVOCATION_DEPTH} deep through ${label}` };
      return;
    }
    for (const st of graph.stages) {
      if (st.kind !== 'subworkflow') continue;
      const next = ctx.resolveRef?.(st.subworkflow.workflowRef, graph.workflow.projectId ?? null);
      if (!next) continue;
      if (stack.includes(next.id)) {
        problem = { code: 'subworkflow-cycle', message: `Sub-workflows form a cycle through '${next.name}'` };
        return;
      }
      stack.push(next.id);
      walk(next.graph, depth + 1);
      stack.pop();
    }
  };
  if (selfId !== undefined && child.id === selfId) problem = { code: 'subworkflow-cycle', message: 'A workflow cannot run itself as a sub-workflow' };
  else walk(child.graph, 2);
  if (problem) out.push({ ...problem, severity: 'error', path: `${p}/subworkflow/workflowRef`, stageKey: k });
  return out;
}

const ITERATION_LOOP_FIELDS = new Set(['carry', 'priorCarry', 'last', 'previous', 'history', 'usage', 'iteration', 'number', 'remaining']);

/** Whether an exit expression reads a per-iteration path: a body stage or a changing loop field (P5-30). */
function readsIteration(ast: ExprNode, bodyKeys: ReadonlySet<string>): boolean {
  let found = false;
  walkExpr(ast, (n) => {
    if (found || n.type !== 'member') return;
    const obj = n.object;
    if (obj.type !== 'ident') return;
    if (obj.name === 'stages' && bodyKeys.has(n.property)) found = true;
    if (obj.name === 'loop' && ITERATION_LOOP_FIELDS.has(n.property)) found = true;
  });
  return found;
}

// ── 4. Expressions and templates ─────────────────────────────────

function located(src: string, d: ExprDiagnostic): string {
  if (src.length <= 60 || d.start >= src.length) return d.message;
  return `${d.message} (at character ${d.start + 1})`;
}

function expressionIssues(graph: WorkflowGraph, ctx: GraphContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const types = ctx.types;
  const envCache = new Map<string, TypeEnv>();
  const env = (place: ExprPlace): TypeEnv => {
    const key = JSON.stringify(place);
    let e = envCache.get(key);
    if (!e) {
      e = types.env(place);
      envCache.set(key, e);
    }
    return e;
  };
  const extra = preprocessingVariableNames(graph.workflow.lifecycle.preprocessingSteps);
  const varNames = new Set([...graph.workflow.variables.map((v) => v.name), ...extra]);

  const report = (src: string, diags: ExprDiagnostic[], path: string, stageKey?: string) => {
    for (const d of diags) {
      out.push({
        code: d.code,
        severity: 'error',
        path,
        ...(stageKey ? { stageKey } : {}),
        message: located(src, d),
        ...(d.hint ? { hint: d.hint } : {}),
      });
    }
  };
  const expr = (src: string, e: TypeEnv, path: string, expect: 'boolean' | 'any' | 'number' | 'list' | 'scalar', stageKey?: string) => {
    const r = checkExpression(src, e, { expect: expect === 'boolean' ? 'boolean' : 'any' });
    report(src, r.diagnostics, path, stageKey);
    if (r.diagnostics.length > 0 || r.type.kind === 'any') return;
    const kinds = kindsOf(withoutNull(r.type));
    const bad =
      expect === 'number'
        ? kinds.has('number')
          ? null
          : 'A score must be a number'
        : expect === 'list'
          ? kinds.has('list')
            ? null
            : 'A map fans out over a list: items must be a list'
          : expect === 'scalar'
            ? kinds.has('string') || kinds.has('number')
              ? null
              : 'A key must be a string (or a number)'
            : null;
    if (bad) out.push({ code: 'expr-type', severity: 'error', path, ...(stageKey ? { stageKey } : {}), message: bad });
  };
  const template = (src: string | undefined, e: TypeEnv, path: string, stageKey?: string) => {
    if (src === undefined || !src.includes('{{')) return;
    report(src, checkTemplate(src, e, { variableNames: varNames }), path, stageKey);
  };
  type Hookish = { config: { type: string; env?: Record<string, string>; headers?: Record<string, string>; bodyTemplate?: string; url?: string; cwd?: string } };
  const hookTemplates = (list: ReadonlyArray<Hookish> | undefined, e: TypeEnv, pointer: string, stageKey?: string) =>
    list?.forEach((h, i) => {
      const c = h.config;
      const p = `${pointer}/${i}/config`;
      for (const [name, v] of Object.entries(c.env ?? {})) template(v, e, `${p}/env/${pointerToken(name)}`, stageKey);
      for (const [name, v] of Object.entries(c.headers ?? {})) template(v, e, `${p}/headers/${pointerToken(name)}`, stageKey);
      template(c.bodyTemplate, e, `${p}/bodyTemplate`, stageKey);
      template(c.url, e, `${p}/url`, stageKey);
      template(c.cwd, e, `${p}/cwd`, stageKey);
    });

  graph.stages.forEach((s, i) => {
    if (ctx.indexByKey.get(s.key) !== i) return; // a duplicate key: reported by the graph layer
    const p = `/stages/${i}`;
    const stageEnv = env({ kind: 'stage', key: s.key });
    if (s.guard !== undefined) expr(s.guard, stageEnv, `${p}/guard`, 'boolean', s.key);
    // A loop's wrap-up prompt is sent inside its body (context T of its wrap-up stage);
    // a map's item setup runs per item (`item` bound).
    const templateEnv =
      s.kind === 'loop' && s.loop.wrapUp
        ? env({ kind: 'stage', key: s.loop.wrapUp.stage })
        : s.kind === 'map'
          ? env({ kind: 'map', key: s.key, context: 'item' })
          : stageEnv;
    for (const f of stageTemplateFields(s)) template(f.text, templateEnv, `${p}${f.pointer}`, s.key);
    const selfEnv = env({ kind: 'stage', key: s.key, self: true });
    hookTemplates(s.compensate as ReadonlyArray<Hookish> | undefined, selfEnv, `${p}/compensate`, s.key);
    if (s.kind === 'agent') {
      hookTemplates(s.hooks, stageEnv, `${p}/hooks`, s.key);
      s.output.rules.forEach((r, j) => {
        if (r.type !== 'custom_script') return;
        for (const [name, v] of Object.entries(r.env ?? {})) template(v, selfEnv, `${p}/output/rules/${j}/env/${pointerToken(name)}`, s.key);
      });
    }
    if (s.kind === 'loop') {
      const lp = `${p}/loop`;
      const e = env({ kind: 'loop', key: s.key, context: 'E' });
      s.loop.exits.forEach((r, j) => expr(r.when, e, `${lp}/exits/${j}/when`, 'boolean', s.key));
      if (s.loop.onLimit.mode === 'accept_best') expr(s.loop.onLimit.score, e, `${lp}/onLimit/score`, 'number', s.key);
      for (const [name, src] of Object.entries(s.loop.output.select ?? {})) expr(src, e, `${lp}/output/select/${pointerToken(name)}`, 'any', s.key);
      const c = env({ kind: 'loop', key: s.key, context: 'C' });
      for (const [name, src] of Object.entries(s.loop.carry ?? {})) expr(src, c, `${lp}/carry/${pointerToken(name)}`, 'any', s.key);
      const init = env({ kind: 'loop', key: s.key, context: 'init' });
      for (const [name, src] of Object.entries(s.loop.carryInit ?? {})) expr(src, init, `${lp}/carryInit/${pointerToken(name)}`, 'any', s.key);
    }
    if (s.kind === 'map') {
      const mp = `${p}/map`;
      expr(s.map.items, env({ kind: 'map', key: s.key, context: 'items' }), `${mp}/items`, 'list', s.key);
      if (s.map.itemKey !== undefined) expr(s.map.itemKey, env({ kind: 'map', key: s.key, context: 'item' }), `${mp}/itemKey`, 'scalar', s.key);
      const sel = env({ kind: 'map', key: s.key, context: 'select' });
      for (const [name, src] of Object.entries(s.map.output.select ?? {})) expr(src, sel, `${mp}/output/select/${pointerToken(name)}`, 'any', s.key);
    }
    if (s.kind === 'wait' && s.wait.type === 'event') expr(s.wait.eventKey, stageEnv, `${p}/wait/eventKey`, 'scalar', s.key);
    if (s.kind === 'subworkflow') {
      for (const [name, src] of Object.entries(s.subworkflow.inputs)) expr(src, stageEnv, `${p}/subworkflow/inputs/${pointerToken(name)}`, 'any', s.key);
    }
  });

  graph.edges.forEach((e, i) => {
    if (e.when === undefined) return;
    if (!ctx.indexByKey.has(e.from)) return;
    expr(e.when, env({ kind: 'edge', from: e.from }), `/edges/${i}/when`, 'boolean', e.to);
  });

  const wf = graph.workflow;
  const all = env({ kind: 'workflow' });
  for (const [name, src] of Object.entries(wf.outputs ?? {})) expr(src, all, `/workflow/outputs/${pointerToken(name)}`, 'any');
  hookTemplates(wf.hooks, all, '/workflow/hooks');
  hookTemplates(wf.onExit, all, '/workflow/onExit');
  hookTemplates(wf.onFailure, all, '/workflow/onFailure');

  const pre = env({ kind: 'pre' });
  const visitPre = (steps: readonly PreprocessingStep[], pointer: string) =>
    steps.forEach((s, i) => {
      const p = `${pointer}/${i}/config`;
      const c = s.config;
      if (c.type === 'conditional') {
        expr(c.condition, pre, `${p}/condition`, 'boolean');
        visitPre(c.thenSteps, `${p}/thenSteps`);
        visitPre(c.elseSteps ?? [], `${p}/elseSteps`);
      } else if (c.type === 'set_variable') {
        template(c.value, pre, `${p}/value`);
      } else if (c.type === 'run_script') {
        template(c.cwd, pre, `${p}/cwd`);
      }
    });
  visitPre(wf.lifecycle.preprocessingSteps, '/workflow/lifecycle/preprocessingSteps');
  wf.lifecycle.postProcessing.steps.forEach((s, i) => {
    const p = `/workflow/lifecycle/postProcessing/steps/${i}/config`;
    const c = s.config;
    if (c.type === 'commit_and_push') template(c.commitMessage, all, `${p}/commitMessage`);
    else if (c.type === 'create_pr') {
      template(c.title, all, `${p}/title`);
      template(c.body, all, `${p}/body`);
    } else template(c.cwd, all, `${p}/cwd`);
  });
  return out;
}
