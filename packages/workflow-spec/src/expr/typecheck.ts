// ────────────────────────────────────────────────────────────────
// Expression v2 type checker.
//
// Runs at save time against a type environment built from the declared
// variables and the output schemas of the stages an expression may see.
// Unknown names and fields are errors (a typo is never silently false),
// comparisons between types that can never be equal are errors (equality
// is strict by JSON type), and comparing an enum to a string outside the
// enum is an error.
// ────────────────────────────────────────────────────────────────

import type { ExprDiagnostic, ExprNode } from './ast.js';
import { getFunction, listFunctions } from './functions.js';
import { parseExpression } from './parse.js';
import {
  T,
  isBooleanish,
  isNullable,
  kindsOf,
  members,
  nullable,
  typeToString,
  union,
  withoutNull,
  type ExprType,
} from './types.js';
import { closest } from '../util/text.js';

export interface TypeEnv {
  /** Root names and their types; an `unavailable` type reports its own error when used. */
  roots: Readonly<Record<string, ExprType>>;
  /** Declared variable names, for the "did you mean variables.x" hint on a bare name. */
  variableNames?: ReadonlySet<string>;
}

export interface TypeCheckResult {
  type: ExprType;
  diagnostics: ExprDiagnostic[];
}

class Checker {
  readonly diagnostics: ExprDiagnostic[] = [];

  constructor(private readonly env: TypeEnv) {}

  report(code: string, message: string, node: { start: number; end: number }, hint?: string): void {
    this.diagnostics.push({ code, message, start: node.start, end: node.end, ...(hint ? { hint } : {}) });
  }

  infer(node: ExprNode, params: ReadonlyMap<string, ExprType>): ExprType {
    switch (node.type) {
      case 'literal':
        if (node.value === null) return T.null;
        if (typeof node.value === 'string') return T.string;
        return typeof node.value === 'number' ? T.number : T.boolean;
      case 'list':
        return T.list(node.items.length ? union(node.items.map((i) => this.infer(i, params))) : T.any);
      case 'ident':
        return this.ident(node, params);
      case 'member':
        return this.member(this.infer(node.object, params), node.property, node);
      case 'index':
        return this.index(node, params);
      case 'call':
        return this.call(node, params);
      case 'lambda':
        this.report('expr-syntax', 'A lambda (x => …) is only allowed as a function argument', node);
        return T.any;
      case 'unary': {
        const t = this.infer(node.operand, params);
        if (!isBooleanish(t)) {
          this.report('expr-type', `not needs a boolean, got ${typeToString(t)}`, node.operand, 'Test presence with exists(x) or len(x) > 0');
        }
        return isNullable(t) ? nullable(T.boolean) : T.boolean;
      }
      case 'logical': {
        const l = this.infer(node.left, params);
        const r = this.infer(node.right, params);
        for (const [t, n] of [
          [l, node.left],
          [r, node.right],
        ] as const) {
          if (!isBooleanish(t)) {
            this.report('expr-type', `${node.op} needs booleans, got ${typeToString(t)}`, n, 'Test presence with exists(x) or len(x) > 0');
          }
        }
        return isNullable(l) || isNullable(r) ? nullable(T.boolean) : T.boolean;
      }
      case 'binary':
        return this.binary(node, params);
    }
  }

  private ident(node: Extract<ExprNode, { type: 'ident' }>, params: ReadonlyMap<string, ExprType>): ExprType {
    const p = params.get(node.name);
    if (p) return p;
    const root = this.env.roots[node.name];
    if (!root) {
      const isVar = this.env.variableNames?.has(node.name);
      const near = closest(node.name, Object.keys(this.env.roots));
      this.report(
        'expr-unknown-root',
        `Unknown name '${node.name}'`,
        node,
        isVar ? `Variables are read as variables.${node.name}` : near ? `Did you mean '${near}'?` : 'Quote text values, e.g. \'value\'',
      );
      return T.any;
    }
    if (root.kind === 'unavailable') {
      this.report(root.code, root.message, node, root.hint);
      return T.any;
    }
    return root;
  }

  member(objT: ExprType, prop: string, node: { start: number; end: number }): ExprType {
    if (objT.kind === 'any') return T.any;
    if (objT.kind === 'unavailable') return T.any;
    const ms = members(objT);
    const results: ExprType[] = [];
    let reported = false;
    for (const m of ms) {
      if (m.kind === 'null') {
        results.push(T.null);
        continue;
      }
      if (m.kind === 'any') return T.any;
      if (m.kind === 'object') {
        const f = Object.prototype.hasOwnProperty.call(m.fields, prop) ? m.fields[prop] : m.rest;
        if (!f) {
          if (!reported) {
            const near = closest(prop, Object.keys(m.fields));
            this.report(
              m.unknown?.code ?? 'expr-unknown-field',
              `Unknown ${m.unknown?.noun ?? 'field'} '${prop}'`,
              node,
              near ? `Did you mean '${near}'?` : Object.keys(m.fields).length ? `Known fields: ${Object.keys(m.fields).join(', ')}` : undefined,
            );
            reported = true;
          }
          results.push(T.any);
          continue;
        }
        if (f.kind === 'unavailable') {
          if (!reported) this.report(f.code, f.message, node, f.hint);
          reported = true;
          results.push(T.any);
          continue;
        }
        results.push(f);
        continue;
      }
      if (!reported) {
        this.report('expr-type', `A ${typeToString(m)} has no field '${prop}'`, node, m.kind === 'list' ? 'Use len(x) or an index x[0]' : undefined);
        reported = true;
      }
      results.push(T.any);
    }
    return union(results);
  }

  private index(node: Extract<ExprNode, { type: 'index' }>, params: ReadonlyMap<string, ExprType>): ExprType {
    const objT = this.infer(node.object, params);
    const idxT = this.infer(node.index, params);
    if (node.index.type === 'literal' && typeof node.index.value === 'string') {
      return this.member(objT, node.index.value, node);
    }
    if (objT.kind === 'any') return T.any;
    const base = withoutNull(objT);
    if (base.kind === 'list') {
      if (idxT.kind !== 'any' && !kindsOf(withoutNull(idxT)).has('number')) {
        this.report('expr-type', `A list index must be a number, got ${typeToString(idxT)}`, node.index);
      }
      return nullable(base.element);
    }
    if (base.kind === 'object') return nullable(base.rest ?? T.any);
    this.report('expr-type', `A ${typeToString(objT)} cannot be indexed`, node);
    return T.any;
  }

  private call(node: Extract<ExprNode, { type: 'call' }>, params: ReadonlyMap<string, ExprType>): ExprType {
    const fn = getFunction(node.callee);
    if (!fn) {
      const near = closest(node.callee, listFunctions().map((f) => f.name));
      this.report(
        'expr-unknown-function',
        `Unknown function '${node.callee}'`,
        node,
        near ? `Did you mean '${near}'?` : `Functions: ${listFunctions().map((f) => f.name).join(', ')}`,
      );
      node.args.forEach((a) => a.type !== 'lambda' && this.infer(a, params));
      return T.any;
    }
    if (node.args.length < fn.minArgs || node.args.length > fn.maxArgs) {
      this.report(
        'expr-arity',
        `${fn.name}() takes ${fn.minArgs === fn.maxArgs ? fn.minArgs : `${fn.minArgs} to ${fn.maxArgs}`} argument(s), got ${node.args.length}`,
        node,
        fn.signature,
      );
      return T.any;
    }
    const lambdaPos = new Set(fn.lambdaArgs ?? []);
    const types: ExprType[] = [];
    node.args.forEach((arg, i) => {
      if (lambdaPos.has(i)) {
        if (arg.type !== 'lambda') {
          this.report('expr-type', `Argument ${i + 1} of ${fn.name}() must be a lambda (x => …)`, arg, fn.signature);
          types.push(this.infer(arg, params));
          return;
        }
        if (this.env.roots[arg.param] || params.has(arg.param)) {
          this.report('expr-type', `Lambda parameter '${arg.param}' shadows another name`, arg, 'Pick another parameter name');
        }
        const listT = types[0] ?? T.any;
        const base = withoutNull(listT);
        const paramT = base.kind === 'list' ? base.element : T.any;
        const inner = new Map(params);
        inner.set(arg.param, paramT);
        types.push(this.infer(arg.body, inner));
        return;
      }
      if (arg.type === 'lambda') {
        this.report('expr-type', `Argument ${i + 1} of ${fn.name}() cannot be a lambda`, arg, fn.signature);
        types.push(T.any);
        return;
      }
      types.push(this.infer(arg, params));
    });
    return fn.check(types, node.args, { report: (c, m, n, h) => this.report(c, m, n, h) });
  }

  private binary(node: Extract<ExprNode, { type: 'binary' }>, params: ReadonlyMap<string, ExprType>): ExprType {
    const l = this.infer(node.left, params);
    const r = this.infer(node.right, params);
    const nullLiteral = [node.left, node.right].find((n) => n.type === 'literal' && n.value === null);
    if (nullLiteral) {
      this.report(
        'expr-type',
        'A comparison with null is always false',
        nullLiteral,
        node.op === '!=' ? 'Test presence with exists(x)' : 'Test absence with not exists(x)',
      );
      return T.boolean;
    }
    switch (node.op) {
      case '==':
      case '!=':
        this.comparable(l, r, node);
        this.enumCheck(l, node.right);
        this.enumCheck(r, node.left);
        break;
      case '<':
      case '<=':
      case '>':
      case '>=': {
        if (l.kind === 'any' || r.kind === 'any') break;
        const lk = kindsOf(withoutNull(l));
        const rk = kindsOf(withoutNull(r));
        const ordered = (k: Set<string>) => [...k].every((x) => x === 'number' || x === 'string' || x === 'null');
        const bothNumber = lk.has('number') && rk.has('number');
        const bothString = lk.has('string') && rk.has('string');
        if (!ordered(lk) || !ordered(rk) || (!bothNumber && !bothString)) {
          this.report('expr-type', `${node.op} compares two numbers or two strings, got ${typeToString(l)} and ${typeToString(r)}`, node);
        }
        break;
      }
      case 'in': {
        if (r.kind === 'any') break;
        const base = withoutNull(r);
        if (base.kind === 'list') {
          this.comparable(l, base.element, node);
          this.enumCheck(l, node.right);
        } else if (kindsOf(base).has('string') && kindsOf(base).size === 1) {
          if (l.kind !== 'any' && !kindsOf(withoutNull(l)).has('string')) {
            this.report('expr-type', `'in' on a string needs a string on the left, got ${typeToString(l)}`, node);
          }
        } else {
          this.report('expr-type', `'in' needs a list or a string on the right, got ${typeToString(r)}`, node.right);
        }
        break;
      }
    }
    return T.boolean;
  }

  private comparable(l: ExprType, r: ExprType, node: { start: number; end: number }): void {
    if (l.kind === 'any' || r.kind === 'any') return;
    const lk = kindsOf(withoutNull(l));
    const rk = kindsOf(withoutNull(r));
    if (lk.has('null') || rk.has('null')) return;
    if (lk.has('any') || rk.has('any')) return;
    for (const k of lk) if (rk.has(k)) return;
    this.report(
      'expr-type',
      `A ${typeToString(l)} is never equal to a ${typeToString(r)} (equality is strict by type)`,
      node,
      lk.has('number') || rk.has('number') ? "Compare numbers to numbers: 3, not '3'" : undefined,
    );
  }

  /** `stages.review.output.verdict == 'aprove'` → the literal is outside the enum. */
  private enumCheck(t: ExprType, other: ExprNode): void {
    const enums = members(t).filter((m): m is Extract<ExprType, { kind: 'string' }> => m.kind === 'string' && !!m.enum);
    if (enums.length === 0 || members(t).some((m) => m.kind === 'string' && !m.enum) || t.kind === 'any') return;
    const allowed = new Set(enums.flatMap((e) => e.enum ?? []));
    const literals: ExprNode[] = other.type === 'list' ? other.items : [other];
    for (const lit of literals) {
      if (lit.type === 'literal' && typeof lit.value === 'string' && !allowed.has(lit.value)) {
        const near = closest(lit.value, allowed);
        this.report(
          'expr-enum-mismatch',
          `'${lit.value}' is not one of ${[...allowed].map((a) => `'${a}'`).join(', ')}`,
          lit,
          near ? `Did you mean '${near}'?` : undefined,
        );
      }
    }
  }
}

/** Type-check a parsed expression. */
export function typecheckExpression(ast: ExprNode, env: TypeEnv): TypeCheckResult {
  const c = new Checker(env);
  const type = c.infer(ast, new Map());
  return { type, diagnostics: c.diagnostics };
}

/**
 * Parse and type-check source text. With `expect: 'boolean'` a result that
 * cannot be a boolean is reported as `expr-not-boolean`.
 */
export function checkExpression(
  src: string,
  env: TypeEnv,
  opts: { expect?: 'boolean' | 'any' } = {},
): { ast?: ExprNode; type: ExprType; diagnostics: ExprDiagnostic[] } {
  const parsed = parseExpression(src);
  if (!parsed.ok) return { type: T.any, diagnostics: [parsed.error] };
  const { type, diagnostics } = typecheckExpression(parsed.ast, env);
  if (opts.expect === 'boolean' && diagnostics.length === 0 && !isBooleanish(type)) {
    diagnostics.push({
      code: 'expr-not-boolean',
      message: `A condition must be a boolean, got ${typeToString(type)}`,
      start: parsed.ast.start,
      end: parsed.ast.end,
      hint: 'Compare the value, e.g. x == \'value\', or test presence with exists(x)',
    });
  }
  return { ast: parsed.ast, type, diagnostics };
}
