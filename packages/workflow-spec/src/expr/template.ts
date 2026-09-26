// ────────────────────────────────────────────────────────────────
// Templates: prompt text with Expression v2 placeholders.
//
//   {{ variables.issue }}           an expression
//   {{ issue }}                     sugar for {{ variables.issue }}; `issue`
//                                   must be a declared variable
//   {{ stages.review.output.comments | bullets }}   filters
//   {{#if loop.previous}} … {{else}} … {{/if}}     blocks (truthiness)
//   \{{                             a literal "{{"
//
// Rendering never throws; a missing value renders as empty text. Values
// that are structures render as JSON.
// ────────────────────────────────────────────────────────────────

import { RESERVED_ROOTS } from '../constants.js';
import type { ExprDiagnostic, ExprNode } from './ast.js';
import { evaluate, type EvalOptions, type EvalScope } from './evaluate.js';
import { getFilter, listFilters, renderValue } from './filters.js';
import { parseExpression } from './parse.js';
import { typecheckExpression, type TypeEnv } from './typecheck.js';
import { T, type ExprType } from './types.js';
import { getField, isObjectValue, toValue, type Value } from './values.js';
import { closest } from '../util/text.js';

export interface FilterRef {
  name: string;
  start: number;
  end: number;
}

export type TemplateNode =
  | { type: 'text'; text: string }
  | {
      type: 'interp';
      start: number;
      end: number;
      /** Set when the placeholder is a bare name: sugar for variables.<sugar>. */
      sugar?: string;
      /** The parsed expression (absent for sugar or when it failed to parse). */
      expr?: ExprNode;
      exprOffset: number;
      filters: FilterRef[];
    }
  | {
      type: 'if';
      start: number;
      end: number;
      cond?: ExprNode;
      /** Set when the condition is a bare name: sugar for variables.<condSugar>. */
      condSugar?: string;
      condOffset: number;
      then: TemplateNode[];
      else: TemplateNode[];
    };

export interface ParsedTemplate {
  nodes: TemplateNode[];
  /** Structural and expression syntax errors, located in the template text. */
  diagnostics: ExprDiagnostic[];
}

const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set<string>(RESERVED_ROOTS);

/** Index of the `}}` closing a placeholder opened before `from`, skipping quoted strings. */
function findClose(text: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '}' && text[i + 1] === '}') return i;
  }
  return -1;
}

/** Split `expr | f1 | f2` on single top-level pipes (not `||`, not inside strings or brackets). */
function splitFilters(inner: string): Array<{ text: string; offset: number }> {
  const parts: Array<{ text: string; offset: number }> = [];
  let quote: string | null = null;
  let depth = 0;
  let last = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '|' && depth === 0) {
      if (inner[i + 1] === '|' || inner[i - 1] === '|') continue;
      parts.push({ text: inner.slice(last, i), offset: last });
      last = i + 1;
    }
  }
  parts.push({ text: inner.slice(last), offset: last });
  return parts;
}

function leading(s: string): number {
  return s.length - s.trimStart().length;
}

export function parseTemplate(text: string): ParsedTemplate {
  const diagnostics: ExprDiagnostic[] = [];
  const root: TemplateNode[] = [];
  const frames: Array<Extract<TemplateNode, { type: 'if' }> & { inElse: boolean }> = [];
  const target = (): TemplateNode[] => {
    const f = frames[frames.length - 1];
    return f ? (f.inElse ? f.else : f.then) : root;
  };
  let buf = '';
  const flush = () => {
    if (buf) target().push({ type: 'text', text: buf });
    buf = '';
  };

  let i = 0;
  while (i < text.length) {
    if (text.startsWith('\\{{', i)) {
      buf += '{{';
      i += 3;
      continue;
    }
    if (!text.startsWith('{{', i)) {
      buf += text[i];
      i++;
      continue;
    }
    const close = findClose(text, i + 2);
    if (close < 0) {
      diagnostics.push({ code: 'template-syntax', start: i, end: text.length, message: "Unclosed '{{'", hint: 'Write \\{{ for a literal {{' });
      break;
    }
    flush();
    const inner = text.slice(i + 2, close);
    const trimmed = inner.trim();
    const innerStart = i + 2 + leading(inner);
    const end = close + 2;
    if (trimmed.startsWith('#if')) {
      const condSrc = trimmed.slice(3);
      const condOffset = innerStart + 3 + leading(condSrc);
      const node: Extract<TemplateNode, { type: 'if' }> & { inElse: boolean } = {
        type: 'if',
        start: i,
        end,
        condOffset,
        then: [],
        else: [],
        inElse: false,
      };
      if (condSrc.trim() === '' || !/^\s/.test(condSrc)) {
        diagnostics.push({ code: 'template-syntax', start: i, end, message: '{{#if}} needs a condition: {{#if expression}}' });
      } else if (BARE_NAME.test(condSrc.trim()) && !RESERVED.has(condSrc.trim())) {
        node.condSugar = condSrc.trim();
      } else {
        const parsed = parseExpression(condSrc.trim());
        if (parsed.ok) node.cond = parsed.ast;
        else diagnostics.push(shift(parsed.error, condOffset));
      }
      target().push(node);
      frames.push(node);
    } else if (trimmed === 'else') {
      const f = frames[frames.length - 1];
      if (!f || f.inElse) diagnostics.push({ code: 'template-syntax', start: i, end, message: '{{else}} without an open {{#if}}' });
      else f.inElse = true;
    } else if (trimmed === '/if') {
      const f = frames.pop();
      if (!f) diagnostics.push({ code: 'template-syntax', start: i, end, message: '{{/if}} without an open {{#if}}' });
      else f.end = end;
    } else if (trimmed.startsWith('#') || trimmed.startsWith('/')) {
      diagnostics.push({
        code: 'template-syntax',
        start: i,
        end,
        message: `Unknown block '${trimmed.split(/\s/)[0]}'`,
        hint: 'Blocks are {{#if expr}}, {{else}} and {{/if}}',
      });
    } else if (trimmed === '') {
      diagnostics.push({ code: 'template-syntax', start: i, end, message: 'Empty placeholder {{ }}' });
    } else {
      const parts = splitFilters(inner);
      const head = parts[0]!;
      const exprText = head.text.trim();
      const exprOffset = i + 2 + head.offset + leading(head.text);
      const filters: FilterRef[] = parts.slice(1).map((p) => {
        const name = p.text.trim();
        const start = i + 2 + p.offset + leading(p.text);
        return { name, start, end: start + name.length };
      });
      const node: Extract<TemplateNode, { type: 'interp' }> = { type: 'interp', start: i, end, exprOffset, filters };
      if (BARE_NAME.test(exprText) && !RESERVED.has(exprText)) {
        node.sugar = exprText;
      } else if (exprText === '') {
        diagnostics.push({ code: 'template-syntax', start: i, end, message: 'A placeholder needs an expression before its filters' });
      } else {
        const parsed = parseExpression(exprText);
        if (parsed.ok) node.expr = parsed.ast;
        else diagnostics.push(shift(parsed.error, exprOffset));
      }
      for (const f of filters) {
        if (!BARE_NAME.test(f.name)) {
          diagnostics.push({ code: 'template-syntax', start: f.start, end: Math.max(f.end, f.start + 1), message: 'Expected a filter name after |' });
        }
      }
      target().push(node);
    }
    i = end;
  }
  flush();
  for (const f of frames) {
    diagnostics.push({ code: 'template-syntax', start: f.start, end: f.start + 2, message: 'Unclosed {{#if}}: add {{/if}}' });
  }
  return { nodes: root, diagnostics };
}

function shift(d: ExprDiagnostic, offset: number): ExprDiagnostic {
  return { ...d, start: d.start + offset, end: d.end + offset };
}

export interface TemplateCheckOptions {
  /** Declared variable names (plus names set by preprocessing), for the bare-name sugar. */
  variableNames: ReadonlySet<string>;
}

/** Parse and type-check a template. Diagnostics are located in the template text. */
export function checkTemplate(text: string, env: TypeEnv, opts: TemplateCheckOptions): ExprDiagnostic[] {
  const { nodes, diagnostics } = parseTemplate(text);
  const out = [...diagnostics];
  /** Check a bare name (sugar for variables.<name>) and return its type. */
  const sugarType = (name: string, offset: number): ExprType => {
    if (!opts.variableNames.has(name)) {
      const codebase = /^repo_(path|branch)_(.+)$/.exec(name);
      const near = closest(name, opts.variableNames);
      out.push({
        code: 'template-unknown-variable',
        start: offset,
        end: offset + name.length,
        message: `'${name}' is not a declared variable`,
        hint: codebase
          ? `Codebase paths are {{run.codebases.${codebase[2]}.${codebase[1] === 'path' ? 'path' : 'branch'}}}`
          : near
            ? `Did you mean '${near}'?`
            : 'Declare it under workflow.variables, or use a scope path such as stages.<key>.output',
      });
      return T.any;
    }
    const root = env.roots['variables'];
    return root && root.kind === 'object' ? (root.fields[name] ?? T.any) : T.any;
  };
  const visit = (list: TemplateNode[]) => {
    for (const n of list) {
      if (n.type === 'text') continue;
      if (n.type === 'if') {
        if (n.condSugar !== undefined) sugarType(n.condSugar, n.condOffset);
        if (n.cond) out.push(...typecheckExpression(n.cond, env).diagnostics.map((d) => shift(d, n.condOffset)));
        visit(n.then);
        visit(n.else);
        continue;
      }
      let valueType: ExprType = T.any;
      if (n.sugar !== undefined) {
        valueType = sugarType(n.sugar, n.exprOffset);
      } else if (n.expr) {
        const r = typecheckExpression(n.expr, env);
        valueType = r.type;
        out.push(...r.diagnostics.map((d) => shift(d, n.exprOffset)));
      }
      let t = valueType;
      for (const f of n.filters) {
        if (!BARE_NAME.test(f.name)) continue;
        const filter = getFilter(f.name);
        if (!filter) {
          const near = closest(f.name, listFilters().map((x) => x.name));
          out.push({
            code: 'template-unknown-filter',
            start: f.start,
            end: f.end,
            message: `Unknown filter '${f.name}'`,
            hint: near ? `Did you mean '${near}'?` : `Filters: ${listFilters().map((x) => x.name).join(', ')}`,
          });
          continue;
        }
        const problem = filter.check(t);
        if (problem) out.push({ code: 'expr-type', start: f.start, end: f.end, message: problem });
        t = T.string;
      }
    }
  };
  visit(nodes);
  return out;
}

export type RenderResult = { ok: true; text: string } | { ok: false; error: { code: string; message: string } };

/** Handlebars truthiness: null, false, '', 0 and [] are false. */
function truthy(v: Value): boolean {
  if (v === null || v === false || v === '' || v === 0) return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Render a template against a scope. Placeholders whose value is missing
 * render as empty text. Syntax errors (which validation rejects at save
 * time) and evaluation-budget errors are returned, never thrown.
 */
export function renderTemplate(text: string, scope: EvalScope, opts: EvalOptions = {}): RenderResult {
  const { nodes, diagnostics } = parseTemplate(text);
  const first = diagnostics[0];
  if (first) return { ok: false, error: { code: first.code, message: first.message } };
  let out = '';
  const variables = toValue(scope['variables']);
  const run = (list: TemplateNode[]): RenderResult | null => {
    for (const n of list) {
      if (n.type === 'text') {
        out += n.text;
        continue;
      }
      if (n.type === 'if') {
        let cond: Value = null;
        if (n.condSugar !== undefined) {
          cond = isObjectValue(variables) ? getField(variables, n.condSugar) : null;
        } else if (n.cond) {
          const r = evaluate(n.cond, scope, opts);
          if (!r.ok) return { ok: false, error: r.error };
          cond = r.value;
        } else {
          continue;
        }
        const failed = run(truthy(cond) ? n.then : n.else);
        if (failed) return failed;
        continue;
      }
      let v: Value = null;
      if (n.sugar !== undefined) {
        v = isObjectValue(variables) ? getField(variables, n.sugar) : null;
      } else if (n.expr) {
        const r = evaluate(n.expr, scope, opts);
        if (!r.ok) return { ok: false, error: r.error };
        v = r.value;
      }
      if (n.filters.length === 0) {
        out += renderValue(v);
        continue;
      }
      let s: string | null = null;
      for (const f of n.filters) {
        const filter = getFilter(f.name);
        if (!filter) return { ok: false, error: { code: 'template-unknown-filter', message: `Unknown filter '${f.name}'` } };
        s = filter.apply(s === null ? v : s);
      }
      out += s ?? '';
    }
    return null;
  };
  const failed = run(nodes);
  return failed ?? { ok: true, text: out };
}

/** Variable names a template reads, through sugar or `variables.<name>` paths. */
export function templateVariableNames(text: string): string[] {
  const names = new Set<string>();
  const { nodes } = parseTemplate(text);
  const fromExpr = (e: ExprNode | undefined) => {
    if (!e) return;
    const stack: ExprNode[] = [e];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.type === 'member' && n.object.type === 'ident' && n.object.name === 'variables') names.add(n.property);
      if (n.type === 'member' || n.type === 'index') stack.push(n.object);
      if (n.type === 'index') stack.push(n.index);
      if (n.type === 'list') stack.push(...n.items);
      if (n.type === 'call') stack.push(...n.args);
      if (n.type === 'lambda') stack.push(n.body);
      if (n.type === 'unary') stack.push(n.operand);
      if (n.type === 'binary' || n.type === 'logical') stack.push(n.left, n.right);
    }
  };
  const visit = (list: TemplateNode[]) => {
    for (const n of list) {
      if (n.type === 'interp') {
        if (n.sugar) names.add(n.sugar);
        fromExpr(n.expr);
      } else if (n.type === 'if') {
        if (n.condSugar) names.add(n.condSugar);
        fromExpr(n.cond);
        visit(n.then);
        visit(n.else);
      }
    }
  };
  visit(nodes);
  return [...names];
}
