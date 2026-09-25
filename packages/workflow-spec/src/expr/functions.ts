// ────────────────────────────────────────────────────────────────
// Expression functions: a registry, not grammar. The parser accepts any
// `name(args)`; the type checker and the evaluator look the name up here.
// Adding a function (P05 adds at, map, filter, concat, …) is one entry.
//
// Functions are pure, deterministic and bounded. A lambda argument binds
// its parameter to the elements of the function's first (list) argument.
// ────────────────────────────────────────────────────────────────

import type { ExprNode } from './ast.js';
import { T, isNullable, kindsOf, members, nullable, typeToString, withoutNull, type ExprType } from './types.js';
import type { Value } from './values.js';

/** A lambda argument at evaluation time. */
export interface LambdaValue {
  readonly kind: 'lambda';
  apply(arg: Value): Value;
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
  /** Result value. Lambda positions receive a LambdaValue. */
  call(args: Array<Value | LambdaValue>): Value;
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
  call([a]) {
    return typeof a === 'string' ? a.toLowerCase() : null;
  },
};

const REGISTRY = new Map<string, ExprFunction>([len, count, exists, lower].map((f) => [f.name, f]));

export function getFunction(name: string): ExprFunction | undefined {
  return REGISTRY.get(name);
}

/** Every registered function, in registration order (for docs and the skill). */
export function listFunctions(): ExprFunction[] {
  return [...REGISTRY.values()];
}
