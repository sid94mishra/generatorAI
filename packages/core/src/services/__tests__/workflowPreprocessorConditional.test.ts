// Conditional and validate_input preprocessing steps run on the
// workflow-spec evaluator: Expression v2 conditions and the linear-time
// regex engine (P01 WP-1.5).
import { describe, expect, it, vi } from 'vitest';

import { WorkflowPreprocessor, type PreprocessorContext } from '../WorkflowPreprocessor.js';

function harness() {
  const run = vi.fn(async () => ({ exitCode: 0, stdout: 'ran', stderr: '' }));
  const preprocessor = new WorkflowPreprocessor(
    { cloneToDirectory: vi.fn(), clone: vi.fn() } as never,
    { run } as never,
    { emitGlobal: vi.fn(async () => undefined) } as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    { run: vi.fn() },
  );
  const context = (variables: Record<string, unknown>): PreprocessorContext => ({
    workflowRunId: 'run-1',
    variables,
    clonedPaths: {},
    featureBranches: {},
    runWorkspaceDir: '/runs/run-1',
  });
  return { preprocessor, context };
}

const setVar = (name: string, value: string) => ({
  type: 'set_variable',
  name: `set ${name}`,
  config: { type: 'set_variable', variableName: name, value },
  failOnError: true,
  order: 0,
});

const conditional = (condition: string) =>
  ({
    type: 'conditional',
    name: 'branch',
    config: { type: 'conditional', condition, thenSteps: [setVar('picked', 'then')], elseSteps: [setVar('picked', 'else')] },
    failOnError: true,
    order: 0,
  }) as never;

describe('conditional steps (Expression v2)', () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["variables.env == 'prod'", { env: 'prod' }, 'then'],
    ["variables.env == 'prod'", { env: 'dev' }, 'else'],
    ['len(variables.git_url) > 0', { git_url: 'https://x/y.git' }, 'then'],
    ['len(variables.git_url) > 0', { git_url: '' }, 'else'],
    ['len(variables.git_url) > 0', {}, 'else'],
    ["variables.count == '3'", { count: 3 }, 'else'],
    ['exists(variables.flag) and not variables.flag', { flag: false }, 'then'],
  ])('%s with %j takes the %s branch', async (condition, variables, branch) => {
    const { preprocessor, context } = harness();
    const ctx = context(variables);
    await preprocessor.execute([conditional(condition)], ctx);
    expect(ctx.variables['picked']).toBe(branch);
  });

  it('fails the step on a condition that does not parse, instead of taking the else branch', async () => {
    const { preprocessor, context } = harness();
    const ctx = context({ git_url: 'x' });
    await expect(preprocessor.execute([conditional('git_url AND')], ctx)).rejects.toThrow(/Invalid condition/);
    expect(ctx.variables['picked']).toBeUndefined();
  });
});

describe('validate_input regex rules', () => {
  const validate = (pattern: string) =>
    ({
      type: 'validate_input',
      name: 'check',
      config: { type: 'validate_input', variableName: 'ticket', rules: [{ type: 'regex', value: pattern, message: 'bad ticket' }] },
      failOnError: true,
      order: 0,
    }) as never;

  it('matches with the linear-time engine', async () => {
    const { preprocessor, context } = harness();
    await expect(preprocessor.execute([validate('^[A-Z]+-\\d+$')], context({ ticket: 'BUG-12' }))).resolves.toHaveLength(1);
    await expect(preprocessor.execute([validate('^[A-Z]+-\\d+$')], context({ ticket: 'bug' }))).rejects.toThrow(/bad ticket/);
  });

  it('does not backtrack catastrophically', async () => {
    const { preprocessor, context } = harness();
    const start = Date.now();
    await expect(preprocessor.execute([validate('^(a+)+$')], context({ ticket: `${'a'.repeat(40)}!` }))).rejects.toThrow(/bad ticket/);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('rejects patterns the engine cannot run', async () => {
    const { preprocessor, context } = harness();
    await expect(preprocessor.execute([validate('(a)\\1')], context({ ticket: 'aa' }))).rejects.toThrow(/Invalid pattern/);
  });
});
