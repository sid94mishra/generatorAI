import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseExpression, walkExpr, type ExprNode } from '../src/index.js';

/** A compact s-expression rendering of an AST, for table tests. */
function show(n: ExprNode): string {
  switch (n.type) {
    case 'literal':
      return JSON.stringify(n.value);
    case 'list':
      return `[${n.items.map(show).join(' ')}]`;
    case 'ident':
      return n.name;
    case 'member':
      return `${show(n.object)}.${n.property}`;
    case 'index':
      return `${show(n.object)}[${show(n.index)}]`;
    case 'call':
      return `${n.callee}(${n.args.map(show).join(' ')})`;
    case 'lambda':
      return `(${n.param} => ${show(n.body)})`;
    case 'unary':
      return `(not ${show(n.operand)})`;
    case 'binary':
    case 'logical':
      return `(${n.op} ${show(n.left)} ${show(n.right)})`;
  }
}

function ast(src: string): string {
  const r = parseExpression(src);
  if (!r.ok) throw new Error(`${src}: ${r.error.message}`);
  return show(r.ast);
}

describe('parseExpression: table', () => {
  const cases: Array<[string, string]> = [
    ['true', 'true'],
    ['null', 'null'],
    ['12', '12'],
    ['-3.5', '-3.5'],
    ['1e3', '1000'],
    ["'a b'", '"a b"'],
    ['"it\'s"', '"it\'s"'],
    ["'line\\nnext'", '"line\\nnext"'],
    ['variables.x', 'variables.x'],
    ['stages.review.output.verdict', 'stages.review.output.verdict'],
    ['list[0]', 'list[0]'],
    ['list[-1]', 'list[-1]'],
    ["obj['k']", 'obj["k"]'],
    ['a == b', '(== a b)'],
    ['a != 1', '(!= a 1)'],
    ['a < b and c >= d', '(and (< a b) (>= c d))'],
    ['a or b and c', '(or a (and b c))'],
    ['(a or b) and c', '(and (or a b) c)'],
    ['a || b && c', '(or a (and b c))'],
    ['not a == b', '(not (== a b))'],
    ['!a and b', '(and (not a) b)'],
    ['not not a', '(not (not a))'],
    ["x in ['a', 'b']", '(in x ["a" "b"])'],
    ['[]', '[]'],
    ['len(x) > 0', '(> len(x) 0)'],
    ["count(c, x => x.severity == 'blocker') == 0", '(== count(c (x => (== x.severity "blocker"))) 0)'],
    ['exists(variables.x)', 'exists(variables.x)'],
    ['a.in.not', 'a.in.not'],
    ['  a  ', 'a'],
  ];
  it.each(cases)('%s', (src, expected) => {
    expect(ast(src)).toBe(expected);
  });

  it('records spans', () => {
    const r = parseExpression('a == bb');
    expect(r.ok && r.ast.start).toBe(0);
    expect(r.ok && r.ast.end).toBe(7);
  });
});

describe('parseExpression: errors', () => {
  const bad: Array<[string, RegExp]> = [
    ['', /empty/],
    ['   ', /empty/],
    ['((( variables.x ==', /Unexpected end|Expected/],
    ['a = b', /Use ==/],
    ['a === b', /strict/],
    ["a == 'x", /Unterminated/],
    ['a AND b', /lower case/],
    ['NOT a', /lower case/],
    ['a == b == c', /chained/],
    ['a + 1', /arithmetic/],
    ['a - 1', /arithmetic/],
    ['x => x', /lambda/],
    ['(a', /\)/],
    ['[a, b', /\]/],
    ['a.', /field name/],
    ['f(', /Unexpected end/],
    ['1abc', /letters/],
    ['a & b', /&&/],
    ["'\\q'", /escape/],
    ['a b', /Unexpected/],
    ['(a)(b)', /named functions/],
  ];
  it.each(bad)('%j is rejected', (src, message) => {
    const r = parseExpression(src);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('expr-syntax');
      expect(r.error.message).toMatch(message);
      expect(r.error.start).toBeGreaterThanOrEqual(0);
      expect(r.error.end).toBeGreaterThanOrEqual(r.error.start);
    }
  });

  it('caps nesting depth instead of overflowing the stack', () => {
    const deep = `${'('.repeat(500)}a${')'.repeat(500)}`;
    const r = parseExpression(deep.slice(0, 2000));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/deeper|longer|Unexpected end/);
    const nots = parseExpression('not '.repeat(400) + 'a');
    expect(nots.ok).toBe(false);
  });

  it('rejects over-long sources', () => {
    const r = parseExpression(`a == '${'x'.repeat(2100)}'`);
    expect(r.ok).toBe(false);
  });
});

describe('parseExpression: fuzz', () => {
  it('never throws on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const r = parseExpression(s);
        expect(typeof r.ok).toBe('boolean');
      }),
      { numRuns: 3000 },
    );
  });

  it('never throws on token soup', () => {
    const token = fc.constantFrom(
      'a', 'b.c', '1', '-2', "'s'", 'true', 'null', '(', ')', '[', ']', ',', '.', '==', '!=', '<', '>=', 'in',
      'and', 'or', 'not', '!', '&&', '||', 'len(', 'count(', '=>', 'x', ' ', '"', '\\',
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 40 }), (tokens) => {
        const r = parseExpression(tokens.join(' '));
        if (r.ok) {
          // Every node span lies inside the source.
          walkExpr(r.ast, (n) => {
            expect(n.start).toBeGreaterThanOrEqual(0);
            expect(n.end).toBeGreaterThanOrEqual(n.start);
          });
        }
      }),
      { numRuns: 3000 },
    );
  });
});
