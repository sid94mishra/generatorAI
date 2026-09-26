// FROZEN COPY for migration v55 (README R-3, RV-33). Copied from
// packages/workflow-spec/src (P01 review fixes). Never edit: v55 converts
// legacy rows into exactly these shapes and validates them with this copy of
// the validator; the live spec package may move on.

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
// - evaluation is bounded: a step budget and a list-size cap.
//
// `evaluate` never throws: an internal failure is returned as an error.
// ────────────────────────────────────────────────────────────────

import type { ExprNode } from './ast.js';
import { getFunction, type LambdaValue } from './functions.js';
import { parseExpression } from './parse.js';
import { deepEqual, getField, isObjectValue, toValue, type Value } from './values.js';

export const DEFAULT_STEP_BUDGET = 100_000;
export const MAX_LIST_LENGTH = 10_000;

/** Root values: `{ variables: {...}, stages: {...}, run: {...}, parent: {...} }`. */
export type EvalScope = Readonly<Record<string, unknown>>;

export interface EvalOptions {
  /** Maximum node visits (default 100k). */
  stepBudget?: number;
}

export type EvalError = { code: 'expr_budget_exceeded' | 'expr_eval_error' | 'expr_syntax'; message: string };
export type EvalResult = { ok: true; value: Value } | { ok: false; error: EvalError };

class BudgetExceeded extends Error {}
class EvalFailure extends Error {}

class Evaluator {
  private steps = 0;
  /** Roots normalised to JSON values once, on first use. */
  private readonly roots = new Map<string, Value>();

  constructor(
    private readonly scope: EvalScope,
    private readonly budget: number,
  ) {}

  eval(node: ExprNode, params: ReadonlyMap<string, Value>): Value {
    if (++this.steps > this.budget) throw new BudgetExceeded();
    switch (node.type) {
      case 'literal':
        return node.value;
      case 'list': {
        if (node.items.length > MAX_LIST_LENGTH) throw new EvalFailure(`A list may hold at most ${MAX_LIST_LENGTH} elements`);
        return node.items.map((i) => this.eval(i, params));
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
            return deepEqual(l, r);
          case '!=':
            return !deepEqual(l, r);
          case 'in':
            if (Array.isArray(r)) return r.some((x) => deepEqual(l, x));
            if (typeof r === 'string' && typeof l === 'string') return r.includes(l);
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
    const out = fn.call(args);
    if (Array.isArray(out) && out.length > MAX_LIST_LENGTH) {
      throw new EvalFailure(`A list may hold at most ${MAX_LIST_LENGTH} elements`);
    }
    return out;
  }
}

/** Evaluate a parsed expression against a scope. Never throws. */
export function evaluate(ast: ExprNode, scope: EvalScope, opts: EvalOptions = {}): EvalResult {
  const ev = new Evaluator(scope, opts.stepBudget ?? DEFAULT_STEP_BUDGET);
  try {
    return { ok: true, value: ev.eval(ast, new Map()) };
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      return { ok: false, error: { code: 'expr_budget_exceeded', message: 'Expression evaluation exceeded its step budget' } };
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

/**
 * A condition holds only when it evaluates to exactly `true`; null, false,
 * a non-boolean and an evaluation error all mean "does not hold". Callers
 * that must distinguish an error (a guard failing with condition_error)
 * use `evaluate` / `evaluateSource` instead.
 */
export function conditionHolds(src: string | ExprNode, scope: EvalScope, opts: EvalOptions = {}): boolean {
  const r = typeof src === 'string' ? evaluateSource(src, scope, opts) : evaluate(src, scope, opts);
  return r.ok && r.value === true;
}
