// Workflow post-processing routed through the source-control flow (doc §5).
//
// The flow service is faked: what is under test is the ROUTING — what the
// preprocessor asks for per repo, what a success reports, and what a
// conflict / blocked result does to the step (and to the steps after it).

import { describe, it, expect, vi } from 'vitest';
import type { PostProcessingStep } from '@generatorai/workflow-spec';
import type {
  ILogger,
  RepoReadiness,
  ScmFlowRequest,
  ScmFlowResult,
} from '@generatorai/shared';
import {
  WorkflowPreprocessor,
  type PreprocessorContext,
  type WorkflowScmFlowPort,
} from '../WorkflowPreprocessor.js';
import type { GitManager } from '../../infrastructure/GitManager.js';
import type { IScriptRunner } from '../../domain/ports/IScriptRunner.js';
import type { EventBus } from '../../events/EventBus.js';

const logger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => logger,
};

function readiness(alias: string, partial: Partial<RepoReadiness> = {}): RepoReadiness {
  return {
    alias,
    repoDir: `/run/${alias}`,
    isRepo: true,
    hasRemote: true,
    connected: true,
    branch: `generatorai/run-1234abcd-${alias}`,
    detached: false,
    defaultBranch: 'main',
    onDefaultBranch: false,
    dirty: true,
    changedFiles: 2,
    ahead: 1,
    behind: 0,
    hasUpstream: true,
    mergeInProgress: false,
    conflictedFiles: [],
    openPullRequest: null,
    can: { commit: true, push: true, pullRequest: true },
    reasons: {},
    ...partial,
  };
}

function context(partial: Partial<PreprocessorContext> = {}): PreprocessorContext {
  return {
    workflowRunId: 'run-1234abcd',
    workflowName: 'Nightly refactor',
    variables: { __workflowRunId: 'run-1234abcd' },
    clonedPaths: { api: '/run/api', web: '/run/web' },
    featureBranches: { api: 'generatorai/run-1234abcd-api', web: 'generatorai/run-1234abcd-web' },
    baseBranches: { api: 'develop' },
    runWorkspaceDir: '/run',
    ...partial,
  };
}

function commitStep(config: Record<string, unknown> = {}): PostProcessingStep {
  return {
    name: 'Auto-commit changes',
    config: {
      type: 'commit_and_push',
      commitMessage: 'feat: workflow changes (run {{run.id}})',
      generateMessage: true,
      push: true,
      ...config,
    },
    failOnError: true,
  } as PostProcessingStep;
}

function prStep(config: Record<string, unknown> = {}): PostProcessingStep {
  return {
    name: 'Auto-create Pull Request',
    config: {
      type: 'create_pr',
      title: 'GeneratorAI: Workflow changes',
      body: 'Automated changes.',
      generateText: true,
      ...config,
    },
    failOnError: true,
  } as PostProcessingStep;
}

function build(flow: WorkflowScmFlowPort) {
  const emitGlobal = vi.fn(async () => undefined);
  const eventBus = { emitGlobal } as unknown as EventBus;
  const preprocessor = new WorkflowPreprocessor(
    {} as GitManager,
    {} as IScriptRunner,
    eventBus,
    logger,
    flow,
  );
  return { preprocessor, emitGlobal };
}

describe('workflow post-processing → SourceControlFlowService', () => {
  it('commits + pushes every run repo, one flow call each, with the workflow hint', async () => {
    const calls: Array<{ alias: string; repoDir: string; request: ScmFlowRequest }> = [];
    const flow: WorkflowScmFlowPort = {
      async run({ alias, repoDir, request }) {
        calls.push({ alias, repoDir, request });
        return {
          status: 'ok',
          alias,
          steps: [{ id: 'commit', status: 'done' }],
          commit: { sha: `${alias}0000000`, message: 'feat: do it' },
          pushed: true,
          readiness: readiness(alias),
        };
      },
    };
    const { preprocessor } = build(flow);

    const results = await preprocessor.executePostProcessing([commitStep()], context());

    expect(calls.map((c) => c.alias)).toEqual(['api', 'web']);
    expect(calls[0]?.repoDir).toBe('/run/api');
    expect(calls[0]?.request).toMatchObject({
      alias: 'api',
      commit: { generate: true },
      push: true,
    });
    expect(calls[0]?.request.hint).toBe('Nightly refactor (workflow run run-1234abcd)');

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.output).toContain('api: committed api00000');
    expect(results[0]?.output).toContain('and pushed');
    expect(results[0]?.scm).toHaveLength(2);
  });

  it('honours push:false — commit locally, leave the branch alone', async () => {
    const requests: ScmFlowRequest[] = [];
    const flow: WorkflowScmFlowPort = {
      async run({ alias, request }) {
        requests.push(request);
        return { status: 'ok', alias, steps: [], readiness: readiness(alias) };
      },
    };
    const { preprocessor } = build(flow);
    await preprocessor.executePostProcessing(
      [commitStep({ push: false })],
      context({ clonedPaths: { api: '/run/api' } }),
    );
    expect(requests[0]?.push).toBe(false);
  });

  it('opens a PR against the codebase default branch and reports url + number', async () => {
    const requests: ScmFlowRequest[] = [];
    const flow: WorkflowScmFlowPort = {
      async run({ alias, request }) {
        requests.push(request);
        return {
          status: 'ok',
          alias,
          steps: [{ id: 'pull_request', status: 'done' }],
          pushed: true,
          pullRequest: {
            provider: 'github',
            number: 42,
            url: `https://github.com/acme/${alias}/pull/42`,
            title: 'Workflow changes',
            state: 'open',
            head: `generatorai/run-1234abcd-${alias}`,
            base: 'develop',
          },
          readiness: readiness(alias),
        };
      },
    };
    const { preprocessor } = build(flow);

    const results = await preprocessor.executePostProcessing(
      [prStep()],
      context({ clonedPaths: { api: '/run/api' } }),
    );

    expect(requests[0]).toMatchObject({
      alias: 'api',
      push: true,
      pullRequest: { generate: true, base: 'develop' },
    });
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.output).toBe('PR #42 created for api: https://github.com/acme/api/pull/42');
    expect(results[0]?.scm?.[0]?.pullRequest?.number).toBe(42);
  });

  it('an explicit baseBranch on the step beats the codebase default', async () => {
    const requests: ScmFlowRequest[] = [];
    const flow: WorkflowScmFlowPort = {
      async run({ alias, request }) {
        requests.push(request);
        return { status: 'ok', alias, steps: [], readiness: readiness(alias) };
      },
    };
    const { preprocessor } = build(flow);
    await preprocessor.executePostProcessing(
      [prStep({ baseBranch: 'release/3.x' })],
      context({ clonedPaths: { api: '/run/api' } }),
    );
    expect(requests[0]?.pullRequest?.base).toBe('release/3.x');
  });

  it('conflicts fail the step, attach the report, and leave no half-applied merge', async () => {
    const flow: WorkflowScmFlowPort = {
      async run({ alias }) {
        return {
          status: 'conflicts',
          alias,
          steps: [
            { id: 'readiness', status: 'done' },
            { id: 'sync', status: 'failed', detail: 'Merge conflicts with origin/develop' },
          ],
          conflicts: {
            base: 'develop',
            head: `generatorai/run-1234abcd-${alias}`,
            files: ['src/a.ts', 'src/b.ts'],
            // The flow's dry-run guarantee: the working tree was never touched.
            mergeStarted: false,
          },
          readiness: readiness(alias),
        };
      },
    };
    const { preprocessor, emitGlobal } = build(flow);

    const results = await preprocessor.executePostProcessing(
      [commitStep(), prStep()],
      context({ clonedPaths: { api: '/run/api' } }),
    );

    // The commit step fails, and the PR step never runs behind it.
    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toContain('merge conflicts with develop in 2 file(s)');
    const report = results[0]?.scm?.[0]?.conflicts;
    expect(report?.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(report?.mergeStarted).toBe(false);

    const kinds = emitGlobal.mock.calls.map(
      (c) => (c as unknown as [{ kind: string }])[0].kind,
    );
    expect(kinds).toContain('workflow_run.postprocessing_step_failed');
  });

  it('a blocked result fails the step with the reason', async () => {
    const flow: WorkflowScmFlowPort = {
      async run({ alias }) {
        return {
          status: 'blocked',
          alias,
          steps: [
            {
              id: 'readiness',
              status: 'blocked',
              detail: 'Remote host github.com is not connected — connect it in Settings → Source Control',
            },
          ],
          readiness: readiness(alias, { connected: false }),
        };
      },
    };
    const { preprocessor } = build(flow);

    const results = await preprocessor.executePostProcessing(
      [prStep()],
      context({ clonedPaths: { api: '/run/api' } }),
    );

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toContain('is not connected');
    expect(results[0]?.scm?.[0]?.status).toBe('blocked');
  });

  it('stops at the FIRST failing repo rather than committing the rest', async () => {
    const seen: string[] = [];
    const flow: WorkflowScmFlowPort = {
      async run({ alias }) {
        seen.push(alias);
        return alias === 'api'
          ? {
              status: 'failed',
              alias,
              error: 'push rejected',
              steps: [{ id: 'push', status: 'failed', detail: 'push rejected' }],
              readiness: readiness(alias),
            }
          : { status: 'ok', alias, steps: [], readiness: readiness(alias) };
      },
    };
    const { preprocessor } = build(flow);

    const results = await preprocessor.executePostProcessing([commitStep()], context());

    expect(seen).toEqual(['api']);
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toBe('api: push rejected');
  });
});
