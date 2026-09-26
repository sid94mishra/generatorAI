import { describe, expect, it } from 'vitest';
import { T, checkExpression, nullable, typeFromJsonSchema, typeToString, type TypeEnv } from '../src/index.js';

const reviewOutput = typeFromJsonSchema({
  type: 'object',
  required: ['verdict', 'comments'],
  properties: {
    verdict: { enum: ['approve', 'changes_requested'] },
    score: { type: 'number' },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'severity'],
        properties: { id: { type: 'string' }, severity: { enum: ['blocker', 'major', 'minor', 'nit'] } },
      },
    },
  },
});

const env: TypeEnv = {
  roots: {
    variables: T.object({ env: T.enumOf(['dev', 'prod']), count: T.number, flag: T.boolean, name: nullable(T.string), tags: T.list(T.string) }),
    stages: {
      kind: 'object',
      fields: {
        review: T.object({ status: T.string, output: nullable(reviewOutput) }),
        later: T.unavailable('expr-stage-not-upstream', "Stage 'later' has not run yet here"),
      },
      unknown: { code: 'expr-unknown-stage', noun: 'stage' },
    },
    parent: T.unavailable('expr-scope-unavailable', 'parent is only available in an edge `when` expression'),
    loop: T.unavailable('expr-scope-unavailable', 'loop is only available inside a loop body'),
  },
  variableNames: new Set(['env', 'count', 'flag', 'name', 'tags']),
};

function diag(src: string, expect: 'boolean' | 'any' = 'boolean') {
  return checkExpression(src, env, { expect }).diagnostics;
}

describe('typecheck: accepted', () => {
  it.each([
    "variables.env == 'prod'",
    'variables.count > 3 and not variables.flag',
    "stages.review.output.verdict == 'approve'",
    "stages.review.output.verdict in ['approve']",
    'stages.review.output.score >= 8',
    "count(stages.review.output.comments, c => c.severity in ['blocker', 'major']) == 0",
    'len(variables.tags) > 0',
    'exists(variables.name)',
    "'x' in variables.tags",
    "lower(variables.env) == 'prod'",
    'variables.tags[0] == variables.tags[-1]',
  ])('%s', (src) => {
    expect(diag(src)).toEqual([]);
  });
});

describe('typecheck: rejected with a stable code', () => {
  it.each<[string, string, RegExp?]>([
    ["env == 'prod'", 'expr-unknown-root', /variables\.env/],
    ["variable.env == 'x'", 'expr-unknown-root', /variables/],
    ["stages.revew.output.verdict == 'approve'", 'expr-unknown-stage', /review/],
    ["stages.later.status == 'completed'", 'expr-stage-not-upstream'],
    ["stages.review.output.verdit == 'approve'", 'expr-unknown-field', /verdict/],
    ["stages.review.output.verdict == 'aprove'", 'expr-enum-mismatch', /approve/],
    ["variables.env == 'staging'", 'expr-enum-mismatch'],
    ["variables.count == '5'", 'expr-type'],
    ['variables.count > variables.env', 'expr-type'],
    ['not variables.count', 'expr-type'],
    ['variables.count and variables.flag', 'expr-type'],
    ["parent.status == 'failed'", 'expr-scope-unavailable'],
    ['loop.iteration > 1', 'expr-scope-unavailable'],
    ['size(variables.tags) > 0', 'expr-unknown-function', /len/],
    ['len(variables.tags, 1) > 0', 'expr-arity'],
    ['count(variables.tags, 1) > 0', 'expr-type'],
    ['count(variables.tags, variables => true) > 0', 'expr-type'],
    ['len(variables.count) > 0', 'expr-type'],
    ['variables.count', 'expr-not-boolean'],
    ["variables.tags.first == 'a'", 'expr-type'],
    ['variables.count in variables.env', 'expr-type'],
    ['((( variables.x ==', 'expr-syntax'],
    ['variables.name == null', 'expr-type', /not exists/],
    ['variables.name != null', 'expr-type', /exists/],
  ])('%s → %s', (src, code, hint) => {
    const d = diag(src);
    expect(d.map((x) => x.code)).toContain(code);
    if (hint) expect(d.map((x) => `${x.message} ${x.hint ?? ''}`).join(' ')).toMatch(hint);
  });

  it('locates the diagnostic', () => {
    const d = diag("variables.env == 'x' and stages.nope.status == 'completed'");
    const unknown = d.find((x) => x.code === 'expr-unknown-stage')!;
    expect(unknown.start).toBeGreaterThan(20);
  });
});

describe('typeFromJsonSchema', () => {
  it.each<[unknown, string]>([
    [{ type: 'string' }, 'string'],
    [{ type: 'integer' }, 'number'],
    [{ type: ['string', 'null'] }, 'string | null'],
    [{ enum: ['a', 'b'] }, "'a' | 'b'"],
    [{ const: 3 }, 'number'],
    [{ type: 'array', items: { type: 'boolean' } }, 'list<boolean>'],
    [{ anyOf: [{ type: 'string' }, { type: 'number' }] }, 'string | number'],
    [{}, 'any'],
    [{ type: 'object' }, 'any'],
  ])('%j → %s', (schema, expected) => {
    expect(typeToString(typeFromJsonSchema(schema))).toBe(expected);
  });

  it('closes objects with properties unless additionalProperties allows more', () => {
    const closed = typeFromJsonSchema({ type: 'object', properties: { a: { type: 'string' } } });
    const open = typeFromJsonSchema({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true });
    const e = (t: typeof closed): TypeEnv => ({ roots: { o: t } });
    expect(checkExpression("o.b == 'x'", e(closed), { expect: 'boolean' }).diagnostics.map((d) => d.code)).toEqual(['expr-unknown-field']);
    expect(checkExpression("o.b == 'x'", e(open), { expect: 'boolean' }).diagnostics).toEqual([]);
  });
});
