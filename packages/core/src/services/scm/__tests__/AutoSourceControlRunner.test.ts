// The post-turn commit hook (doc §5). Everything here is a fake: the point is
// the DECISIONS — which mounts run, what the flow is asked for, and what
// reaches the transcript — not git.

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  AgentEvent,
  ChatSourceControlOptions,
  RepoReadiness,
  ScmFlowRequest,
  ScmFlowResult,
} from '@generatorai/shared';
import { AutoSourceControlRunner, isSilent } from '../AutoSourceControlRunner.js';
import { REASON_NOTHING_TO_COMMIT, notConnectedReason } from '../RepoReadinessService.js';
import { silentLogger } from './helpers.js';

// ── Fixtures ─────────────────────────────────────────────────────

function readiness(partial: Partial<RepoReadiness> = {}): RepoReadiness {
  return {
    alias: 'app',
    repoDir: '/w/app',
    isRepo: true,
    hasRemote: true,
    connected: true,
    branch: 'generatorai/work-abc123',
    detached: false,
    defaultBranch: 'main',
    onDefaultBranch: false,
    dirty: true,
    changedFiles: 3,
    ahead: 0,
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

function okResult(partial: Partial<ScmFlowResult> = {}): ScmFlowResult {
  return {
    status: 'ok',
    alias: 'app',
    steps: [
      { id: 'readiness', status: 'done' },
      { id: 'commit', status: 'done', detail: 'abc12345 — feat: do the thing' },
    ],
    commit: { sha: 'abc12345def', message: 'feat: do the thing' },
    readiness: readiness(),
    ...partial,
  };
}

function blockedResult(reason: string): ScmFlowResult {
  return {
    status: 'blocked',
    alias: 'app',
    steps: [{ id: 'readiness', status: 'blocked', detail: reason }],
    readiness: readiness({ connected: false, can: { commit: true, push: true, pullRequest: false } }),
  };
}

const OPTIONS: ChatSourceControlOptions = {
  autoCommit: true,
  autoPush: false,
  autoPullRequest: false,
};

// ── Harness ──────────────────────────────────────────────────────

interface Harness {
  runner: AutoSourceControlRunner;
  events: AgentEvent[];
  flowCalls: Array<{ alias: string; repoDir: string; request: ScmFlowRequest; hint?: string }>;
  readinessCalls: string[];
}

function harness(opts: {
  readinessFor?: (alias: string) => RepoReadiness;
  flowFor?: (alias: string) => ScmFlowResult | Promise<ScmFlowResult>;
} = {}): Harness {
  const events: AgentEvent[] = [];
  const flowCalls: Harness['flowCalls'] = [];
  const readinessCalls: string[] = [];

  const runner = new AutoSourceControlRunner({
    readiness: {
      async readiness({ alias }) {
        readinessCalls.push(alias);
        return opts.readinessFor?.(alias) ?? readiness({ alias });
      },
    },
    flow: {
      async run({ alias, repoDir, request, context }) {
        flowCalls.push({
          alias,
          repoDir,
          request,
          ...(context?.hint !== undefined ? { hint: context.hint } : {}),
        });
        return opts.flowFor?.(alias) ?? okResult({ alias });
      },
    },
    emit: (event) => {
      events.push(event);
    },
    logger: silentLogger,
  });

  return { runner, events, flowCalls, readinessCalls };
}

const MOUNTS = [
  { alias: 'app', dir: '/w/app' },
  { alias: 'docs', dir: '/w/docs' },
];

function input(overrides: Record<string, unknown> = {}) {
  return {
    chatId: 'chat-1',
    turnId: 'turn-1',
    workspaceId: 'ws-1',
    chatName: 'Fix login',
    options: OPTIONS,
    mounts: MOUNTS,
    hint: 'fix the token refresh race',
    ...overrides,
  } as Parameters<AutoSourceControlRunner['run']>[0];
}

// ── Tests ────────────────────────────────────────────────────────

describe('AutoSourceControlRunner', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('emits chat.scm.result on the session scope, one per mount that changed', async () => {
    await h.runner.run(input());

    expect(h.events).toHaveLength(2);
    const [first] = h.events;
    expect(first?.kind).toBe('chat.scm.result');
    expect(first?.data).toMatchObject({
      chatId: 'chat-1',
      turnId: 'turn-1',
      alias: 'app',
    });
    const result = (first?.data as { result: ScmFlowResult }).result;
    expect(result.status).toBe('ok');
    expect(result.commit?.sha).toBe('abc12345def');
  });

  it('asks the flow to commit with a generated message and passes the turn hint', async () => {
    await h.runner.run(input());

    expect(h.flowCalls[0]?.request).toMatchObject({
      alias: 'app',
      commit: { generate: true },
      push: false,
      hint: 'fix the token refresh race',
    });
    expect(h.flowCalls[0]?.request.pullRequest).toBeUndefined();
    expect(h.flowCalls[0]?.hint).toBe('fix the token refresh race');
  });

  it('pushes and opens a PR when both are enabled, with base and draft', async () => {
    await h.runner.run(
      input({
        options: {
          autoCommit: true,
          autoPush: false,
          autoPullRequest: true,
          base: 'develop',
          draft: true,
        } satisfies ChatSourceControlOptions,
      }),
    );

    expect(h.flowCalls[0]?.request).toMatchObject({
      push: true,
      pullRequest: { generate: true, base: 'develop', draft: true },
    });
  });

  it('pushes without a PR when only autoPush is on', async () => {
    await h.runner.run(
      input({ options: { autoCommit: true, autoPush: true, autoPullRequest: false } }),
    );
    expect(h.flowCalls[0]?.request.push).toBe(true);
    expect(h.flowCalls[0]?.request.pullRequest).toBeUndefined();
  });

  it('does nothing at all when autoCommit is off', async () => {
    await h.runner.run(
      input({ options: { autoCommit: false, autoPush: true, autoPullRequest: true } }),
    );
    expect(h.readinessCalls).toEqual([]);
    expect(h.flowCalls).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('skips a mount with no changes and no merge in progress, silently', async () => {
    h = harness({
      readinessFor: (alias) =>
        alias === 'docs'
          ? readiness({ alias, changedFiles: 0, dirty: false })
          : readiness({ alias }),
    });

    await h.runner.run(input());

    expect(h.readinessCalls).toEqual(['app', 'docs']);
    expect(h.flowCalls.map((c) => c.alias)).toEqual(['app']);
    expect(h.events).toHaveLength(1);
  });

  it('still runs a clean mount that has a merge in progress', async () => {
    h = harness({
      readinessFor: (alias) =>
        readiness({ alias, changedFiles: 0, dirty: false, mergeInProgress: true }),
    });

    await h.runner.run(input());
    expect(h.flowCalls.map((c) => c.alias)).toEqual(['app', 'docs']);
  });

  it('emits a blocked result so the transcript can say why no PR was possible', async () => {
    const reason = notConnectedReason('github.com');
    h = harness({ flowFor: () => blockedResult(reason) });

    await h.runner.run(input());

    expect(h.events).toHaveLength(2);
    const result = (h.events[0]?.data as { result: ScmFlowResult }).result;
    expect(result.status).toBe('blocked');
    expect(result.steps[0]?.detail).toBe(reason);
  });

  it('stays silent when the only blocking reason is "Nothing to commit"', async () => {
    h = harness({ flowFor: () => blockedResult(REASON_NOTHING_TO_COMMIT) });

    await h.runner.run(input());
    expect(h.flowCalls).toHaveLength(2);
    expect(h.events).toEqual([]);
  });

  it('emits conflicts', async () => {
    h = harness({
      flowFor: (alias) => ({
        status: 'conflicts',
        alias,
        steps: [
          { id: 'readiness', status: 'done' },
          { id: 'sync', status: 'failed', detail: 'Merge conflicts with origin/main' },
        ],
        conflicts: { base: 'main', head: 'work', files: ['src/a.ts'], mergeStarted: false },
        readiness: readiness({ alias }),
      }),
    });

    await h.runner.run(input());
    const result = (h.events[0]?.data as { result: ScmFlowResult }).result;
    expect(result.status).toBe('conflicts');
    expect(result.conflicts?.mergeStarted).toBe(false);
  });

  it('runs mounts sequentially', async () => {
    const order: string[] = [];
    const runner = new AutoSourceControlRunner({
      readiness: { async readiness({ alias }) { return readiness({ alias }); } },
      flow: {
        async run({ alias }) {
          order.push(`start:${alias}`);
          await new Promise((r) => setTimeout(r, 5));
          order.push(`end:${alias}`);
          return okResult({ alias });
        },
      },
      emit: () => {},
      logger: silentLogger,
    });

    await runner.run(input());
    expect(order).toEqual(['start:app', 'end:app', 'start:docs', 'end:docs']);
  });

  it('skips a workspace+alias that already has a flow in progress', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const events: AgentEvent[] = [];

    const runner = new AutoSourceControlRunner({
      readiness: { async readiness({ alias }) { return readiness({ alias }); } },
      flow: {
        async run({ alias }) {
          calls.push(alias);
          await gate;
          return okResult({ alias });
        },
      },
      emit: (e) => {
        events.push(e);
      },
      logger: silentLogger,
    });

    const single = [{ alias: 'app', dir: '/w/app' }];
    const first = runner.run(input({ mounts: single }));
    // Second turn lands while the first flow is still running.
    await runner.run(input({ turnId: 'turn-2', mounts: single }));
    expect(calls).toEqual(['app']);

    release?.();
    await first;
    expect(calls).toEqual(['app']);
    expect(events).toHaveLength(1);

    // The guard releases — a later turn runs normally.
    await runner.run(input({ turnId: 'turn-3', mounts: single }));
    expect(calls).toEqual(['app', 'app']);
  });

  it('never throws when readiness or the bus fails, and keeps going', async () => {
    const events: AgentEvent[] = [];
    const runner = new AutoSourceControlRunner({
      readiness: {
        async readiness({ alias }) {
          if (alias === 'app') throw new Error('git exploded');
          return readiness({ alias });
        },
      },
      flow: { async run({ alias }) { return okResult({ alias }); } },
      emit: (e) => {
        events.push(e);
      },
      logger: silentLogger,
    });

    await expect(runner.run(input())).resolves.toBeDefined();
    expect(events.map((e) => (e.data as { alias: string }).alias)).toEqual(['docs']);
  });
});

describe('isSilent', () => {
  it('is silent for an ok run that only skipped the commit as clean', () => {
    expect(
      isSilent({
        status: 'ok',
        alias: 'app',
        steps: [
          { id: 'readiness', status: 'done' },
          { id: 'commit', status: 'skipped', detail: REASON_NOTHING_TO_COMMIT },
        ],
        readiness: readiness(),
      }),
    ).toBe(true);
  });

  it('is not silent once anything actually happened', () => {
    expect(isSilent(okResult())).toBe(false);
    expect(isSilent(blockedResult('Not a git repository'))).toBe(false);
    expect(
      isSilent({ status: 'failed', alias: 'app', steps: [], error: 'boom', readiness: readiness() }),
    ).toBe(false);
  });
});
