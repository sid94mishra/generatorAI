import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import type { RepoReadiness, ScmCompareResult, ScmFlowResult, ScmPullRequestOptions } from '@generatorai/shared';
import { ShipDialogView, type ShipDialogViewProps, type ShipFile } from './ShipDialogView.js';
import { scmAvailability, type ShipMode } from './scmFlow.js';

function repo(overrides: Partial<RepoReadiness> = {}): RepoReadiness {
  return {
    alias: 'pulse',
    repoDir: '/w/pulse',
    isRepo: true,
    hasRemote: true,
    remoteUrl: 'https://github.com/acme/pulse.git',
    connected: true,
    branch: 'generatorai/add-slugify',
    detached: false,
    defaultBranch: 'develop',
    onDefaultBranch: false,
    dirty: true,
    changedFiles: 3,
    ahead: null,
    behind: null,
    hasUpstream: false,
    mergeInProgress: false,
    conflictedFiles: [],
    openPullRequest: null,
    can: { commit: true, push: true, pullRequest: true },
    reasons: {},
    ...overrides,
  };
}

const FILES: ShipFile[] = [
  { path: 'packages/shared/src/index.ts', status: 'modified', additions: 1, deletions: 0 },
  { path: 'packages/shared/src/slug.ts', status: 'added', additions: 12, deletions: 0 },
  { path: 'packages/shared/test/slug.test.ts', status: 'added', additions: 36, deletions: 0 },
];

const COMPARE: ScmCompareResult = {
  alias: 'pulse',
  base: 'develop',
  head: 'generatorai/add-slugify',
  commits: [
    { sha: '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432', subject: 'Add formatUptime helper', author: 'Sid', date: '2026-10-24T10:00:00Z' },
  ],
  files: [{ path: 'packages/shared/src/uptime.ts', status: 'added', additions: 18, deletions: 0 }],
  additions: 18,
  deletions: 0,
  behind: 2,
  mergeable: 'clean',
  conflictFiles: [],
  uncommittedFiles: 3,
};

const OPTIONS: ScmPullRequestOptions = {
  alias: 'pulse',
  available: true,
  viewer: 'sid',
  people: [{ login: 'sid' }, { login: 'maya' }, { login: 'ola' }],
  labels: [
    { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
    { name: 'bug', color: 'd73a4a' },
  ],
  issues: [
    { number: 12, title: 'Slugs for monitor names' },
    { number: 14, title: 'Uptime renders as seconds' },
  ],
};

function Harness({ selected = repo(), initialMode = 'push', result = null, ...rest }: Partial<ShipDialogViewProps> & { initialMode?: ShipMode }) {
  const [mode, setMode] = useState<ShipMode>(initialMode);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [base, setBase] = useState('develop');
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [closes, setCloses] = useState<number[]>([]);
  return (
    <ShipDialogView
      open
      onOpenChange={fn()}
      repos={[selected]}
      selected={selected}
      onSelectAlias={fn()}
      availability={scmAvailability(selected, result)}
      mode={mode}
      onModeChange={setMode}
      summary={summary}
      onSummaryChange={setSummary}
      description={description}
      onDescriptionChange={setDescription}
      commitFiles={FILES}
      prTitle={prTitle}
      onPrTitleChange={setPrTitle}
      prBody={prBody}
      onPrBodyChange={setPrBody}
      base={base}
      onBaseChange={setBase}
      branches={{ alias: 'pulse', defaultBranch: 'develop', current: selected.branch, branches: ['develop', 'main', 'release/1.4'], fresh: true }}
      compare={COMPARE}
      prOptions={OPTIONS}
      reviewers={reviewers}
      onReviewersChange={setReviewers}
      assignees={assignees}
      onAssigneesChange={setAssignees}
      labels={labels}
      onLabelsChange={setLabels}
      closesIssues={closes}
      onClosesIssuesChange={setCloses}
      generating={null}
      onGenerate={fn()}
      running={false}
      result={result}
      onDismissResult={fn()}
      onRun={fn()}
      {...rest}
    />
  );
}

const meta = {
  component: ShipDialogView,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  render: () => <Harness />,
} satisfies Meta<typeof ShipDialogView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Commit & push (the default with changes): summary, description and the files the commit takes. */
export const CommitAndPush: Story = {
  args: {} as ShipDialogViewProps,
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Commit and push' });
    await expect(within(dialog).getByRole('radio', { name: 'Commit & push' })).toBeChecked();
    await expect(within(dialog).getByText('3 files will be committed')).toBeInTheDocument();
    await expect(within(dialog).getByRole('button', { name: 'Commit & push' })).toBeEnabled();
  },
};

/** The pull-request form: base branch picker, mergeability, contents and the GitHub-style sidebar. */
export const PullRequest: Story = {
  args: {} as ShipDialogViewProps,
  render: () => <Harness initialMode="pr" />,
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Open a pull request' });
    await expect(within(dialog).getByText(/Able to merge/)).toBeInTheDocument();
    await expect(within(dialog).getByText('This pull request will contain')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Base branch/ }));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    await userEvent.click(screen.getByRole('option', { name: /release\/1\.4/ }));
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /Base branch/ })).toHaveTextContent('release/1.4'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign yourself' }));
    await expect(within(dialog).getByRole('button', { name: 'Create pull request' })).toBeEnabled();
  },
};

/** The base has conflicting changes: said up front, before anything is pushed. */
export const PullRequestConflicts: Story = {
  args: {} as ShipDialogViewProps,
  render: () => <Harness initialMode="pr" compare={{ ...COMPARE, mergeable: 'conflicts', conflictFiles: ['src/a.ts', 'src/b.ts'] }} />,
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Open a pull request' });
    await expect(within(dialog).getByText(/Conflicts with develop/)).toBeInTheDocument();
  },
};

/** CLI-only GitHub auth: the PR still opens; the sidebar says why its pickers are off. */
export const PullRequestNoToken: Story = {
  args: {} as ShipDialogViewProps,
  render: () => (
    <Harness
      initialMode="pr"
      prOptions={{ ...OPTIONS, available: false, reason: 'Reviewers, assignees and labels need a GitHub account connected with a token', people: [], labels: [], issues: [] }}
    />
  ),
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Open a pull request' });
    await expect(within(dialog).getByTestId('scm-pr-options-unavailable')).toBeInTheDocument();
  },
};

/** A PR is already open for the branch: pushing updates it, so there is no PR mode. */
export const OpenPullRequest: Story = {
  args: {} as ShipDialogViewProps,
  render: () => (
    <Harness
      selected={repo({
        dirty: false,
        changedFiles: 0,
        hasUpstream: true,
        ahead: 1,
        behind: 0,
        openPullRequest: { provider: 'github', number: 21, url: 'https://github.com/acme/pulse/pull/21', title: 'Add slugify', state: 'open', head: 'generatorai/add-slugify', base: 'develop', draft: false },
      })}
    />
  ),
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Push commits' });
    await expect(within(dialog).getByText('PR #21 open')).toBeInTheDocument();
    await expect(within(dialog).queryByRole('radio', { name: 'Open pull request' })).toBeNull();
    await expect(within(dialog).getByText(/1 commit on generatorai\/add-slugify will be pushed/)).toBeInTheDocument();
  },
};

const OK: ScmFlowResult = {
  status: 'ok',
  alias: 'pulse',
  steps: [
    { id: 'readiness', status: 'done' },
    { id: 'branch', status: 'skipped', detail: 'Already on generatorai/add-slugify' },
    { id: 'commit', status: 'done', detail: '1a2b3c4d — Add slugify helper' },
    { id: 'sync', status: 'done', detail: 'Merged origin/develop' },
    { id: 'push', status: 'done', detail: 'origin/generatorai/add-slugify' },
    { id: 'pull_request', status: 'done', detail: 'Opened PR #22' },
  ],
  commit: { sha: '1a2b3c4d5e', message: 'Add slugify helper' },
  pushed: true,
  pullRequest: { provider: 'github', number: 22, url: 'https://github.com/acme/pulse/pull/22', title: 'Add slugify helper', state: 'open', head: 'generatorai/add-slugify', base: 'develop', draft: true },
  readiness: repo({ dirty: false }),
};

/** After the run: the server's steps, the commit, and the PR with a way to open it. */
export const Done: Story = {
  args: {} as ShipDialogViewProps,
  render: () => <Harness initialMode="pr" result={OK} />,
  play: async () => {
    const dialog = await screen.findByRole('dialog');
    await expect(within(dialog).getByTestId('scm-result-ok')).toHaveTextContent('PR #22');
    await expect(within(dialog).getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/acme/pulse/pull/22');
  },
};

/** Not a repository: nothing can run, and the dialog says why. */
export const Blocked: Story = {
  args: {} as ShipDialogViewProps,
  render: () => <Harness selected={repo({ isRepo: false, can: { commit: false, push: false, pullRequest: false } })} />,
  play: async () => {
    const dialog = await screen.findByRole('dialog');
    await expect(within(dialog).getByTestId('scm-blocked')).toHaveTextContent('Not a git repository');
  },
};
