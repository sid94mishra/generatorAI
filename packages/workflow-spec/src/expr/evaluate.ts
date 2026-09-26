// ────────────────────────────────────────────────────────────────
// Expression v2 evaluator.
//
// Semantics (G5 §4.6, P05 §1.1):
// - a path through a missing or null value yields null;
// - every comparison involving null is false (== and != alike), so presence
//   is tested with exists(x);
// - equality is strict by JSON type and deep for lists and objects;
// - logic is three-valued: `not null` is null, `null and false` is false,
//   `null or true` is true, anything else with null is null; a condition
//   holds only when it evaluates to exactly `true`;
// - evaluation is bounded: one work budget (node visits, produced elements,
//   and the compare / canonicalise / sort work of the list library), a
//   list-size cap and a cap on the size of any value it produces.
//
// `evaluate` never throws: an internal failure is returned as an error.
// ────────────────────────────────────────────────────────────────

import type { ExprNode } from './ast.js';
import { getFunction, type EvalMeter, type LambdaValue } from './functions.js';
import { parseExpression } from './parse.js';
import { deepEqual, getField, isObjectValue, toValue, type Value } from './values.js';

export const DEFAULT_STEP_BUDGET = 1_000_000;
export const MAX_LIST_LENGTH = 10_000;
/** Largest value (approximate JSON bytes) an expression may produce. */
const MAX_VALUE_BYTES = 1_048_576;

/** Root values: `{ variables: {...}, stages: {...}, run: {...}, parent: {...} }`. */
export type EvalScope = Readonly<Record<string, unknown>>;

export interface EvalOptions {
  /** Maximum work units: node visits, produced elements, compared/canonicalised value nodes (default 1M). */
  stepBudget?: number;
}

export type EvalError = { code: 'expr_budget_exceeded' | 'expr_eval_error' | 'expr_syntax'; message: string };
export type EvalResult = { ok: true; value: Value } | { ok: false; error: EvalError };

class BudgetExceeded extends Error {}
class EvalFailure extends Error {}

/** Logical size of a value: shared sub-values count once per reference. */
interface ValueSize {
  nodes: number;
  bytes: number;
}

class Evaluator implements EvalMeter {
  private steps = 0;
  /** Roots normalised to JSON values once, on first use. */
  private readonly roots = new Map<string, Value>();
  /** Memoised sizes, so a value shared by reference is measured once. */
  private readonly sizes = new WeakMap<object, ValueSize>();

  constructor(
    private readonly scope: EvalScope,
    private readonly budget: number,
  ) {}

  charge(units: number): void {
    this.steps += units;
    if (this.steps > this.budget) throw new BudgetExceeded('Expression evaluation exceeded its step budget');
  }

  nodes(v: Value): number {
    return this.sizeOf(v).nodes;
  }

  private sizeOf(v: Value): ValueSize {
    if (v === null || typeof v !== 'object') {
      return { nodes: 1, bytes: typeof v === 'string' ? v.length + 2 : 8 };
    }
    const known = this.sizes.get(v);
    if (known) return known;
    const size: ValueSize = { nodes: 1, bytes: 2 };
    if (Array.isArray(v)) {
      this.charge(v.length);
      for (const x of v) {
        const s = this.sizeOf(x);
        size.nodes += s.nodes;
        size.bytes += s.bytes + 1;
      }
    } else {
      const keys = Object.keys(v);
      this.charge(keys.length);
      for (const k of keys) {
        const s = this.sizeOf(v[k]!);
        size.nodes += s.nodes;
        size.bytes += s.bytes + k.length + 4;
      }
    }
    this.sizes.set(v, size);
    return size;
  }

  /** A value the expression produced: charge its new elements and enforce the size cap. */
  private produced(v: Value): Value {
    if (typeof v === 'string') {
      if (v.length + 2 > MAX_VALUE_BYTES) throw new BudgetExceeded('Expression evaluation produced a value larger than 1 MB');
    } else if (v !== null && typeof v === 'object' && this.sizeOf(v).bytes > MAX_VALUE_BYTES) {
      throw new BudgetExceeded('Expression evaluation produced a value larger than 1 MB');
    }
    return v;
  }

  /** Charge a deep comparison: it walks at most the smaller side. */
  private chargeCompare(l: Value, r: Value): void {
    if (l !== null && typeof l === 'object' && r !== null && typeof r === 'object') {
      this.charge(Math.min(this.nodes(l), this.nodes(r)));
    }
  }

  eval(node: ExprNode, params: ReadonlyMap<string, Value>): Value {
    this.charge(1);
    switch (node.type) {
      case 'literal':
        return node.value;
      case 'list': {
        if (node.items.length > MAX_LIST_LENGTH) throw new EvalFailure(`A list may hold at most ${MAX_LIST_LENGTH} elements`);
        return this.produced(node.items.map((i) => this.eval(i, params)));
      }
      case 'ident': {
        if (params.has(node.name)) return params.get(node.name)!;
        if (!Object.prototype.hasOwnProperty.call(this.scope, node.name)) return null;
        let root = this.roots.get(node.name);
        if (root === undefined) {
          root = toValue(this.scope[node.name]);
          this.roots.set(node.name, root);
        }
        return root;
      }
      case 'member':
        return getField(this.eval(node.object, params), node.property);
      case 'index': {
        const obj = this.eval(node.object, params);
        const idx = this.eval(node.index, params);
        if (Array.isArray(obj) && typeof idx === 'number' && Number.isInteger(idx)) {
          const i = idx < 0 ? obj.length + idx : idx;
          return i >= 0 && i < obj.length ? obj[i]! : null;
        }
        if (isObjectValue(obj) && typeof idx === 'string') return getField(obj, idx);
        return null;
      }
      case 'call':
        return this.call(node, params);
      case 'lambda':
        throw new EvalFailure('A lambda is only allowed as a function argument');
      case 'unary': {
        const v = this.eval(node.operand, params);
        return v === true ? false : v === false ? true : null;
      }
      case 'logical': {
        const l = this.eval(node.left, params);
        if (node.op === 'and') {
          if (l === false) return false;
          const r = this.eval(node.right, params);
          if (r === false) return false;
          return l === true && r === true ? true : null;
        }
        if (l === true) return true;
        const r = this.eval(node.right, params);
        if (r === true) return true;
        return l === false && r === false ? false : null;
      }
      case 'binary': {
        const l = this.eval(node.left, params);
        const r = this.eval(node.right, params);
        if (l === null || r === null) return false;
        switch (node.op) {
          case '==':
            this.chargeCompare(l, r);
            return deepEqual(l, r);
          case '!=':
            this.chargeCompare(l, r);
            return !deepEqual(l, r);
          case 'in':
            if (Array.isArray(r)) {
              this.charge(l !== null && typeof l === 'object' ? this.nodes(r) : r.length);
              return r.some((x) => deepEqual(l, x));
            }
            if (typeof r === 'string' && typeof l === 'string') {
              this.charge(Math.ceil(r.length / 64));
              return r.includes(l);
            }
            return false;
          default: {
            const bothNum = typeof l === 'number' && typeof r === 'number';
            const bothStr = typeof l === 'string' && typeof r === 'string';
            if (!bothNum && !bothStr) return false;
            const a = l as number | string;
            const b = r as number | string;
            if (node.op === '<') return a < b;
            if (node.op === '<=') return a <= b;
            if (node.op === '>') return a > b;
            return a >= b;
          }
        }
      }
    }
  }

  private call(node: Extract<ExprNode, { type: 'call' }>, params: ReadonlyMap<string, Value>): Value {
    const fn = getFunction(node.callee);
    if (!fn) throw new EvalFailure(`Unknown function '${node.callee}'`);
    if (node.args.length < fn.minArgs || node.args.length > fn.maxArgs) {
      throw new EvalFailure(`${fn.name}() takes ${fn.minArgs}..${fn.maxArgs} arguments`);
    }
    const args: Array<Value | LambdaValue> = node.args.map((arg) => {
      if (arg.type === 'lambda') {
        const lambda: LambdaValue = {
          kind: 'lambda',
          apply: (x: Value) => {
            const inner = new Map(params);
            inner.set(arg.param, x);
            return this.eval(arg.body, inner);
          },
        };
        return lambda;
      }
      return this.eval(arg, params);
    });
    const out = fn.call(args, this);
    if (Array.isArray(out) && out.length > MAX_LIST_LENGTH) {
      throw new EvalFailure(`A list may hold at most ${MAX_LIST_LENGTH} elements`);
    }
    return this.produced(out);
  }
}

/** Evaluate a parsed expression against a scope. Never throws. */
export function evaluate(ast: ExprNode, scope: EvalScope, opts: EvalOptions = {}): EvalResult {
  const ev = new Evaluator(scope, opts.stepBudget ?? DEFAULT_STEP_BUDGET);
  try {
    return { ok: true, value: ev.eval(ast, new Map()) };
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      return { ok: false, error: { code: 'expr_budget_exceeded', message: err.message } };
    }
    return { ok: false, error: { code: 'expr_eval_error', message: (err as Error)?.message ?? String(err) } };
  }
}

/** Parse and evaluate source text. Never throws. */
export function evaluateSource(src: string, scope: EvalScope, opts: EvalOptions = {}): EvalResult {
  const parsed = parseExpression(src);
  if (!parsed.ok) return { ok: false, error: { code: 'expr_syntax', message: parsed.error.message } };
  return evaluate(parsed.ast, scope, opts);
}
