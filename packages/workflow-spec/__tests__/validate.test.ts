import { describe, expect, it } from 'vitest';
import { ENGINE_LEVEL, VALIDATION_CODES, validateWorkflow, type ValidationIssue } from '../src/index.js';
import { agent, codes, graph } from './fixtures.js';

const reviewSchema = {
  type: 'object',
  required: ['verdict', 'comments'],
  properties: {
    verdict: { enum: ['approve', 'changes_requested'] },
    comments: { type: 'array', items: { type: 'object', properties: { severity: { enum: ['blocker', 'nit'] } } } },
  },
};

const find = (issues: ValidationIssue[], code: string) => issues.find((i) => i.code === code);

describe('a valid workflow', () => {
  it('passes every layer and returns the parsed graph', () => {
    const r = validateWorkflow(
      graph(
        [
          agent('plan'),
          agent('review', { output: { format: 'json', schema: reviewSchema } }),
          agent('fix', {
            guard: "stages.review.output.verdict == 'changes_requested'",
            prompts: [{ label: 'fix', text: 'Fix {{issue}}: {{ stages.review.output.comments | json }}' }],
            context: { from: ['review'], mode: 'structured' },
          }),
        ],
        [['plan', 'review'], { from: 'review', to: 'fix', on: 'completion', when: "parent.status == 'completed'" }],
        { variables: [{ name: 'issue', type: 'string', label: 'Issue', required: true }] },
      ),
    );
    expect(r.issues).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.graph?.stages.map((s) => s.key)).toEqual(['plan', 'review', 'fix']);
  });

  it('defaults to the current engine level', () => {
    expect(ENGINE_LEVEL).toBe('v1');
    const r = validateWorkflow(graph([agent('a', { repair: {} })]));
    expect(codes(r)).toEqual(['engine-unsupported']);
  });
});

describe('F-13: broken definitions are rejected', () => {
  it('duplicate stage keys', () => {
    const r = validateWorkflow(graph([agent('a'), agent('a')]));
    expect(r.valid).toBe(false);
    expect(find(r.issues, 'duplicate-key')?.path).toBe('/stages/1/key');
  });

  it('an unparseable condition', () => {
    const r = validateWorkflow(graph([agent('a'), agent('b', { guard: '((( variables.x ==' })], [['a', 'b']]));
    expect(r.valid).toBe(false);
    expect(find(r.issues, 'expr-syntax')).toMatchObject({ path: '/stages/1/guard', stageKey: 'b' });
  });

  it('an empty expression', () => {
    const r = validateWorkflow(graph([agent('a', { guard: '' })]));
    expect(r.valid).toBe(false);
    expect(find(r.issues, 'schema')?.path).toBe('/stages/0/guard');
  });

  it('a context source that does not exist', () => {
    const r = validateWorkflow(graph([agent('a', { context: { from: ['nope'] } })]));
    expect(find(r.issues, 'unknown-context-source')?.path).toBe('/stages/0/context/from/0');
  });

  it('a context source that is not upstream', () => {
    const r = validateWorkflow(graph([agent('a', { context: { from: ['b'] } }), agent('b')], [['a', 'b']]));
    expect(codes(r, 'error')).toEqual(['context-source-not-upstream']);
  });

  it('a condition referencing a stage that has not run (W-31)', () => {
    const r = validateWorkflow(graph([agent('a', { guard: "stages.b.status == 'completed'" }), agent('b')]));
    expect(codes(r, 'error')).toEqual(['expr-stage-not-upstream']);
    const r2 = validateWorkflow(graph([agent('a', { guard: "stages.R.status == 'completed'" })]));
    expect(codes(r2, 'error')).toEqual(['expr-unknown-stage']);
  });
});

describe('graph layer', () => {
  it('rejects self edges, unknown ends, duplicate pairs (W-30) and cycles', () => {
    expect(codes(validateWorkflow(graph([agent('a')], [['a', 'a']])))).toContain('self-edge');
    expect(codes(validateWorkflow(graph([agent('a')], [['a', 'z']])))).toContain('unknown-edge-target');
    expect(codes(validateWorkflow(graph([agent('a')], [['z', 'a']])))).toContain('unknown-edge-source');
    const pair = validateWorkflow(graph([agent('a'), agent('b')], [['a', 'b'], { from: 'a', to: 'b', on: 'failure' }]));
    expect(find(pair.issues, 'edge-pair')?.path).toBe('/edges/1');
    const cyc = validateWorkflow(graph([agent('a'), agent('b'), agent('c'), agent('d')], [['a', 'b'], ['b', 'c'], ['c', 'b'], ['c', 'd']]));
    const cycle = find(cyc.issues, 'cycle')!;
    expect(cycle.message).toMatch(/through: b, c$/);
  });

  it('warns on an empty graph', () => {
    const r = validateWorkflow(graph([]));
    expect(r.valid).toBe(true);
    expect(codes(r, 'warning')).toEqual(['empty-graph']);
  });

  it('rejects a parentKey without a container', () => {
    expect(codes(validateWorkflow(graph([agent('a'), agent('b', { parentKey: 'a' })])))).toContain('parent-not-container');
    expect(codes(validateWorkflow(graph([agent('b', { parentKey: 'zz' })])))).toContain('unknown-parent');
  });
});

describe('references layer', () => {
  it('checks variables', () => {
    const vars = (v: unknown[]) => codes(validateWorkflow(graph([agent('a')], [], { variables: v })));
    expect(vars([{ name: 'x', type: 'string', label: 'x' }, { name: 'x', type: 'string', label: 'x' }])).toContain('duplicate-variable');
    expect(vars([{ name: 'c', type: 'choice', label: 'c' }])).toContain('choice-without-options');
    expect(vars([{ name: 'c', type: 'string', label: 'c', options: ['a'] }])).toContain('options-without-choice');
    expect(vars([{ name: 'n', type: 'number', label: 'n', defaultValue: '3' }])).toContain('variable-default-type');
    expect(vars([{ name: 'c', type: 'choice', label: 'c', options: ['a'], defaultValue: 'b' }])).toContain('variable-default-type');
    expect(vars([{ name: 'n', type: 'number', label: 'n', defaultValue: 3 }])).toEqual([]);
  });

  it('checks output contracts and regex rules (RV-21)', () => {
    expect(codes(validateWorkflow(graph([agent('a', { output: { schema: { type: 'object' } } })])))).toContain('schema-requires-json');
    expect(codes(validateWorkflow(graph([agent('a', { output: { format: 'json' } })])), 'warning')).toContain('json-without-schema');
    expect(codes(validateWorkflow(graph([agent('a', { output: { format: 'json', schema: { type: 'strange' } } })])))).toContain(
      'invalid-output-schema',
    );
    const regex = (pattern: string) => codes(validateWorkflow(graph([agent('a', { output: { rules: [{ type: 'regex', pattern }] } })])));
    expect(regex('(a)\\1')).toContain('invalid-regex');
    expect(regex('(?=x)')).toContain('invalid-regex');
    expect(regex('^done: \\d+$')).toEqual([]);
  });

  it('checks joins', () => {
    const r = validateWorkflow(graph([agent('a'), agent('b'), agent('c', { join: { mode: 'n_of_m', n: 3 } })], [['a', 'c'], ['b', 'c']]), {
      engine: 'v2',
    });
    expect(codes(r)).toEqual(['join-n-exceeds-predecessors']);
    const w = validateWorkflow(graph([agent('a'), agent('c', { join: { mode: 'any' } })], [['a', 'c']]), { engine: 'v2' });
    expect(codes(w, 'warning')).toEqual(['join-single-predecessor']);
  });

  it('warns about fields that only matter inside loops', () => {
    const r = validateWorkflow(graph([agent('a', { sessionReuse: 'continue', followUpPrompts: [{ label: 'f', text: 'again' }] })]), {
      engine: 'v2',
    });
    expect(codes(r, 'warning').sort()).toEqual(['follow-up-outside-loop', 'session-continue-outside-loop']);
  });

  it('warns on a stage with nothing to do, unless an agent drives it', () => {
    expect(codes(validateWorkflow(graph([agent('a', { prompts: [] })])), 'warning')).toEqual(['stage-without-prompts']);
    expect(codes(validateWorkflow(graph([agent('a', { prompts: [], session: { agentRef: 'global:coder' } })])))).toEqual([]);
  });

  it('checks hook ids, codebase aliases and preprocessing variables', () => {
    const hook = { id: 'h', name: 'h', phase: 'pre_run', type: 'script', config: { type: 'script', command: 'echo' } };
    expect(codes(validateWorkflow(graph([agent('a', { hooks: [hook, hook] })])))).toContain('duplicate-hook-id');
    const lifecycle = {
      codebaseAliases: ['app'],
      preprocessingSteps: [
        { name: 'c', config: { type: 'clone_repo', repoAlias: 'web' } },
        { name: 'v', config: { type: 'validate_input', variableName: 'ghost', rules: [{ type: 'regex', pattern: '(', message: 'm' }] } },
      ],
    };
    const r = validateWorkflow(graph([agent('a')], [], { lifecycle }));
    expect(codes(r).sort()).toEqual(['invalid-regex', 'unknown-codebase-alias', 'unknown-input-variable']);
  });
});

describe('expressions and templates layer', () => {
  const vars = { variables: [{ name: 'env', type: 'choice', label: 'env', options: ['dev', 'prod'], required: true }] };

  it('type-checks guards against variables and output schemas', () => {
    const stages = [agent('review', { output: { format: 'json', schema: reviewSchema } }), agent('b')];
    const check = (guard: string) => codes(validateWorkflow(graph([stages[0]!, { ...stages[1]!, guard }], [['review', 'b']], vars)), 'error');
    expect(check("variables.env == 'prod'")).toEqual([]);
    expect(check("env == 'prod'")).toEqual(['expr-unknown-root']);
    expect(check("variables.env == 'staging'")).toEqual(['expr-enum-mismatch']);
    expect(check("stages.review.output.verdict == 'aprove'")).toEqual(['expr-enum-mismatch']);
    expect(check("stages.review.output.verdit == 'approve'")).toEqual(['expr-unknown-field']);
    expect(check("count(stages.review.output.comments, c => c.severity == 'blocker') == 0")).toEqual([]);
    expect(check('variables.env')).toEqual(['expr-not-boolean']);
    expect(check("parent.status == 'completed'")).toEqual(['expr-scope-unavailable']);
    expect(check('loop.iteration > 0')).toEqual(['expr-scope-unavailable']);
  });

  it('gives edge conditions the source stage and parent.status', () => {
    const r = validateWorkflow(
      graph([agent('a', { output: { format: 'json', schema: reviewSchema } }), agent('b')], [
        { from: 'a', to: 'b', when: "parent.status == 'completed' and stages.a.output.verdict == 'approve'" },
      ]),
    );
    expect(r.issues).toEqual([]);
    const bad = validateWorkflow(graph([agent('a'), agent('b')], [{ from: 'a', to: 'b', when: "stages.b.status == 'completed'" }]));
    expect(find(bad.issues, 'expr-stage-not-upstream')?.path).toBe('/edges/0/when');
  });

  it('checks templates: sugar, scopes, filters', () => {
    const t = (text: string) =>
      codes(validateWorkflow(graph([agent('a'), agent('b', { prompts: [{ label: 'p', text }] })], [['a', 'b']], vars)), 'error');
    expect(t('Deploy to {{env}} after {{ stages.a.output }}')).toEqual([]);
    expect(t('{{envv}}')).toEqual(['template-unknown-variable']);
    expect(t('{{repo_path_app}}')).toEqual(['template-unknown-variable']);
    expect(t('{{ stages.a.output | bulets }}')).toEqual(['template-unknown-filter']);
    expect(t('{{#if env}}x')).toEqual(['template-syntax']);
    expect(t('{{ run.codebases.app.path }}')).toEqual([]);
    expect(t('{{ stages.c.output }}')).toEqual(['expr-unknown-stage']);
  });

  it('knows variables set by preprocessing', () => {
    const r = validateWorkflow(
      graph([agent('a', { prompts: [{ label: 'p', text: 'Use {{branch_name}}' }] })], [], {
        lifecycle: { preprocessingSteps: [{ name: 's', config: { type: 'set_variable', variableName: 'branch_name', value: 'x' } }] },
      }),
    );
    expect(r.issues).toEqual([]);
  });

  it('checks preprocessing conditions over variables only', () => {
    const step = (condition: string) => ({ name: 'c', config: { type: 'conditional', condition, thenSteps: [] } });
    const run = (condition: string) =>
      codes(validateWorkflow(graph([agent('a')], [], { ...vars, lifecycle: { preprocessingSteps: [step(condition)] } })), 'error');
    expect(run("variables.env == 'dev'")).toEqual([]);
    expect(run('git_url')).toEqual(['expr-unknown-root']);
    expect(run("stages.a.status == 'completed'")).toEqual(['expr-scope-unavailable']);
  });

  it('checks workflow outputs and post-processing templates against every stage', () => {
    const r = validateWorkflow(
      graph([agent('a', { output: { format: 'json', schema: reviewSchema } })], [], {
        outputs: { verdict: 'stages.a.output.verdict', bad: 'stages.zz.output' },
        lifecycle: { postProcessing: { steps: [{ name: 'pr', config: { type: 'create_pr', title: 'Fix {{ stages.a.output.verdict }}', body: '{{nope}}' } }] } },
      }),
      { engine: 'v2' },
    );
    expect(r.issues.map((i) => [i.code, i.path])).toEqual([
      ['expr-unknown-stage', '/workflow/outputs/bad'],
      ['template-unknown-variable', '/workflow/lifecycle/postProcessing/steps/0/config/body'],
    ]);
  });
});

describe('security layer', () => {
  const scriptHook = (config: Record<string, unknown>) => ({ id: 'h', name: 'h', phase: 'pre_run', type: 'script', config: { type: 'script', ...config } });

  it('rejects templates in commands and arguments', () => {
    const r = validateWorkflow(graph([agent('a', { hooks: [scriptHook({ command: 'deploy {{variables.env}}', args: ['--x', '{{env}}'] })] })]));
    expect(r.issues.filter((i) => i.code === 'template-in-command').map((i) => i.path)).toEqual([
      '/stages/0/hooks/0/config/command',
      '/stages/0/hooks/0/config/args/1',
    ]);
    const rule = validateWorkflow(graph([agent('a', { output: { rules: [{ type: 'custom_script', command: 'node', args: ['{{x}}'] }] } })]));
    expect(codes(rule)).toContain('template-in-command');
    const pre = validateWorkflow(
      graph([agent('a')], [], { lifecycle: { preprocessingSteps: [{ name: 's', config: { type: 'run_script', script: 'echo {{x}}' } }] } }),
    );
    expect(find(pre.issues, 'template-in-command')?.path).toBe('/workflow/lifecycle/preprocessingSteps/0/config/script');
    const mcp = validateWorkflow(graph([agent('a', { session: { mcp: { servers: { s: { type: 'stdio', command: 'x', args: ['{{y}}'] } } } } })]));
    expect(find(mcp.issues, 'template-in-command')?.path).toBe('/stages/0/session/mcp/servers/s/args/0');
  });

  it('allows templates of non-secret values in env', () => {
    const r = validateWorkflow(
      graph([agent('a', { hooks: [scriptHook({ command: 'deploy', env: { TARGET: '{{variables.env}}' } })] })], [], {
        variables: [{ name: 'env', type: 'string', label: 'env' }],
      }),
    );
    expect(r.issues).toEqual([]);
  });

  it('requires secretref for provider keys and rejects literal secrets', () => {
    const provider = { name: 'p', baseUrl: 'https://api.example.com', apiKey: 'sk-live-abcdefghijklmnopqrstuvwxyz' };
    expect(codes(validateWorkflow(graph([agent('a', { session: { provider } })])))).toContain('secret-not-secretref');
    expect(codes(validateWorkflow(graph([agent('a')], [], { session: { provider: { ...provider, apiKey: 'secretref:openai' } } }), { engine: 'v2' }))).toEqual([]);
    const env = (e: Record<string, string>) => codes(validateWorkflow(graph([agent('a', { hooks: [scriptHook({ command: 'x', env: e })] })])));
    expect(env({ GITHUB_TOKEN: 'abc123' })).toContain('secret-literal');
    expect(env({ ANYTHING: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' })).toContain('secret-literal');
    expect(env({ GITHUB_TOKEN: 'secretref:gh' })).toEqual([]);
    expect(env({ NODE_ENV: 'production' })).toEqual([]);
    const header = validateWorkflow(
      graph([agent('a')], [], {
        hooks: [
          {
            id: 'h',
            name: 'h',
            phase: 'on_run_complete',
            type: 'http',
            config: { type: 'http', url: 'https://x.test/h', method: 'POST', headers: { Authorization: 'Bearer abc' } },
          },
        ],
      }),
    );
    expect(find(header.issues, 'secret-literal')?.path).toBe('/workflow/hooks/0/config/headers/Authorization');
  });
});

describe('engine capability gate', () => {
  const v1 = (g: unknown) => validateWorkflow(g, { engine: 'v1' });
  const v2 = (g: unknown) => validateWorkflow(g, { engine: 'v2' });

  it.each<[string, unknown]>([
    ['join any', graph([agent('a'), agent('b'), agent('c', { join: { mode: 'any' } })], [['a', 'c'], ['b', 'c']])],
    ['repair', graph([agent('a', { repair: {} })])],
    ['onExhausted pause', graph([agent('a', { onExhausted: 'pause' })])],
    ['sessionReuse continue', graph([agent('a', { sessionReuse: 'continue' })])],
    ['sessionGroup', graph([agent('a', { sessionGroup: 'g' })])],
    ['stage budget', graph([agent('a', { budget: { maxTurns: 5 } })])],
    ['workflow budget', graph([agent('a')], [], { budget: { maxTurns: 5 } })],
    ['timeouts.idleMs', graph([agent('a', { timeouts: { idleMs: 5000 } })])],
    ['timeouts.queueMs', graph([agent('a', { timeouts: { queueMs: 5000 } })])],
    ['timeouts.totalMs', graph([agent('a', { timeouts: { totalMs: 5000 } })])],
    ['extraction tool', graph([agent('a', { output: { extraction: 'tool' } })])],
    ['compensate', graph([agent('a', { compensate: [{ name: 'undo', config: { type: 'restore_checkpoint' } }] })])],
    ['onExit', graph([agent('a')], [], { onExit: [{ name: 'x', config: { type: 'function', handlerName: 'h' } }] })],
    ['onFailure', graph([agent('a')], [], { onFailure: [{ name: 'x', config: { type: 'function', handlerName: 'h' } }] })],
    ['maxParallel', graph([agent('a')], [], { maxParallel: 2 })],
    ['handlesFailure', graph([agent('a'), agent('b')], [{ from: 'a', to: 'b', on: 'always', handlesFailure: true }])],
    ['retry.maxDelayMs', graph([agent('a', { retry: { maxDelayMs: 1000 } })])],
    ['retry.jitter', graph([agent('a', { retry: { jitter: 'none' } })])],
    ['retry.retryOn', graph([agent('a', { retry: { retryOn: ['overloaded'] } })])],
    ['retry.mode', graph([agent('a', { retry: { mode: 'restart' } })])],
    ['retry.restoreCheckpointOnRestart', graph([agent('a', { retry: { restoreCheckpointOnRestart: false } })])],
    ['approval.allowChanges', graph([agent('a', { approval: { allowChanges: false } })])],
    ['approval.maxRounds', graph([agent('a', { approval: { maxRounds: 1 } })])],
    ['workflow outputs', graph([agent('a')], [], { outputs: { done: "stages.a.status == 'completed'" } })],
  ])('%s is rejected on v1 and accepted on v2', (_what, g) => {
    const r1 = v1(g);
    expect(codes(r1, 'error')).toEqual(['engine-unsupported']);
    expect(find(r1.issues, 'engine-unsupported')!.hint).toMatch(/engine upgrade/);
    expect(codes(v2(g), 'error')).toEqual([]);
  });

  it('accepts provider credentials and MCP secret references on v1: the session composer resolves them (P02)', () => {
    const provider = { name: 'p', baseUrl: 'https://api.example.com', apiKey: 'secretref:k' };
    expect(v1(graph([agent('a', { session: { provider } })])).issues).toEqual([]);
    const mcp = { servers: { gh: { type: 'http' as const, url: 'https://mcp.test', headers: { Authorization: 'secretref:gh' } } } };
    expect(v1(graph([agent('a')], [], { session: { mcp } })).issues).toEqual([]);
  });

  it('accepts what v1 executes: attempt timeouts, retries, approval, fail on exhaustion', () => {
    const r = v1(
      graph([agent('a', { timeouts: { attemptMs: 60_000 }, retry: { maxAttempts: 3 }, approval: {}, onExhausted: 'fail', output: { rules: [] } })]),
    );
    expect(r.issues).toEqual([]);
  });
});

describe('issue shape', () => {
  it('emits only documented codes, JSON pointers and stage keys', () => {
    const r = validateWorkflow(
      graph(
        [agent('a', { guard: 'nope', context: { from: ['zz'] }, hooks: [{ id: 'h', name: 'h', phase: 'pre_run', type: 'script', config: { type: 'script', command: '{{x}}' } }] }), agent('a')],
        [['a', 'q']],
        { variables: [{ name: 'c', type: 'choice', label: 'c' }] },
      ),
    );
    expect(r.valid).toBe(false);
    for (const i of r.issues) {
      expect(Object.keys(VALIDATION_CODES)).toContain(i.code);
      expect(i.path === '' || i.path.startsWith('/')).toBe(true);
      expect(['error', 'warning']).toContain(i.severity);
      expect(i.severity).toBe(VALIDATION_CODES[i.code as keyof typeof VALIDATION_CODES].severity);
    }
    expect(r.issues.filter((i) => i.path.startsWith('/stages/0')).every((i) => i.stageKey === 'a')).toBe(true);
  });

  it('escapes pointer tokens', () => {
    const r = validateWorkflow(graph([agent('a', { session: { mcp: { servers: { 'a/b': { type: 'stdio', command: '{{x}}' } } } } })]));
    expect(find(r.issues, 'template-in-command')?.path).toBe('/stages/0/session/mcp/servers/a~1b/command');
  });
});
