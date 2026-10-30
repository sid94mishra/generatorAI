// ────────────────────────────────────────────────────────────────
// Expression functions: a registry, not grammar. The parser accepts any
// `name(args)`; the type checker and the evaluator look the name up here.
// Adding a function is one entry (P05 §1.1 added the list library).
//
// Functions are pure, deterministic and bounded. A lambda argument binds
// its parameter to the elements of the function's first (list) argument.
// ────────────────────────────────────────────────────────────────

import type { ExprNode } from './ast.js';
import { T, isNullable, kindsOf, members, nullable, typeToString, union, withoutNull, type ExprType } from './types.js';
import { canonicalJson, type Value } from './values.js';

/** A lambda argument at evaluation time. */
export interface LambdaValue {
  readonly kind: 'lambda';
  apply(arg: Value): Value;
}

/** The evaluator's work budget, charged by functions for work the node count misses. */
export interface EvalMeter {
  /** Spend work units; throws (a budget error) when the budget is exhausted. */
  charge(units: number): void;
  /** Logical node count of a value (memoised; measuring it is charged). */
  nodes(v: Value): number;
}

export interface CheckContext {
  report(code: string, message: string, node: ExprNode, hint?: string): void;
}

export interface ExprFunction {
  name: string;
  /** Human-readable signature for docs, e.g. `len(list | string) → number`. */
  signature: string;
  description: string;
  minArgs: number;
  maxArgs: number;
  /** Argument positions that must be lambdas; the parameter is an element of argument 0. */
  lambdaArgs?: readonly number[];
  /** Result type. `args[i]` of a lambda position is the lambda body's type. */
  check(args: ExprType[], nodes: ExprNode[], ctx: CheckContext): ExprType;
  /** Result value. Lambda positions receive a LambdaValue. Work beyond the lambda calls is charged to `meter`. */
  call(args: Array<Value | LambdaValue>, meter: EvalMeter): Value;
}

function isLambda(v: Value | LambdaValue): v is LambdaValue {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && (v as { kind?: unknown }).kind === 'lambda' && 'apply' in v;
}

function listArg(t: ExprType, node: ExprNode, fn: string, ctx: CheckContext): ExprType {
  const k = kindsOf(withoutNull(t));
  if (t.kind !== 'any' && !k.has('list')) {
    ctx.report('expr-type', `${fn}() expects a list, got ${typeToString(t)}`, node);
  }
  return t;
}

const len: ExprFunction = {
  name: 'len',
  signature: 'len(list | string) → number',
  description: 'Number of elements of a list or characters of a string; null when the argument is null',
  minArgs: 1,
  maxArgs: 1,
  check([a], [n], ctx) {
    const k = kindsOf(withoutNull(a!));
    if (a!.kind !== 'any' && !k.has('list') && !k.has('string')) {
      ctx.report('expr-type', `len() expects a list or a string, got ${typeToString(a!)}`, n!);
    }
    return isNullable(a!) ? nullable(T.number) : T.number;
  },
  call([a]) {
    if (Array.isArray(a) || typeof a === 'string') return a.length;
    return null;
  },
};

const count: ExprFunction = {
  name: 'count',
  signature: 'count(list, x => condition) → number',
  description: 'Number of elements for which the condition is true; null when the list is null',
  minArgs: 2,
  maxArgs: 2,
  lambdaArgs: [1],
  check([list, body], [ln, bn], ctx) {
    listArg(list!, ln!, 'count', ctx);
    if (!members(body!).every((m) => m.kind === 'boolean' || m.kind === 'null' || m.kind === 'any')) {
      ctx.report('expr-type', `The count() condition must be a boolean, got ${typeToString(body!)}`, bn!);
    }
    return isNullable(list!) ? nullable(T.number) : T.number;
  },
  call([list, fn]) {
    if (!Array.isArray(list) || !isLambda(fn!)) return null;
    let n = 0;
    for (const x of list) if (fn.apply(x) === true) n++;
    return n;
  },
};

const exists: ExprFunction = {
  name: 'exists',
  signature: 'exists(value) → boolean',
  description: 'True when the value is not null (a missing path is null)',
  minArgs: 1,
  maxArgs: 1,
  check() {
    return T.boolean;
  },
  call([a]) {
    return a !== null && a !== undefined;
  },
};

const lower: ExprFunction = {
  name: 'lower',
  signature: 'lower(string) → string',
  description: 'Lower-cased copy of a string; null when the argument is not a string',
  minArgs: 1,
  maxArgs: 1,
  check([a], [n], ctx) {
    const k = kindsOf(withoutNull(a!));
    if (a!.kind !== 'any' && !k.has('string')) ctx.report('expr-type', `lower() expects a string, got ${typeToString(a!)}`, n!);
    return isNullable(a!) ? nullable(T.string) : T.string;
  },
  call([a], meter) {
    if (typeof a !== 'string') return null;
    meter.charge(Math.ceil(a.length / 64));
    return a.toLowerCase();
  },
};

// ── P05 §1.1: the list and value library ────────────────────────
// Every function is pure and total: a wrong-typed or null argument yields
// null (or the neutral value its description names), never a throw.

/** The element type of a (possibly nullable) list type; `any` otherwise. */
function elementOf(t: ExprType): ExprType {
  const base = withoutNull(t);
  if (base.kind === 'list') return base.element;
  if (base.kind === 'union') {
    const lists = base.types.filter((m): m is Extract<ExprType, { kind: 'list' }> => m.kind === 'list');
    if (lists.length > 0) return union(lists.map((l) => l.element));
  }
  return T.any;
}

/** A list type with the nullability of its source argument. */
function listLike(source: ExprType, element: ExprType): ExprType {
  const out = T.list(element);
  return isNullable(source) ? nullable(out) : out;
}

function numberArg(t: ExprType, node: ExprNode, fn: string, ctx: CheckContext): void {
  if (t.kind !== 'any' && !kindsOf(withoutNull(t)).has('number')) {
    ctx.report('expr-type', `${fn}() expects a number, got ${typeToString(t)}`, node);
  }
}

function booleanBody(t: ExprType, node: ExprNode, fn: string, ctx: CheckContext): void {
  if (!members(t).every((m) => m.kind === 'boolean' || m.kind === 'null' || m.kind === 'any')) {
    ctx.report('expr-type', `The ${fn}() condition must be a boolean, got ${typeToString(t)}`, node);
  }
}

/** The key of an element: the lambda's result, or the element itself. */
function keyOf(fn: Value | LambdaValue | undefined, x: Value): Value {
  return fn !== undefined && isLambda(fn) ? fn.apply(x) : x;
}

const TYPE_ORDER: Record<string, number> = { null: 0, boolean: 1, number: 2, string: 3, list: 4, object: 5 };
function kindOfValue(v: Value): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'list';
  return typeof v === 'object' ? 'object' : typeof v;
}

/** Canonical JSON of a key, with the walk charged to the budget. */
function chargedCanonical(v: Value, meter: EvalMeter): string {
  meter.charge(meter.nodes(v));
  return canonicalJson(v);
}

/** A sort key with its kind and, for a list or object, its canonical JSON computed once. */
interface SortKey {
  kind: string;
  value: Value;
  canonical?: string;
}

/** Total order for sort keys: by JSON type, numbers numerically, strings by UTF-16 code units, lists and objects by canonical JSON. */
export function compareValues(a: SortKey, b: SortKey): number {
  if (a.kind !== b.kind) return TYPE_ORDER[a.kind]! - TYPE_ORDER[b.kind]!;
  if (a.kind === 'null') return 0;
  const x = a.canonical ?? (a.value as number | string | boolean);
  const y = b.canonical ?? (b.value as number | string | boolean);
  return x < y ? -1 : x > y ? 1 : 0;
}

const at: ExprFunction = {
  name: 'at',
  signature: 'at(list, index) → element | null',
  description: 'The element at an index; a negative index counts from the end; out of range or a non-integer index yields null',
  minArgs: 2,
  maxArgs: 2,
  check([list, idx], [ln, ixn], ctx) {
    listArg(list!, ln!, 'at', ctx);
    numberArg(idx!, ixn!, 'at', ctx);
    return nullable(elementOf(list!));
  },
  call([list, idx]) {
    if (!Array.isArray(list) || typeof idx !== 'number' || !Number.isInteger(idx)) return null;
    const i = idx < 0 ? list.length + idx : idx;
    return i >= 0 && i < list.length ? list[i]! : null;
  },
};

const mapFn: ExprFunction = {
  name: 'map',
  signature: 'map(list, x => value) → list',
  description: 'A list of the lambda applied to each element; null when the list is null',
  minArgs: 2,
  maxArgs: 2,
  lambdaArgs: [1],
  check([list, body], [ln], ctx) {
    listArg(list!, ln!, 'map', ctx);
    return listLike(list!, body!);
  },
  call([list, fn]) {
    if (!Array.isArray(list) || !isLambda(fn!)) return null;
    return list.map((x) => fn.apply(x));
  },
};

const filterFn: ExprFunction = {
  name: 'filter',
  signature: 'filter(list, x => condition) → list',
  description: 'The elements for which the condition is true, in order; null when the list is null',
  minArgs: 2,
  maxArgs: 2,
  lambdaArgs: [1],
  check([list, body], [ln, bn], ctx) {
    listArg(list!, ln!, 'filter', ctx);
    booleanBody(body!, bn!, 'filter', ctx);
    return listLike(list!, elementOf(list!));
  },
  call([list, fn]) {
    if (!Array.isArray(list) || !isLambda(fn!)) return null;
    return list.filter((x) => fn.apply(x) === true);
  },
};

const some: ExprFunction = {
  name: 'some',
  signature: 'some(list, x => condition) → boolean',
  description: 'True when the condition holds for at least one element; false for an empty list, null for a null list',
  minArgs: 2,
  maxArgs: 2,
  lambdaArgs: [1],
  check([list, body], [ln, bn], ctx) {
    listArg(list!, ln!, 'some', ctx);
    booleanBody(body!, bn!, 'some', ctx);
    return isNullable(list!) ? nullable(T.boolean) : T.boolean;
  },
  call([list, fn]) {
    if (!Array.isArray(list) || !isLambda(fn!)) return null;
    return list.some((x) => fn.apply(x) === true);
  },
};

const every: ExprFunction = {
  name: 'every',
  signature: 'every(list, x => condition) → boolean',
  description: 'True when the condition holds for every element; true for an empty list, null for a null list',
  minArgs: 2,
  maxArgs: 2,
  lambdaArgs: [1],
  check([list, body], [ln, bn], ctx) {
    listArg(list!, ln!, 'every', ctx);
    booleanBody(body!, bn!, 'every', ctx);
    return isNullable(list!) ? nullable(T.boolean) : T.boolean;
  },
  call([list, fn]) {
    if (!Array.isArray(list) || !isLambda(fn!)) return null;
    return list.every((x) => fn.apply(x) === true);
  },
};

const concat: ExprFunction = {
  name: 'concat',
  signature: 'concat(a, b) → list | string',
  description: 'Two lists joined, or two strings joined; a null argument counts as empty; null when both are null',
  minArgs: 2,
  maxArgs: 2,
  check([a, b], [an], ctx) {
    if (a!.kind === 'any' || b!.kind === 'any') return T.any;
    const ka = kindsOf(withoutNull(a!));
    const kb = kindsOf(withoutNull(b!));
    const onlyNullA = a!.kind === 'null';
    const onlyNullB = b!.kind === 'null';
    const lists = (ka.has('list') || onlyNullA) && (kb.has('list') || onlyNullB);
    const strings = (ka.has('string') || onlyNullA) && (kb.has('string') || onlyNullB);
    const bothNullable = isNullable(a!) && isNullable(b!);
    if (lists && !strings) {
      // `[]` (a list of unknown elements) takes the element type of the other list.
      const elements = [elementOf(a!), elementOf(b!)].filter((e) => e.kind !== 'any');
      const out = T.list(elements.length > 0 ? union(elements) : T.any);
      return bothNullable ? nullable(out) : out;
    }
    if (strings && !lists) return bothNullable ? nullable(T.string) : T.string;
    if (!lists && !strings) {
      ctx.report('expr-type', `concat() joins two lists or two strings, got ${typeToString(a!)} and ${typeToString(b!)}`, an!);
    }
    return T.any;
  },
  call([a, b], meter) {
    const x = a as Value;
    const y = b as Value;
    if (x === null && y === null) return null;
    if (Array.isArray(x) || Array.isArray(y)) meter.charge((Array.isArray(x) ? x.length : 0) + (Array.isArray(y) ? y.length : 0));
    if ((Array.isArray(x) || x === null) && (Array.isArray(y) || y === null)) return [...(x ?? []), ...(y ?? [])];
    if ((typeof x === 'string' || x === null) && (typeof y === 'string' || y === null)) return `${x ?? ''}${y ?? ''}`;
    return null;
  },
};

const unique: ExprFunction = {
  name: 'unique',
  signature: 'unique(list, x => key?) → list',
  description: 'The list without later duplicates (the first element of each key is kept); the key defaults to the element itself',
  minArgs: 1,
  maxArgs: 2,
  lambdaArgs: [1],
  check([list], [ln], ctx) {
    listArg(list!, ln!, 'unique', ctx);
    return listLike(list!, elementOf(list!));
  },
  call([list, fn], meter) {
    if (!Array.isArray(list)) return null;
    const seen = new Set<string>();
    const out: Value[] = [];
    for (const x of list) {
      const k = chargedCanonical(keyOf(fn, x), meter);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  },
};

const diff: ExprFunction = {
  name: 'diff',
  signature: 'diff(a, b, x => key?) → list',
  description: 'The elements of a whose key is not the key of any element of b (a null b removes nothing); null when a is null',
  minArgs: 2,
  maxArgs: 3,
  lambdaArgs: [2],
  check([a, b], [an, bn], ctx) {
    listArg(a!, an!, 'diff', ctx);
    if (b!.kind !== 'null') listArg(b!, bn!, 'diff', ctx);
    return listLike(a!, elementOf(a!));
  },
  call([a, b, fn], meter) {
    if (!Array.isArray(a)) return null;
    const other = new Set<string>(Array.isArray(b) ? b.map((x) => chargedCanonical(keyOf(fn, x), meter)) : []);
    return a.filter((x) => !other.has(chargedCanonical(keyOf(fn, x), meter)));
  },
};

const first: ExprFunction = {
  name: 'first',
  signature: 'first(list) → element | null',
  description: 'The first element; null for an empty or null list',
  minArgs: 1,
  maxArgs: 1,
  check([list], [ln], ctx) {
    listArg(list!, ln!, 'first', ctx);
    return nullable(elementOf(list!));
  },
  call([list]) {
    return Array.isArray(list) && list.length > 0 ? list[0]! : null;
  },
};

const last: ExprFunction = {
  name: 'last',
  signature: 'last(list) → element | null',
  description: 'The last element; null for an empty or null list',
  minArgs: 1,
  maxArgs: 1,
  check([list], [ln], ctx) {
    listArg(list!, ln!, 'last', ctx);
    return nullable(elementOf(list!));
  },
  call([list]) {
    return Array.isArray(list) && list.length > 0 ? list[list.length - 1]! : null;
  },
};

const take: ExprFunction = {
  name: 'take',
  signature: 'take(list, n) → list',
  description: 'The first n elements (all of them when the list is shorter, none when n ≤ 0); null when the list is null',
  minArgs: 2,
  maxArgs: 2,
  check([list, n], [ln, nn], ctx) {
    listArg(list!, ln!, 'take', ctx);
    numberArg(n!, nn!, 'take', ctx);
    return listLike(list!, elementOf(list!));
  },
  call([list, n]) {
    if (!Array.isArray(list) || typeof n !== 'number' || !Number.isFinite(n)) return null;
    return list.slice(0, Math.max(0, Math.floor(n)));
  },
};

const sort: ExprFunction = {
  name: 'sort',
  signature: 'sort(list, x => key?) → list',
  description: 'The list sorted by key, stable: numbers numerically, strings by code unit, mixed keys by type (null < boolean < number < string)',
  minArgs: 1,
  maxArgs: 2,
  lambdaArgs: [1],
  check([list], [ln], ctx) {
    listArg(list!, ln!, 'sort', ctx);
    return listLike(list!, elementOf(list!));
  },
  call([list, fn], meter) {
    if (!Array.isArray(list)) return null;
    meter.charge(list.length * Math.ceil(Math.log2(list.length + 1)));
    return list
      .map((x, i) => {
        const value = keyOf(fn, x);
        const kind = kindOfValue(value);
        const k: SortKey = { kind, value };
        if (kind === 'list' || kind === 'object') k.canonical = chargedCanonical(value, meter);
        return { x, i, k };
      })
      .sort((p, q) => compareValues(p.k, q.k) || p.i - q.i)
      .map((e) => e.x);
  },
};

function numericReduce(name: 'sum' | 'max' | 'min', description: string, reduce: (nums: number[]) => number | null): ExprFunction {
  return {
    name,
    signature: `${name}(list, x => number?) → number${name === 'sum' ? '' : ' | null'}`,
    description,
    minArgs: 1,
    maxArgs: 2,
    lambdaArgs: [1],
    check([list, body], [ln, bn], ctx) {
      listArg(list!, ln!, name, ctx);
      const t = body ?? elementOf(list!);
      if (t.kind !== 'any' && !kindsOf(withoutNull(t)).has('number')) {
        ctx.report('expr-type', `${name}() needs numbers, got ${typeToString(t)}`, bn ?? ln!);
      }
      return name === 'sum' && !isNullable(list!) ? T.number : nullable(T.number);
    },
    call([list, fn]) {
      if (!Array.isArray(list)) return null;
      const nums: number[] = [];
      for (const x of list) {
        const v = keyOf(fn, x);
        if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
      }
      return reduce(nums);
    },
  };
}

const sum = numericReduce('sum', 'The sum of the numbers (non-numbers are ignored); 0 for an empty list, null for a null list', (n) =>
  n.reduce((a, b) => a + b, 0),
);
const max = numericReduce('max', 'The largest number (non-numbers are ignored); null for an empty or null list', (n) =>
  n.length ? Math.max(...n) : null,
);
const min = numericReduce('min', 'The smallest number (non-numbers are ignored); null for an empty or null list', (n) =>
  n.length ? Math.min(...n) : null,
);

const coalesce: ExprFunction = {
  name: 'coalesce',
  signature: 'coalesce(a, b) → a | b',
  description: 'a unless it is null, else b',
  minArgs: 2,
  maxArgs: 2,
  check([a, b]) {
    if (a!.kind === 'any' || b!.kind === 'any') return T.any;
    if (a!.kind === 'null') return b!;
    return union([withoutNull(a!), b!]);
  },
  call([a, b]) {
    return a !== null && a !== undefined ? (a as Value) : ((b ?? null) as Value);
  },
};

const REGISTRY = new Map<string, ExprFunction>(
  [len, count, exists, lower, at, mapFn, filterFn, some, every, concat, unique, diff, first, last, take, sort, sum, max, min, coalesce].map((f) => [
    f.name,
    f,
  ]),
);

export function getFunction(name: string): ExprFunction | undefined {
  return REGISTRY.get(name);
}

/** Every registered function, in registration order (for docs and the skill). */
export function listFunctions(): ExprFunction[] {
  return [...REGISTRY.values()];
}
