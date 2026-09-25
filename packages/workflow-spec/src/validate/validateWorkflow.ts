// ────────────────────────────────────────────────────────────────
// validateWorkflow: the one validator for workflow documents.
//
// Pure: the builder runs it in the browser, the server runs it on every
// save, import and publish, and the CLI and the authoring skill run it
// offline. Layers, in order:
//   1. strict schema (unknown fields are errors, with hints);
//   2. the graph (keys, edges, one edge per pair, cycles, containers);
//   3. references (variables, context sources, output contracts, joins);
//   4. expressions and templates (parse and type-check);
//   5. security (literal commands, secretref-only secrets);
//   6. the engine capability gate.
// A schema failure stops validation: later layers need a parsed document.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { ENGINE_LEVEL, type EngineLevel } from '../constants.js';
import type { ExprDiagnostic } from '../expr/ast.js';
import { checkTemplate } from '../expr/template.js';
import { checkExpression, type TypeEnv } from '../expr/typecheck.js';
import { compileSafeRegex } from '../regex/safeRegex.js';
import { WorkflowGraphSchema, type WorkflowGraph } from '../schemas/graph.js';
import { CONTAINER_STAGE_KINDS, stageTemplateFields, type StageSpec } from '../schemas/stage.js';
import type { PreprocessingStep } from '../schemas/workflow.js';
import { unwrap } from '../util/zodWalk.js';
import { engineIssues } from './capability.js';
import { analyzeGraph, ancestorsOf, type GraphAnalysis } from './dag.js';
import { unknownFieldHint } from './hints.js';
import { pointerToken, toPointer, type ValidationIssue } from './issues.js';
import { buildTypeEnv, preprocessingVariableNames } from './scope.js';
import { securityIssues } from './security.js';

export interface ValidateOptions {
  /** Engine whose capabilities gate the document (default: ENGINE_LEVEL). */
  engine?: EngineLevel;
}

export interface ValidationResult {
  /** True when no issue has severity `error`. */
  valid: boolean;
  issues: ValidationIssue[];
  /** The parsed document (defaults applied), when the schema layer passed. */
  graph?: WorkflowGraph;
}

const FUTURE_KINDS = new Set(['loop', 'map', 'subworkflow', 'wait', 'check']);

export function validateWorkflow(input: unknown, opts: ValidateOptions = {}): ValidationResult {
  const engine = opts.engine ?? ENGINE_LEVEL;
  const parsed = WorkflowGraphSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, issues: schemaIssues(parsed.error, input) };
  }
  const graph = parsed.data;
  const issues: ValidationIssue[] = [];
  const ctx = new GraphContext(graph);
  issues.push(...ctx.dagIssues());
  issues.push(...referenceIssues(graph, ctx));
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
    if (zi.path[zi.path.length - 1] === 'kind' || (zi.code === z.ZodIssueCode.invalid_union_discriminator && zi.path[0] === 'stages')) {
      const kind = valueAt(input, [...zi.path.slice(0, 2), 'kind']);
      if (typeof kind === 'string' && FUTURE_KINDS.has(kind)) hint = `Stage kind '${kind}' is not available yet; only 'agent' stages exist`;
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

  constructor(readonly graph: WorkflowGraph) {
    graph.stages.forEach((s, i) => {
      if (!this.indexByKey.has(s.key)) this.indexByKey.set(s.key, i);
    });
    this.keys = [...this.indexByKey.keys()];
    const edges = graph.edges.filter((e) => e.from !== e.to && this.indexByKey.has(e.from) && this.indexByKey.has(e.to));
    this.analysis = analyzeGraph(this.keys, edges);
    this.acyclic = this.analysis.unordered.length === 0;
  }

  /** Stages that always run before `key`. With a cycle, every other stage (to avoid cascading errors). */
  upstream(key: string): Set<string> {
    let a = this.ancestors.get(key);
    if (!a) {
      a = this.acyclic ? ancestorsOf(key, this.analysis) : new Set(this.keys.filter((k) => k !== key));
      this.ancestors.set(key, a);
    }
    return a;
  }

  stage(key: string): StageSpec | undefined {
    const i = this.indexByKey.get(key);
    return i === undefined ? undefined : this.graph.stages[i];
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
        } else if (!CONTAINER_STAGE_KINDS.includes(parent.kind)) {
          out.push({
            code: 'parent-not-container',
            severity: 'error',
            path: `/stages/${i}/parentKey`,
            stageKey: s.key,
            message: `Stage '${s.parentKey}' is a${parent.kind === 'agent' ? 'n' : ''} ${parent.kind} stage and cannot contain other stages`,
            hint: 'Only container stages (loop, map, sub-workflow) have a body',
          });
        }
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
      const unordered = new Set(this.analysis.unordered);
      const onCycle = this.analysis.unordered.filter((n) => reaches(n, n, this.analysis, unordered));
      out.push({
        code: 'cycle',
        severity: 'error',
        path: '/edges',
        ...(onCycle[0] ? { stageKey: onCycle[0] } : {}),
        message: `The edges form a cycle through: ${onCycle.join(', ')}`,
        hint: 'A workflow graph is acyclic; repeat work with a loop stage instead',
      });
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

function referenceIssues(graph: WorkflowGraph, ctx: GraphContext): ValidationIssue[] {
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
    if (v.defaultValue !== undefined) {
      const d = v.defaultValue;
      const ok =
        v.type === 'number'
          ? typeof d === 'number' && Number.isFinite(d)
          : v.type === 'boolean'
            ? typeof d === 'boolean'
            : v.type === 'choice'
              ? typeof d === 'string' && (!v.options || v.options.includes(d))
              : typeof d === 'string';
      if (!ok) {
        out.push({
          code: 'variable-default-type',
          severity: 'error',
          path: `${p}/defaultValue`,
          message: `The default of '${v.name}' does not match its type ${v.type}${v.type === 'choice' ? ' (or is not an option)' : ''}`,
        });
      }
    }
  });

  out.push(...duplicateIds(wf.hooks, '/workflow/hooks'));
  for (const name of Object.keys(wf.outputs ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      out.push({ code: 'invalid-output-name', severity: 'error', path: `/workflow/outputs/${pointerToken(name)}`, message: `Output name '${name}' is not an identifier` });
    }
  }

  const aliases = new Set(wf.lifecycle.codebaseAliases);
  const aliasCheck = (alias: string | undefined, path: string) => {
    if (alias !== undefined && aliases.size > 0 && !aliases.has(alias)) {
      out.push({
        code: 'unknown-codebase-alias',
        severity: 'warning',
        path,
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

  graph.stages.forEach((s, i) => {
    const p = `/stages/${i}`;
    const k = s.key;
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
    if (s.sessionReuse === 'continue' && s.parentKey === undefined) {
      out.push({
        code: 'session-continue-outside-loop',
        severity: 'warning',
        path: `${p}/sessionReuse`,
        stageKey: k,
        message: 'sessionReuse continue only has an effect inside a loop body',
      });
    }
    if (s.followUpPrompts !== undefined && s.parentKey === undefined) {
      out.push({
        code: 'follow-up-outside-loop',
        severity: 'warning',
        path: `${p}/followUpPrompts`,
        stageKey: k,
        message: 'followUpPrompts are only used from the second iteration of a loop',
      });
    }
    if (s.retry && s.retry.maxDelayMs < s.retry.initialDelayMs) {
      out.push({ code: 'retry-delay-bounds', severity: 'warning', path: `${p}/retry/maxDelayMs`, stageKey: k, message: 'maxDelayMs is below initialDelayMs, so every delay is maxDelayMs' });
    }
  });

  graph.edges.forEach((e, i) => {
    if (e.handlesFailure && (e.on === 'failure')) {
      out.push({ code: 'handles-failure-redundant', severity: 'warning', path: `/edges/${i}/handlesFailure`, message: 'A failure edge already handles failures' });
    }
  });
  return out;
}

// ── 4. Expressions and templates ─────────────────────────────────

function located(src: string, d: ExprDiagnostic): string {
  if (src.length <= 60 || d.start >= src.length) return d.message;
  return `${d.message} (at character ${d.start + 1})`;
}

function expressionIssues(graph: WorkflowGraph, ctx: GraphContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const extra = preprocessingVariableNames(graph.workflow.lifecycle.preprocessingSteps);
  const envCache = new Map<string, TypeEnv>();
  const env = (visible: ReadonlySet<string> | null, opts: { parent?: boolean; stages?: boolean } = {}): TypeEnv => {
    const cacheKey = `${visible ? [...visible].sort().join(',') : '*'}|${opts.parent ? 1 : 0}|${opts.stages === false ? 0 : 1}`;
    let e = envCache.get(cacheKey);
    if (!e) {
      e = buildTypeEnv({ graph, visibleStages: visible, parent: !!opts.parent, stages: opts.stages !== false, extraVariables: extra });
      envCache.set(cacheKey, e);
    }
    return e;
  };
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
  const expr = (src: string, e: TypeEnv, path: string, expect: 'boolean' | 'any', stageKey?: string) =>
    report(src, checkExpression(src, e, { expect }).diagnostics, path, stageKey);
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

  const all = env(null);
  graph.stages.forEach((s, i) => {
    const p = `/stages/${i}`;
    const upstream = ctx.upstream(s.key);
    const stageEnv = env(upstream);
    if (s.guard !== undefined) expr(s.guard, stageEnv, `${p}/guard`, 'boolean', s.key);
    for (const f of stageTemplateFields(s)) template(f.text, stageEnv, `${p}${f.pointer}`, s.key);
    hookTemplates(s.hooks, stageEnv, `${p}/hooks`, s.key);
    const selfEnv = env(new Set([...upstream, s.key]));
    hookTemplates(s.compensate as ReadonlyArray<Hookish> | undefined, selfEnv, `${p}/compensate`, s.key);
    s.output.rules.forEach((r, j) => {
      if (r.type !== 'custom_script') return;
      for (const [name, v] of Object.entries(r.env ?? {})) template(v, selfEnv, `${p}/output/rules/${j}/env/${pointerToken(name)}`, s.key);
    });
  });

  graph.edges.forEach((e, i) => {
    if (e.when === undefined) return;
    const from = ctx.stage(e.from);
    const visible = from ? new Set([...ctx.upstream(e.from), e.from]) : new Set<string>();
    expr(e.when, env(visible, { parent: true }), `/edges/${i}/when`, 'boolean', e.to);
  });

  const wf = graph.workflow;
  for (const [name, src] of Object.entries(wf.outputs ?? {})) expr(src, all, `/workflow/outputs/${pointerToken(name)}`, 'any');
  hookTemplates(wf.hooks, all, '/workflow/hooks');
  hookTemplates(wf.onExit, all, '/workflow/onExit');
  hookTemplates(wf.onFailure, all, '/workflow/onFailure');

  const pre = env(null, { stages: false });
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
