// ────────────────────────────────────────────────────────────────
// Expression v2 parser: a hand-written lexer and a Pratt parser.
//
// The grammar (see grammar.ts for the documented table):
//   literals     'text' "text" 12 -3.5 1e3 true false null [a, b]
//   paths        variables.x  stages.review.output.verdict  list[0]
//   calls        len(x)  count(list, c => c.severity == 'blocker')
//   comparison   == != < <= > >= in        (non-associative)
//   logic        not / !   and / &&   or / ||
//
// Functions are resolved by name at type-check time from a registry, so a
// new function never needs a grammar change. There is no infix arithmetic.
//
// `parseExpression` never throws: any input yields either an AST or one
// located diagnostic. Nesting is capped so a hostile input cannot overflow
// the stack.
// ────────────────────────────────────────────────────────────────

import { MAX_EXPRESSION_LENGTH } from '../constants.js';
import type { ComparisonOp, ExprDiagnostic, ExprNode } from './ast.js';

type TokenType = 'number' | 'string' | 'ident' | 'keyword' | 'punct' | 'op' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  /** Decoded value of string and number tokens. */
  literal?: string | number;
  start: number;
  end: number;
}

const KEYWORDS = new Set(['true', 'false', 'null', 'and', 'or', 'not', 'in']);
const MAX_DEPTH = 64;

export type ParseResult = { ok: true; ast: ExprNode } | { ok: false; error: ExprDiagnostic };

class ParseError extends Error {
  constructor(readonly diagnostic: ExprDiagnostic) {
    super(diagnostic.message);
  }
}

function fail(start: number, end: number, message: string, hint?: string): never {
  throw new ParseError({ code: 'expr-syntax', start, end, message, ...(hint ? { hint } : {}) });
}

// ── Lexer ────────────────────────────────────────────────────────

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}
function isIdentPart(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9');
}
function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    const start = i;
    if (isDigit(c)) {
      while (isDigit(src[i])) i++;
      if (src[i] === '.' && isDigit(src[i + 1])) {
        i++;
        while (isDigit(src[i])) i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        let j = i + 1;
        if (src[j] === '+' || src[j] === '-') j++;
        if (isDigit(src[j])) {
          i = j;
          while (isDigit(src[i])) i++;
        }
      }
      if (i < src.length && isIdentStart(src[i]!)) fail(start, i + 1, 'A number cannot be followed by letters');
      const text = src.slice(start, i);
      tokens.push({ type: 'number', value: text, literal: Number(text), start, end: i });
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      let out = '';
      let closed = false;
      while (i < src.length) {
        const ch = src[i]!;
        if (ch === c) {
          closed = true;
          i++;
          break;
        }
        if (ch === '\\') {
          const nx = src[i + 1];
          if (nx === undefined) break;
          i += 2;
          switch (nx) {
            case 'n':
              out += '\n';
              break;
            case 't':
              out += '\t';
              break;
            case 'r':
              out += '\r';
              break;
            case 'u': {
              const hex = src.slice(i, i + 4);
              if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(i - 2, i + 4, 'Invalid \\u escape (expected 4 hex digits)');
              out += String.fromCharCode(parseInt(hex, 16));
              i += 4;
              break;
            }
            case '\\':
            case "'":
            case '"':
              out += nx;
              break;
            default:
              fail(i - 2, i, `Unknown escape \\${nx}`, 'Supported escapes: \\n \\t \\r \\uXXXX \\\\ \\\' \\"');
          }
          continue;
        }
        out += ch;
        i++;
      }
      if (!closed) fail(start, src.length, 'Unterminated string');
      tokens.push({ type: 'string', value: src.slice(start, i), literal: out, start, end: i });
      continue;
    }
    if (isIdentStart(c)) {
      while (i < src.length && isIdentPart(src[i]!)) i++;
      const word = src.slice(start, i);
      tokens.push({ type: KEYWORDS.has(word) ? 'keyword' : 'ident', value: word, start, end: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '=>' || two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      if (two === '==' && src[i + 2] === '=') fail(i, i + 3, 'Use == (equality is always strict)');
      if (two === '!=' && src[i + 2] === '=') fail(i, i + 3, 'Use != (equality is always strict)');
      tokens.push({ type: two === '=>' ? 'punct' : 'op', value: two, start, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '<' || c === '>' || c === '!') {
      tokens.push({ type: 'op', value: c, start, end: i + 1 });
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === '[' || c === ']' || c === ',' || c === '.') {
      tokens.push({ type: 'punct', value: c, start, end: i + 1 });
      i++;
      continue;
    }
    if (c === '=') fail(i, i + 1, 'Use == to compare');
    if (c === '&' || c === '|') fail(i, i + 1, `Use ${c}${c} (or ${c === '&' ? 'and' : 'or'})`);
    if (c === '+' || c === '*' || c === '/' || c === '%') {
      fail(i, i + 1, 'Expressions have no arithmetic', 'Use functions such as len() and count() instead');
    }
    if (c === '-') {
      tokens.push({ type: 'op', value: '-', start, end: i + 1 });
      i++;
      continue;
    }
    fail(i, i + 1, `Unexpected character '${c}'`);
  }
  tokens.push({ type: 'eof', value: '', start: src.length, end: src.length });
  return tokens;
}

// ── Parser ───────────────────────────────────────────────────────

const COMPARISON_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const BP = { or: 10, and: 20, not: 30, comparison: 40, postfix: 80 } as const;

class Parser {
  private pos = 0;
  private depth = 0;
  /** End offset of the last parenthesised group: `(f)(x)` is not a call. */
  private parenEnd = -1;

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }
  private next(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }
  private is(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return (t.type === 'punct' || t.type === 'op' || t.type === 'keyword') && t.value === value;
  }
  private expect(value: string, what: string): Token {
    const t = this.peek();
    if (!this.is(value)) {
      if ((t.type === 'op' && t.value === '-') || (t.type === 'ident' && ['AND', 'OR', 'NOT'].includes(t.value))) this.unexpected(t);
      fail(t.start, Math.max(t.end, t.start + 1), `Expected ${what}`);
    }
    return this.next();
  }

  parseRoot(): ExprNode {
    const node = this.parse(0);
    const t = this.peek();
    if (t.type !== 'eof') this.unexpected(t, 'Combine conditions with and / or');
    return node;
  }

  private unexpected(t: Token, hint?: string): never {
    if (t.type === 'ident' && ['AND', 'OR', 'NOT'].includes(t.value)) {
      fail(t.start, t.end, `Unexpected '${t.value}': logical operators are lower case (${t.value.toLowerCase()})`);
    }
    if (t.type === 'op' && t.value === '-') {
      fail(t.start, t.end, 'Expressions have no arithmetic', 'Use functions such as len() and count() instead');
    }
    if (t.type === 'eof') fail(t.start, t.end, 'Unexpected end of expression');
    return fail(t.start, t.end, `Unexpected '${t.value}'`, hint);
  }

  private parse(minBp: number): ExprNode {
    if (++this.depth > MAX_DEPTH) {
      const t = this.peek();
      fail(t.start, t.end, `Expression nests deeper than ${MAX_DEPTH} levels`);
    }
    let left = this.nud();
    for (;;) {
      const t = this.peek();
      const op = this.infixOp(t);
      if (!op) break;
      if (op.bp <= minBp) break;
      left = this.led(left, op.kind);
    }
    this.depth--;
    return left;
  }

  private infixOp(t: Token): { kind: string; bp: number } | null {
    if (t.type === 'keyword') {
      if (t.value === 'or') return { kind: 'or', bp: BP.or };
      if (t.value === 'and') return { kind: 'and', bp: BP.and };
      if (t.value === 'in') return { kind: 'in', bp: BP.comparison };
      return null;
    }
    if (t.type === 'op') {
      if (t.value === '||') return { kind: 'or', bp: BP.or };
      if (t.value === '&&') return { kind: 'and', bp: BP.and };
      if (COMPARISON_OPS.has(t.value) || t.value === '<' || t.value === '>') return { kind: t.value, bp: BP.comparison };
      return null;
    }
    if (t.type === 'punct' && (t.value === '.' || t.value === '[' || t.value === '(')) {
      return { kind: t.value, bp: BP.postfix };
    }
    return null;
  }

  private nud(): ExprNode {
    const t = this.next();
    switch (t.type) {
      case 'number':
        return { type: 'literal', value: t.literal as number, start: t.start, end: t.end };
      case 'string':
        return { type: 'literal', value: t.literal as string, start: t.start, end: t.end };
      case 'keyword':
        if (t.value === 'true' || t.value === 'false') {
          return { type: 'literal', value: t.value === 'true', start: t.start, end: t.end };
        }
        if (t.value === 'null') return { type: 'literal', value: null, start: t.start, end: t.end };
        if (t.value === 'not') return this.notExpr(t.start);
        return fail(t.start, t.end, `Unexpected '${t.value}'`);
      case 'ident':
        if (this.is('=>')) {
          return fail(t.start, this.peek().end, 'A lambda (x => …) is only allowed as a function argument');
        }
        if (['AND', 'OR', 'NOT'].includes(t.value)) return this.unexpected(t);
        return { type: 'ident', name: t.value, start: t.start, end: t.end };
      case 'op':
        if (t.value === '!') return this.notExpr(t.start);
        if (t.value === '-') {
          const n = this.peek();
          if (n.type === 'number' && n.start === t.end) {
            this.next();
            return { type: 'literal', value: -(n.literal as number), start: t.start, end: n.end };
          }
          return fail(t.start, t.end, 'Expressions have no arithmetic', 'Only number literals can be negative, e.g. -1');
        }
        return fail(t.start, t.end, `Unexpected '${t.value}'`);
      case 'punct':
        if (t.value === '(') {
          const inner = this.parse(0);
          const close = this.expect(')', "')'");
          this.parenEnd = close.end;
          return { ...inner, start: t.start, end: close.end };
        }
        if (t.value === '[') return this.listExpr(t.start);
        return fail(t.start, t.end, `Unexpected '${t.value}'`);
      case 'eof':
        return fail(t.start, t.end, 'Unexpected end of expression');
    }
  }

  private notExpr(start: number): ExprNode {
    const operand = this.parse(BP.not);
    return { type: 'unary', op: 'not', operand, start, end: operand.end };
  }

  private listExpr(start: number): ExprNode {
    const items: ExprNode[] = [];
    if (!this.is(']')) {
      for (;;) {
        items.push(this.parse(0));
        if (!this.is(',')) break;
        this.next();
      }
    }
    const close = this.expect(']', "']' to close the list");
    return { type: 'list', items, start, end: close.end };
  }

  private led(left: ExprNode, kind: string): ExprNode {
    const opTok = this.next();
    switch (kind) {
      case '.': {
        const name = this.next();
        if (name.type !== 'ident' && name.type !== 'keyword') fail(name.start, name.end, "Expected a field name after '.'");
        return { type: 'member', object: left, property: name.value, start: left.start, end: name.end };
      }
      case '[': {
        const index = this.parse(0);
        const close = this.expect(']', "']'");
        return { type: 'index', object: left, index, start: left.start, end: close.end };
      }
      case '(': {
        if (left.type !== 'ident' || left.end === this.parenEnd) fail(left.start, opTok.end, 'Only named functions can be called');
        const args: ExprNode[] = [];
        if (!this.is(')')) {
          for (;;) {
            args.push(this.argument());
            if (!this.is(',')) break;
            this.next();
          }
        }
        const close = this.expect(')', "')' to close the call");
        return { type: 'call', callee: left.name, args, start: left.start, end: close.end };
      }
      case 'and':
      case 'or': {
        const bp = kind === 'and' ? BP.and : BP.or;
        const right = this.parse(bp);
        return { type: 'logical', op: kind, left, right, start: left.start, end: right.end };
      }
      default: {
        const right = this.parse(BP.comparison);
        const next = this.peek();
        const chained = this.infixOp(next);
        if (chained && chained.bp === BP.comparison) {
          fail(next.start, next.end, 'Comparisons cannot be chained', 'Join them with and');
        }
        return { type: 'binary', op: kind as ComparisonOp, left, right, start: left.start, end: right.end };
      }
    }
  }

  private argument(): ExprNode {
    const t = this.peek();
    if (t.type === 'ident' && this.is('=>', 1)) {
      this.next();
      this.next();
      const body = this.parse(0);
      return { type: 'lambda', param: t.value, body, start: t.start, end: body.end };
    }
    return this.parse(0);
  }
}

/** Parse an expression. Never throws. */
export function parseExpression(src: string): ParseResult {
  try {
    if (typeof src !== 'string') {
      return { ok: false, error: { code: 'expr-syntax', start: 0, end: 0, message: 'Expression must be a string' } };
    }
    if (src.length > MAX_EXPRESSION_LENGTH) {
      return {
        ok: false,
        error: { code: 'expr-syntax', start: 0, end: src.length, message: `Expression is longer than ${MAX_EXPRESSION_LENGTH} characters` },
      };
    }
    if (src.trim() === '') {
      return { ok: false, error: { code: 'expr-syntax', start: 0, end: src.length, message: 'Expression is empty' } };
    }
    const tokens = tokenize(src);
    return { ok: true, ast: new Parser(tokens).parseRoot() };
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: err.diagnostic };
    return {
      ok: false,
      error: { code: 'expr-syntax', start: 0, end: 0, message: `Unparseable expression: ${(err as Error)?.message ?? String(err)}` },
    };
  }
}
