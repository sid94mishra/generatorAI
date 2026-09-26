import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { T, checkTemplate, nullable, parseTemplate, renderTemplate, templateVariableNames, type TypeEnv } from '../src/index.js';

const scope = {
  variables: { issue: 'BUG-1', count: 3, empty: '', none: null },
  stages: {
    review: { output: { comments: [{ id: 'C1', body: 'Fix null deref' }, { id: 'C2', title: 'Rename' }], tags: ['a', 'b'] } },
  },
  run: { codebases: { app: { path: '/w/app', branch: 'main' } } },
};

function render(t: string): string {
  const r = renderTemplate(t, scope);
  if (!r.ok) throw new Error(r.error.message);
  return r.text;
}

describe('renderTemplate', () => {
  it.each<[string, string]>([
    ['plain text', 'plain text'],
    ['Fix {{variables.issue}} now', 'Fix BUG-1 now'],
    ['Fix {{ issue }} now', 'Fix BUG-1 now'],
    ['n={{count}}', 'n=3'],
    ['[{{variables.missing}}]', '[]'],
    ['[{{none}}]', '[]'],
    ['{{run.codebases.app.path}}', '/w/app'],
    ['{{ stages.review.output.tags | json }}', '[\n  "a",\n  "b"\n]'],
    ['{{ stages.review.output.tags }}', '[\n  "a",\n  "b"\n]'],
    ['{{ stages.review.output.comments | bullets }}', '- [C1] Fix null deref\n- [C2] Rename'],
    ['{{ stages.review.output.tags | bullets }}', '- a\n- b'],
    ['{{ stages.review.output.tags | yaml }}', '- a\n- b'],
    ['{{ stages.nope.output | bullets }}', ''],
    ['{{#if variables.issue}}yes{{else}}no{{/if}}', 'yes'],
    ['{{#if empty}}yes{{else}}no{{/if}}', 'no'],
    ['{{#if variables.empty}}yes{{else}}no{{/if}}', 'no'],
    ['{{#if variables.missing}}yes{{/if}}!', '!'],
    ['{{#if count > 2}}big{{/if}}', ''],
    ['{{#if variables.count > 2}}big{{/if}}', 'big'],
    ['{{#if variables.issue}}a{{#if variables.none}}b{{else}}c{{/if}}d{{/if}}', 'acd'],
    ['literal \\{{ braces }}', 'literal {{ braces }}'],
    ["{{ 'a || b' }}", 'a || b'],
    ["{{ 'x}}y' }}", 'x}}y'],
    ['{{ len(stages.review.output.tags) }}', '2'],
  ])('%j', (t, expected) => {
    expect(render(t)).toBe(expected);
  });

  it('returns syntax errors instead of throwing', () => {
    for (const bad of ['{{ open', '{{#if x}}no end', '{{/if}}', '{{else}}', '{{ }}', '{{ a == }}', '{{#each x}}{{/each}}', '{{ | json }}']) {
      const r = renderTemplate(bad, scope);
      expect(r.ok, bad).toBe(false);
    }
  });

  it('never throws on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (s) => {
        const r = renderTemplate(s, scope);
        expect(typeof r.ok).toBe('boolean');
      }),
      { numRuns: 2000 },
    );
  });

  it('renders text without placeholders unchanged', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }).filter((s) => !s.includes('{{') && !s.includes('\\')), (s) => {
        expect(render(s)).toBe(s);
      }),
      { numRuns: 500 },
    );
  });
});

describe('checkTemplate', () => {
  const env: TypeEnv = {
    roots: {
      variables: T.object({ issue: T.string, count: T.number }),
      stages: T.object({ review: T.object({ output: nullable(T.object({ comments: T.list(T.string) })) }) }),
      run: T.object({ codebases: T.object({}, T.object({ path: T.string })) }),
    },
    variableNames: new Set(['issue', 'count']),
  };
  const codes = (t: string) => checkTemplate(t, env, { variableNames: new Set(['issue', 'count']) }).map((d) => d.code);

  it('accepts declared variables, sugar and scope paths', () => {
    expect(codes('Fix {{issue}} ({{variables.count}}) {{stages.review.output.comments | bullets}}')).toEqual([]);
    expect(codes('{{run.codebases.app.path}}')).toEqual([]);
  });

  it('rejects a bare name that is not declared, with a codebase hint for repo_path_*', () => {
    const d = checkTemplate('{{repo_path_app}}', env, { variableNames: new Set(['issue']) });
    expect(d.map((x) => x.code)).toEqual(['template-unknown-variable']);
    expect(d[0]!.hint).toContain('run.codebases.app.path');
    expect(codes('{{isue}}')).toEqual(['template-unknown-variable']);
  });

  it('reports unknown filters, bad filter inputs and syntax', () => {
    expect(codes('{{ issue | bulets }}')).toEqual(['template-unknown-filter']);
    expect(codes('{{ variables.count | bullets }}')).toEqual(['expr-type']);
    expect(codes('{{#if issue}}x')).toEqual(['template-syntax']);
    expect(codes('{{ variables.issue == }}')).toEqual(['expr-syntax']);
    expect(codes('{{ stages.revew.output }}')).toEqual(['expr-unknown-field']);
  });

  it('locates diagnostics in the template text', () => {
    const t = 'Hello {{ stages.revew.output }}';
    const d = checkTemplate(t, env, { variableNames: new Set() })[0]!;
    expect(t.slice(d.start, d.end)).toBe('stages.revew');
  });
});

describe('template helpers', () => {
  it('lists referenced variables', () => {
    expect(templateVariableNames('{{a}} {{ variables.b | json }} {{#if variables.c}}{{/if}}').sort()).toEqual(['a', 'b', 'c']);
  });

  it('parses nested blocks', () => {
    const { nodes, diagnostics } = parseTemplate('{{#if a}}x{{else}}y{{/if}}');
    expect(diagnostics).toEqual([]);
    expect(nodes[0]!.type).toBe('if');
  });
});
