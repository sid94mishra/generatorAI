import { describe, expect, it, vi } from 'vitest';

import { WorkflowPreprocessor, repositoryFromInputs, type PreprocessorContext } from '../WorkflowPreprocessor.js';

const cloneStep = {
  type: 'clone_repo',
  name: 'Clone repository',
  config: { type: 'clone_repo', repoAlias: 'target' },
  failOnError: true,
  order: 0,
} as const;

function harness() {
  const cloneToDirectory = vi.fn(async (_url: string, dir: string) => dir);
  const preprocessor = new WorkflowPreprocessor(
    { cloneToDirectory, clone: vi.fn() } as never,
    {} as never,
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
  return { preprocessor, cloneToDirectory, context };
}

describe('clone_repo from the run inputs', () => {
  it('clones the repository URL the run was started with', async () => {
    const { preprocessor, cloneToDirectory, context } = harness();
    const ctx = context({ git_url: 'https://example.com/shop.git', branch: 'dev' });

    const [result] = await preprocessor.execute([cloneStep as never], ctx);

    expect(result?.success).toBe(true);
    expect(cloneToDirectory).toHaveBeenCalledWith('https://example.com/shop.git', '/runs/run-1/target', 'dev');
    expect(ctx.variables['repo_path_target']).toBe('/runs/run-1/target');
  });

  it('reuses a checkout the run already has for the alias', async () => {
    const { preprocessor, cloneToDirectory, context } = harness();
    const [result] = await preprocessor.execute(
      [cloneStep as never],
      context({ repo_path_target: '/ws/source/shop', git_url: 'https://example.com/shop.git' }),
    );

    expect(result?.success).toBe(true);
    expect(result?.output).toBe('/ws/source/shop');
    expect(cloneToDirectory).not.toHaveBeenCalled();
  });

  it('says what is missing when there is nothing to clone', async () => {
    const { preprocessor, context } = harness();
    await expect(preprocessor.execute([cloneStep as never], context({}))).rejects.toThrow(/Enter a repository URL/);
  });
});

describe('repositoryFromInputs', () => {
  it('reads the common repository input names and ignores blanks', () => {
    expect(repositoryFromInputs('target', { repo_url: ' git@x:y.git ', branch: ' ' })).toEqual({
      alias: 'target',
      url: 'git@x:y.git',
    });
    expect(repositoryFromInputs('target', { git_url: '' })).toBeNull();
  });
});
