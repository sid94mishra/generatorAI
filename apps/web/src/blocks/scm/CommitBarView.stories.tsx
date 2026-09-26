import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import type { RepoReadiness, ScmFlowResult } from '@generatorai/shared';
import { CommitBarLoading, CommitBarView, type CommitBarViewProps } from './CommitBarView.js';
import { ScmConflictCard } from './ScmConflictCard.js';
import { scmAvailability } from './scmFlow.js';

// Demo readiness — the shape `GET /scm/readiness` returns.
function repo(overrides: Partial<RepoReadiness> = {}): RepoReadiness {
  return {
    alias: '.',
    repoDir: '/w/payments-api',
    isRepo: true,
    hasRemote: true,
    remoteUrl: 'https://github.com/acme/payments-api.git',
    connected: true,
    branch: 'fix/checkout-flake',
    detached: false,
    defaultBranch: 'main',
    onDefaultBranch: false,
    dirty: true,
    changedFiles: 5,
    ahead: 2,
    behind: 0,
    hasUpstream: true,
    mergeInProgress: false,
    conflictedFiles: [],
    openPullRequest: null,
    can: { commit: true, push: true, pullRequest: true },
    reasons: {},
    ...overrides,
  };
}

const okResult: ScmFlowResult = {
  status: 'ok',
  alias: '.',
  branch: 'fix/checkout-flake',
  steps: [
    { id: 'readiness', status: 'done' },
    { id: 'branch', status: 'skipped' },
    { id: 'commit', status: 'done', detail: '5 files' },
    { id: 'sync', status: 'done' },
    { id: 'push', status: 'done' },
    { id: 'pull_request', status: 'done', detail: 'draft' },
  ],
  commit: { sha: '7be0d15c2a', message: 'Fix coupon/total race in checkout' },
  pushed: true,
  pullRequest: {
    provider: 'github',
    number: 12,
    url: 'https://github.com/acme/payments-api/pull/12',
    title: 'Fix coupon/total race in checkout',
    state: 'open',
    head: 'fix/checkout-flake',
    base: 'main',
    draft: true,
  },
  readiness: repo(),
};

const conflictResult: ScmFlowResult = {
  status: 'conflicts',
  alias: '.',
  steps: [
    { id: 'commit', status: 'done' },
    { id: 'sync', status: 'blocked', detail: '1 file conflicts' },
  ],
  conflicts: { base: 'main', head: 'fix/checkout-flake', files: ['src/cart/applyCoupon.ts'], mergeStarted: false },
  readiness: repo(),
};

interface HarnessProps {
  repos: RepoReadiness[];
  openPr?: boolean;
  running?: boolean;
  result?: ScmFlowResult | null;
  conflicts?: ReactNode;
  message?: string;
}

const onRun = fn();

/** Holds the form state the way useCommitBar does, so the story is interactive. */
function Harness({ repos, openPr: initialPr = false, running = false, result = null, conflicts, message: initialMessage = '' }: HarnessProps) {
  const [alias, setAlias] = useState(repos[0]?.alias);
  const selected = repos.find((r) => r.alias === alias) ?? repos[0]!;
  const [message, setMessage] = useState(initialMessage);
  const [push, setPush] = useState(true);
  const [openPr, setOpenPr] = useState(initialPr);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [base, setBase] = useState(selected.defaultBranch ?? '');
  const [draft, setDraft] = useState(false);
  const props: CommitBarViewProps = {
    repos,
    selected,
    onSelectAlias: setAlias,
    availability: scmAvailability(selected, result),
    message,
    onMessageChange: setMessage,
    push,
    onPushChange: setPush,
    openPr,
    onOpenPrChange: (v) => {
      setOpenPr(v);
      if (v) setPush(true);
    },
    prTitle,
    onPrTitleChange: setPrTitle,
    prBody,
    onPrBodyChange: setPrBody,
    base,
    onBaseChange: setBase,
    draft,
    onDraftChange: setDraft,
    generating: null,
    onGenerate: fn(),
    running,
    result,
    onRun,
    conflicts,
  };
  return <CommitBarView {...props} />;
}

const meta = {
  component: Harness,
  tags: ['vrt-themes'],
  args: { repos: [repo()] },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="w-115 rounded-card border border-line bg-surface">{Story()}</div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A dirty branch with a connected remote: commit + push by default; the action says what runs. */
export const Ready: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-status-line')).toHaveTextContent('2 ahead · 0 behind');
    await expect(canvas.getByText('Commits all 5 changed files')).toBeVisible();
    const run = canvas.getByRole('button', { name: 'Commit & push' });
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Open pull request' }));
    await expect(canvas.getByTestId('scm-pr-form')).toBeVisible();
    await expect(run).toHaveTextContent('Commit & open pull request');
    await userEvent.click(run);
    await expect(onRun).toHaveBeenCalled();
  },
};

/** The PR card: head → base, title with Generate, description, draft. */
export const PullRequest: Story = {
  args: { openPr: true, message: 'Fix coupon/total race in checkout' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Base branch' })).toHaveValue('main');
    await expect(canvas.getByRole('checkbox', { name: 'Push' })).toHaveAttribute('aria-disabled', 'true');
  },
};

/** Several mounts: the picker appears; an open PR links out from the status line. */
export const MultipleMounts: Story = {
  args: {
    repos: [
      repo({
        openPullRequest: {
          provider: 'github',
          number: 12,
          url: 'https://github.com/acme/payments-api/pull/12',
          title: 'Fix coupon/total race in checkout',
          state: 'open',
          head: 'fix/checkout-flake',
          base: 'main',
        },
      }),
      repo({ alias: 'docs', repoDir: '/w/docs', branch: 'main', onDefaultBranch: true, dirty: false, changedFiles: 0 }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-open-pr-link')).toHaveTextContent('PR #12 open');
    await userEvent.click(canvas.getByRole('button', { name: 'docs' }));
    await expect(canvas.getByRole('button', { name: 'docs' })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** No remote: commit only; the toggles say why. */
export const NoRemote: Story = {
  args: {
    repos: [
      repo({
        hasRemote: false,
        connected: false,
        hasUpstream: false,
        can: { commit: true, push: false, pullRequest: false },
        reasons: { push: 'No git remote configured', pullRequest: 'No git remote configured' },
      }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-run-flow')).toHaveTextContent(/^Commit$/);
    await expect(canvas.getByText('No git remote configured')).toBeVisible();
  },
};

/** Committing and pushing work; only pull requests need an account. */
export const NeedsAccountForPullRequests: Story = {
  args: {
    repos: [
      repo({
        connected: false,
        can: { commit: true, push: true, pullRequest: false },
        reasons: { pullRequest: 'Remote host github.com is not connected — connect it in Settings → Source Control' },
      }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-connect-github')).toHaveAttribute('href', '/settings/source-control');
  },
};

/** Nothing can work here: the reason, and Connect GitHub when an account is the fix. */
export const BlockedConnectGitHub: Story = {
  args: {
    repos: [
      repo({
        connected: false,
        can: { commit: false, push: false, pullRequest: false },
        reasons: { commit: 'Remote host github.com is not connected' },
      }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-blocked')).toHaveTextContent('Remote host github.com is not connected');
    await expect(canvas.getByRole('link', { name: 'Connect GitHub' })).toBeVisible();
    await expect(canvas.queryByTestId('scm-run-flow')).toBeNull();
  },
};

/** Not a repository: nothing to connect. */
export const BlockedNotARepo: Story = {
  args: {
    repos: [repo({ isRepo: false, hasRemote: false, connected: false, can: { commit: false, push: false, pullRequest: false } })],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-blocked')).toHaveTextContent('Not a git repository');
    await expect(canvas.queryByTestId('scm-connect-github')).toBeNull();
  },
};

/** The flow is running: the action is busy and the step list says so. */
export const Running: Story = {
  args: { running: true, message: 'Fix coupon/total race in checkout' },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-run-flow')).toHaveAttribute('aria-busy', 'true');
    await expect(canvas.getByText('Running…')).toBeVisible();
  },
};

/** Committed, pushed and a draft PR opened: the server's steps, then the outcome. */
export const ResultOk: Story = {
  args: { result: okResult },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-result-ok')).toHaveTextContent('7be0d15');
    await expect(canvas.getByText('Draft')).toBeVisible();
  },
};

/** The flow stopped: the failing step and its reason. */
export const ResultProblem: Story = {
  args: {
    result: {
      status: 'blocked',
      alias: '.',
      steps: [{ id: 'readiness', status: 'blocked', detail: 'Detached HEAD' }],
      readiness: repo(),
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-result-problem')).toHaveTextContent('Blocked at Checks — Detached HEAD');
  },
};

/** The base branch conflicts: the conflict card takes over (ScmConflictActions in the app). */
export const Conflicts: Story = {
  args: {
    result: conflictResult,
    conflicts: <ScmConflictCard conflicts={conflictResult.conflicts!} mode="idle" canAskAgent />,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('scm-conflict-card')).toHaveTextContent('src/cart/applyCoupon.ts');
    await expect(canvas.queryByTestId('scm-result-ok')).toBeNull();
  },
};

/** Readiness is loading. */
export const Loading: Story = {
  render: () => <CommitBarLoading />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Checking source control…')).toBeVisible();
  },
};
