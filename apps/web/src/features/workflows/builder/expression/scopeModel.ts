// ────────────────────────────────────────────────────────────────
// The scope model of the expression editor (P05 WP-5B.5): the type
// environment of a place in the workflow graph, and what autocomplete and
// hover read from it. Pure; the same `GraphTypes` the validator uses, so
// what the editor offers is exactly what a save accepts.
// ────────────────────────────────────────────────────────────────

import {
  analyzeGraph,
  ancestorsOf,
  GraphTypes,
  grammarFunctions,
  listFilters,
  listFunctions,
  typeToString,
  WorkflowGraphSchema,
  type ExprPlace,
  type ExprType,
  type PreprocessingStep,
  type TypeEnv,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';

export type { ExprPlace };

export interface ScopeModel {
  env: TypeEnv;
  /** Declared variable names (plus names set by preprocessing): the bare `{{name}}` sugar. */
  variableNames: ReadonlySet<string>;
}

/** Names set by `set_variable` preprocessing steps, recursively (the validator's rule). */
function preprocessingNames(steps: readonly PreprocessingStep[]): string[] {
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

/**
 * The stages that always run before each stage: its ancestors in its own
 * scope and everything upstream of its container (as `validateWorkflow`'s
 * graph context computes them).
 */
function upstreamOf(graph: WorkflowGraph): (key: string) => ReadonlySet<string> {
  const byKey = new Map(graph.stages.map((s) => [s.key, s]));
  const scopeOf = (k: string) => byKey.get(k)?.parentKey ?? '';
  const keys = [...byKey.keys()];
  const edges = graph.edges.filter((e) => e.from !== e.to && byKey.has(e.from) && byKey.has(e.to) && scopeOf(e.from) === scopeOf(e.to));
  const analysis = analyzeGraph(keys, edges);
  const acyclic = analysis.unordered.length === 0;
  const memo = new Map<string, Set<string>>();
  const upstream = (key: string): Set<string> => {
    let a = memo.get(key);
    if (a) return a;
    a = new Set<string>();
    memo.set(key, a); // a parent cycle stops here
    const own = acyclic ? ancestorsOf(key, analysis) : new Set(keys.filter((k) => k !== key && scopeOf(k) === scopeOf(key)));
    for (const k of own) a.add(k);
    const parent = byKey.get(key)?.parentKey;
    if (parent !== undefined && byKey.has(parent)) for (const k of upstream(parent)) a.add(k);
    return a;
  };
  return upstream;
}

/**
 * The type environment of a place. The document is parsed first (defaults
 * applied); a document mid-edit that does not parse yields null, and the
 * editor then offers nothing rather than something wrong.
 */
export function buildScopeModel(raw: unknown, place: ExprPlace): ScopeModel | null {
  const parsed = WorkflowGraphSchema.safeParse(raw);
  if (!parsed.success) return null;
  const graph = parsed.data;
  try {
    const extra = preprocessingNames(graph.workflow.lifecycle.preprocessingSteps);
    const types = new GraphTypes({ graph, upstream: upstreamOf(graph), extraVariables: extra });
    const env = types.env(place);
    return { env, variableNames: new Set([...graph.workflow.variables.map((v) => v.name), ...extra]) };
  } catch {
    return null;
  }
}

/** The object fields a value of this type has (unions merged; null and unavailable parts dropped). */
export function fieldsOf(t: ExprType): Record<string, ExprType> {
  switch (t.kind) {
    case 'object':
      return { ...t.fields };
    case 'union': {
      const out: Record<string, ExprType> = {};
      for (const m of t.types) Object.assign(out, fieldsOf(m));
      return out;
    }
    default:
      return {};
  }
}

/** The type at a dotted path from the roots, or undefined when a segment is unknown. */
export function typeAtPath(env: TypeEnv, path: readonly string[]): ExprType | undefined {
  let t: ExprType | undefined = env.roots[path[0] ?? ''];
  for (const seg of path.slice(1)) {
    if (!t) return undefined;
    if (t.kind === 'any') return t;
    const fields = fieldsOf(t);
    t = fields[seg] ?? (t.kind === 'object' ? t.rest : undefined);
  }
  return t;
}

export interface CompletionEntry {
  label: string;
  /** codemirror completion type: variable, property, function, keyword. */
  type: 'variable' | 'property' | 'function' | 'keyword' | 'constant';
  detail?: string;
  info?: string;
  /** Text inserted instead of the label (a function call opens its parenthesis). */
  apply?: string;
}

const KEYWORDS = ['and', 'or', 'not', 'in', 'true', 'false', 'null'];

/** Root names usable at this place (an unavailable root is left out). */
function rootEntries(model: ScopeModel, template: boolean): CompletionEntry[] {
  const out: CompletionEntry[] = [];
  for (const [name, t] of Object.entries(model.env.roots)) {
    if (t.kind === 'unavailable') continue;
    out.push({ label: name, type: 'variable', detail: rootDetail(name, t) });
  }
  if (template) {
    for (const name of model.variableNames) out.push({ label: name, type: 'variable', detail: 'variable (bare name)' });
  }
  for (const f of listFunctions()) out.push({ label: f.name, type: 'function', detail: f.signature, info: f.description, apply: `${f.name}(` });
  for (const k of KEYWORDS) out.push({ label: k, type: 'keyword' });
  return out;
}

function rootDetail(name: string, t: ExprType): string {
  if (name === 'stages') return `${Object.keys(fieldsOf(t)).length} stage(s)`;
  if (name === 'variables') return `${Object.keys(fieldsOf(t)).length} variable(s)`;
  return shortType(t);
}

/** A type for a completion detail: short, one line. */
export function shortType(t: ExprType): string {
  if (t.kind === 'unavailable') return 'not available here';
  const s = typeToString(t);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

const PATH_BEFORE = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)?(\.)?([A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Completions for the expression text before the cursor. Returns the offset
 * (in `before`) where the completed word starts, and the options.
 */
export function completeExpression(model: ScopeModel, before: string, template: boolean): { from: number; options: CompletionEntry[] } | null {
  const m = PATH_BEFORE.exec(before);
  if (!m) return null;
  const whole = m[0];
  if (!whole) return { from: before.length, options: rootEntries(model, template) };
  const parts = whole.split('.');
  const partial = parts.pop() ?? '';
  const from = before.length - partial.length;
  if (parts.length === 0) {
    // A lambda parameter or a root: offer the roots.
    return { from, options: rootEntries(model, template) };
  }
  const base = typeAtPath(model.env, parts);
  if (!base || base.kind === 'any' || base.kind === 'unavailable') return null;
  const fields = fieldsOf(base);
  const options: CompletionEntry[] = Object.entries(fields).map(([name, t]) => ({
    label: name,
    type: 'property',
    detail: shortType(t),
    ...(t.kind === 'unavailable' ? { info: t.message } : {}),
  }));
  return options.length > 0 ? { from, options } : null;
}

/** Completions for the filters after `|` inside `{{ }}`. */
export function filterEntries(): CompletionEntry[] {
  return listFilters().map((f) => ({ label: f.name, type: 'function', info: f.description }));
}

/** The function signatures, for the editor's help line. */
export function functionHelp(): string[] {
  return grammarFunctions().map((f) => f.syntax);
}

/**
 * Inside a template: the placeholder the cursor is in (`{{ … }}` not yet
 * closed before the cursor), as the text from its opening to the cursor, or
 * null outside any placeholder.
 */
export function openPlaceholder(textBefore: string): string | null {
  const open = textBefore.lastIndexOf('{{');
  if (open < 0) return null;
  if (open > 0 && textBefore[open - 1] === '\\') return null; // an escaped literal {{
  const close = textBefore.lastIndexOf('}}');
  if (close > open) return null;
  return textBefore.slice(open + 2);
}

/** The dotted path around an offset (for hover), with its span. */
export function pathAt(text: string, offset: number): { path: string; from: number; to: number } | null {
  const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9_.]/.test(c);
  let from = offset;
  let to = offset;
  while (from > 0 && isWord(text[from - 1])) from--;
  while (to < text.length && isWord(text[to])) to++;
  let path = text.slice(from, to);
  // Trim stray dots at the ends.
  while (path.startsWith('.')) {
    path = path.slice(1);
    from++;
  }
  while (path.endsWith('.')) {
    path = path.slice(0, -1);
    to--;
  }
  if (!/^[A-Za-z_]/.test(path)) return null;
  return { path, from, to };
}
