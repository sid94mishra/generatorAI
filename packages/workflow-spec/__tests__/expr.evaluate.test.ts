import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { conditionHolds, evaluate, evaluateSource, parseExpression } from '../src/index.js';

const scope = {
  variables: { env: 'prod', count: 5, flag: false, sflag: 'false', zip: '02134', tags: ['a', 'b'], nested: { deep: { x: 1 } } },
  stages: {
    review: {
      status: 'completed',
      output: {
        verdict: 'approve',
        score: 8,
        comments: [
          { id: 'C1', severity: 'blocker', body: 'x' },
          { id: 'C2', severity: 'nit', body: 'y' },
        ],
      },
    },
  },
  parent: { status: 'failed' },
};

function value(src: string): unknown {
  const r = evaluateSource(src, scope);
  if (!r.ok) throw new Error(`${src}: ${r.error.message}`);
  return r.value;
}

describe('evaluate: table', () => {
  const cases: Array<[string, unknown]> = [
    ["variables.env == 'prod'", true],
    ["variables.env != 'prod'", false],
    ['variables.count > 3', true],
    ['variables.count >= 5 and variables.count <= 5', true],
    ["'a' < 'b'", true],
    ['variables.flag == false', true],
    ['not variables.flag', true],
    ['!variables.flag', true],
    // strict equality: no string/number coercion
    ['variables.zip == 2134', false],
    ["variables.zip == '02134'", true],
    ["variables.count == '5'", false],
    // a string is not a boolean: not 'false' is null (unknown), never true
    ['not variables.sflag', null],
    // null paths and comparisons with null
    ['variables.missing', null],
    ['variables.missing.deeper', null],
    ['variables.missing == null', false],
    ['variables.missing != null', false],
    ['variables.missing > 3', false],
    ['not variables.missing', null],
    ['exists(variables.missing)', false],
    ['exists(variables.env)', true],
    // three-valued logic
    ['variables.missing and false', false],
    ['variables.missing and true', null],
    ['variables.missing or true', true],
    ['variables.missing or false', null],
    // paths and indexes
    ['variables.nested.deep.x', 1],
    ["variables.nested['deep'].x", 1],
    ['variables.tags[0]', 'a'],
    ['variables.tags[-1]', 'b'],
    ['variables.tags[5]', null],
    ['variables.tags[1.5]', null],
    // in
    ["'a' in variables.tags", true],
    ["'z' in variables.tags", false],
    ["'ro' in variables.env", true],
    ["variables.env in ['dev', 'prod']", true],
    // functions
    ['len(variables.tags)', 2],
    ['len(variables.env)', 4],
    ['len(variables.missing)', null],
    ["count(stages.review.output.comments, c => c.severity in ['blocker', 'major'])", 1],
    ["lower('ABC')", 'abc'],
    ['lower(5)', null],
    // deep equality
    ["variables.tags == ['a', 'b']", true],
    ["variables.tags == ['b', 'a']", false],
    // stage outputs and parent
    ["stages.review.output.verdict == 'approve'", true],
    ['stages.review.output.score >= 8', true],
    ["parent.status == 'failed'", true],
    // prototype keys are not reachable
    ['variables.constructor', null],
    ['variables.__proto__', null],
    // lists
    ['[1, 2] == [1, 2]', true],
    ['len([])', 0],
  ];
  it.each(cases)('%s → %j', (src, expected) => {
    expect(value(src)).toEqual(expected);
  });
});

describe('conditionHolds', () => {
  it('holds only for exactly true', () => {
    expect(conditionHolds("variables.env == 'prod'", scope)).toBe(true);
    expect(conditionHolds('variables.missing', scope)).toBe(false);
    expect(conditionHolds('variables.count', scope)).toBe(false);
    expect(conditionHolds('((( variables.x ==', scope)).toBe(false);
  });

  it('accepts a parsed AST', () => {
    const r = parseExpression('variables.count == 5');
    expect(r.ok && conditionHolds(r.ast, scope)).toBe(true);
  });
});

describe('evaluate: bounds', () => {
  it('stops at the step budget', () => {
    const src = `count(variables.big, x => count(variables.big, y => x == y) > 0) > 0`;
    const big = Array.from({ length: 2000 }, (_, i) => i);
    const r = evaluateSource(src, { variables: { big } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('expr_budget_exceeded');
    const ok = evaluateSource(src, { variables: { big: [1, 2, 3] } });
    expect(ok.ok && ok.value).toBe(true);
  });

  it('charges produced and compared values, failing a blow-up fast', () => {
    const L = '[' + Array(100).fill(0).join(',') + ']';
    let expr = `map(${L}, a => ${L})`;
    for (let k = 0; k < 2; k++) expr = `map([${expr}], b => map(${L}, a => b))`;
    const t = Date.now();
    const r = evaluateSource(`len(unique(map([${expr}], c => map(${L}, a => c))[0])) > 0`, {});
    expect(Date.now() - t).toBeLessThan(1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('expr_budget_exceeded');
    const items = Array.from({ length: 500 }, (_, i) => ({ id: i % 50, tags: ['a', 'b'] }));
    const ok = evaluateSource('len(unique(sort(variables.items, x => [x.id]), x => x.id)) == 50', { variables: { items } });
    expect(ok.ok && ok.value).toBe(true);
  });

  it('respects a custom budget', () => {
    const r = parseExpression('a and b and c and d');
    expect(r.ok).toBe(true);
    if (r.ok) expect(evaluate(r.ast, { a: true, b: true, c: true, d: true }, { stepBudget: 3 }).ok).toBe(false);
  });

  it('returns a syntax error instead of throwing', () => {
    const r = evaluateSource('a ==', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('expr_syntax');
  });

  it('normalises scope values (undefined, NaN, Dates)', () => {
    expect(evaluateSource('variables.u', { variables: { u: undefined } })).toEqual({ ok: true, value: null });
    expect(evaluateSource('variables.n', { variables: { n: Number.NaN } })).toEqual({ ok: true, value: null });
    expect(evaluateSource('len(variables.d)', { variables: { d: new Date(0) } })).toEqual({ ok: true, value: 24 });
  });
});

describe('evaluate: properties', () => {
  const json = fc.letrec((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc.string({ maxLength: 5 }),
      fc.array(tie('value'), { maxLength: 3 }),
      fc.dictionary(fc.string({ maxLength: 3 }), tie('value'), { maxKeys: 3 }),
    ),
  })).value;

  it('== is reflexive for non-null values and != is its negation', () => {
    fc.assert(
      fc.property(json, json, (a, b) => {
        const s = { variables: { a, b } };
        const eq = evaluateSource('variables.a == variables.b', s);
        const ne = evaluateSource('variables.a != variables.b', s);
        expect(eq.ok && ne.ok).toBe(true);
        if (!eq.ok || !ne.ok) return;
        if (a === null || b === null) {
          expect(eq.value).toBe(false);
          expect(ne.value).toBe(false);
        } else {
          expect(ne.value).toBe(!eq.value);
          expect(evaluateSource('variables.a == variables.a', s)).toEqual({ ok: true, value: true });
        }
      }),
      { numRuns: 500 },
    );
  });

  it('never throws on arbitrary scopes', () => {
    const exprs = ['variables.a.b[0]', 'len(variables.a)', 'count(variables.a, x => x == 1)', "variables.a in variables.b", 'not variables.a or variables.b'];
    fc.assert(
      fc.property(json, json, fc.constantFrom(...exprs), (a, b, src) => {
        const r = evaluateSource(src, { variables: { a, b } });
        expect(r.ok).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
