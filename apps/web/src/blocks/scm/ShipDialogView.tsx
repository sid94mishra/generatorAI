// ────────────────────────────────────────────────────────────────
// ShipDialogView — commit, push and open a pull request in one dialog
// (D-163; replaces the Changes panel's CommitBar footer). Pure: ShipDialog
// feeds it from useShipFlow.
//
// Shipping happens once per review, so it gets a dialog with room instead of a
// footer that squeezed the diff. Modelled on GitHub's "Open a pull request":
//
//   ┌ Open a pull request ─────────────────────────────────────────── × ┐
//   │ ⑂ generatorai/v-d5 · 3 files not committed · 2 commits ahead of develop · Up to date with GitHub │
//   │ [ Commit | Commit & push | Commit & open PR ]                      │
//   │ Commit    Summary [……………………… Generate]  Description […]  ▸ 3 files │ Reviewers  [……]
//   │ Pull request  Merge ⑂ head → into [develop ▾]  ✓ Able to merge     │ Assignees  [……]
//   │               Title [……… Generate]  Description  Write | Preview   │ Labels     [……]
//   │               This pull request will contain: 2 commits · 4 files  │ Closes     [……]
//   ├───────────────────────────────────────────────────────────────────┤
//   │ Commits 3 files, pushes and opens a PR into develop   Cancel [Create pull request ▾] │
//   └───────────────────────────────────────────────────────────────────┘
//
// The mode switch is what runs: commit only, commit and push, or commit, push
// and open a PR. What a mount cannot do is disabled with its reason. After the
// run the body shows the server's own steps and the outcome (a link to the
// PR), or the conflict card.
// ────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  CHANGE_KIND,
  type RepoReadiness,
  type ScmBranchList,
  type ScmCompareResult,
  type ScmFlowResult,
  type ScmFlowStep,
  type ScmPullRequestOptions,
} from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Collapsible } from '@/ui/primitives/Collapsible/Collapsible.js';
import { Combobox } from '@/ui/primitives/Combobox/Combobox.js';
import { Dialog, DialogBody, DialogClose, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { StepRail, type StepRailItem } from '@/ui/patterns/StepRail/StepRail.js';
import { CHANGE_TONE_CLASS } from '@/blocks/changes/ChangeFileRow.js';
import {
  branchFactsOf,
  failingStep,
  remoteNameOf,
  SCM_SETTINGS_PATH,
  SCM_STEP_LABEL,
  type ScmAvailability,
  type ShipMode,
} from './scmFlow.js';
import type { ScmTextKind } from './useShipFlow.js';

/** One file a commit (or a PR) carries. */
export interface ShipFile {
  path: string;
  oldPath?: string;
  status: keyof typeof CHANGE_KIND;
  additions: number;
  deletions: number;
}

export interface ShipDialogViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repos: readonly RepoReadiness[];
  selected: RepoReadiness;
  onSelectAlias: (alias: string) => void;
  availability: ScmAvailability;

  mode: ShipMode;
  onModeChange: (mode: ShipMode) => void;
  /** The dialog is fetching the remote; the counts may still move. */
  checkingRemote?: boolean;

  summary: string;
  onSummaryChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  commitFiles: readonly ShipFile[];

  prTitle: string;
  onPrTitleChange: (value: string) => void;
  prBody: string;
  onPrBodyChange: (value: string) => void;
  base: string;
  onBaseChange: (value: string) => void;
  branches?: ScmBranchList | undefined;
  branchesLoading?: boolean;
  compare?: ScmCompareResult | undefined;
  compareLoading?: boolean;
  prOptions?: ScmPullRequestOptions | undefined;
  prOptionsLoading?: boolean;
  reviewers: readonly string[];
  onReviewersChange: (value: string[]) => void;
  assignees: readonly string[];
  onAssigneesChange: (value: string[]) => void;
  labels: readonly string[];
  onLabelsChange: (value: string[]) => void;
  closesIssues: readonly number[];
  onClosesIssuesChange: (value: number[]) => void;

  generating: ScmTextKind | null;
  onGenerate: (kind: ScmTextKind) => void;
  running: boolean;
  result: ScmFlowResult | null;
  /** Back from a failed outcome to the form. */
  onDismissResult: () => void;
  /** Run the flow; `draft` opens the PR as a draft. */
  onRun: (draft: boolean) => void;
  /** The conflict card (ScmConflictActions) when a merge needs a decision. */
  conflicts?: ReactNode;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function mountLabel(alias: string): string {
  return alias === '.' ? 'workspace' : alias;
}

/** What each mode is called, given whether there is anything to commit. */
function modeItems(selected: RepoReadiness, availability: ScmAvailability): SegmentedItem<ShipMode>[] {
  const dirty = selected.dirty;
  const pr = selected.openPullRequest;
  return [
    { value: 'commit', label: 'Commit', icon: 'commit', disabled: !dirty, reason: 'Nothing to commit' },
    {
      value: 'push',
      label: dirty ? 'Commit & push' : 'Push',
      icon: 'upload',
      disabled: !availability.canPush,
      reason: selected.reasons.push ?? 'Cannot push from here',
    },
    // The header already links the branch's open PR, and pushing updates it: no third choice then.
    ...(pr
      ? []
      : [
          {
            value: 'pr' as const,
            label: dirty ? 'Commit & open PR' : 'Open pull request',
            icon: 'pr' as const,
            disabled: !availability.canOpenPr,
            reason: selected.reasons.pullRequest ?? 'Cannot open a pull request from here',
          },
        ]),
  ];
}

function titleOf(mode: ShipMode, dirty: boolean): string {
  if (mode === 'pr') return 'Open a pull request';
  if (mode === 'push') return dirty ? 'Commit and push' : 'Push commits';
  return 'Commit changes';
}

/** The footer's one-line account of what the primary action will do. */
function planOf(mode: ShipMode, selected: RepoReadiness, files: number, base: string): string {
  const parts: string[] = [];
  if (selected.dirty) parts.push(`Commits ${plural(files || selected.changedFiles, 'file')}`);
  const upToDate = !selected.dirty && selected.hasUpstream && (selected.ahead ?? 0) === 0;
  if (mode === 'push' && upToDate) return '';
  if (mode !== 'commit') {
    const cut = selected.onDefaultBranch || selected.branch === null;
    parts.push(cut ? 'pushes to a new branch' : `pushes ${selected.branch}`);
  }
  if (mode === 'pr') parts.push(`opens a pull request into ${base || selected.defaultBranch || 'the default branch'}`);
  const text = parts.join(', ');
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : '';
}

export function ShipDialogView(props: ShipDialogViewProps) {
  const { open, onOpenChange, selected, availability, mode, result, running } = props;
  const writingPr = mode === 'pr' && availability.canOpenPr && !selected.openPullRequest;
  const showForm = !result && !availability.blockedReason && !availability.mergeInProgress;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size={writingPr && showForm ? 'xl' : 'md'}
      // After a run the tree is clean again; the heading keeps naming what ran.
      title={titleOf(mode, selected.dirty || !!result?.commit)}
      badge={props.repos.length > 1 ? <Badge>{mountLabel(selected.alias)}</Badge> : undefined}
      data-testid="scm-dialog"
    >
      <DialogBody className={cn(writingPr && showForm && 'p-0')}>
        {showForm ? (
          writingPr ? (
            <div className="flex min-h-full">
              <div className="flex min-w-0 flex-1 flex-col gap-5 p-5">
                <ShipHeader {...props} />
                <CommitSection {...props} />
                <PullRequestSection {...props} />
              </div>
              <PullRequestSidebar {...props} />
            </div>
          ) : (
            <>
              <ShipHeader {...props} />
              <CommitSection {...props} />
              {!selected.dirty && mode === 'push' ? <PushNote selected={selected} /> : null}
            </>
          )
        ) : (
          <ShipOutcome {...props} />
        )}
      </DialogBody>
      <ShipFooter {...props} writingPr={writingPr} showForm={showForm} running={running} />
    </Dialog>
  );
}

// ── Header: repo, branch, state, and the mode switch ─────────────

function ShipHeader({ repos, selected, onSelectAlias, availability, mode, onModeChange, checkingRemote }: ShipDialogViewProps) {
  return (
    <div className="flex flex-col gap-3">
      {repos.length > 1 ? (
        <div role="group" aria-label="Repository" className="flex flex-wrap items-center gap-1" data-testid="scm-mount-picker">
          {repos.map((repo) => (
            <Button
              key={repo.alias}
              variant="ghost"
              size="sm"
              pressed={repo.alias === selected.alias}
              onClick={() => onSelectAlias(repo.alias)}
            >
              {mountLabel(repo.alias)}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-small" data-testid="scm-status-line">
        <Icon concept="branch" size={14} className="text-fg-3" />
        <span className="min-w-0 truncate font-mono text-fg">{selected.branch ?? 'detached HEAD'}</span>
        {selected.unborn ? (
          <span className="text-fg-3" data-testid="scm-no-commits">
            No commits yet
          </span>
        ) : null}
        {branchFactsOf(selected).map((fact) => (
          <span key={fact} className="text-fg-3">
            · {fact}
          </span>
        ))}
        {checkingRemote ? (
          <span className="inline-flex items-center gap-1 text-fg-3" data-testid="scm-checking-remote">
            <Spinner size={12} /> Checking {remoteNameOf(selected)}…
          </span>
        ) : null}
        {selected.openPullRequest ? (
          <Link variant="external" href={selected.openPullRequest.url} data-testid="scm-open-pr-link">
            PR #{selected.openPullRequest.number} open
          </Link>
        ) : null}
      </div>
      <SegmentedControl<ShipMode>
        label="What to do"
        value={mode}
        items={modeItems(selected, availability)}
        onValueChange={onModeChange}
        className="self-start"
        data-testid="scm-mode"
      />
      {availability.needsConnect && !availability.canOpenPr ? (
        <Callout
          tone="info"
          action={
            <Button size="sm" variant="ghost" render={<RouterLink to={SCM_SETTINGS_PATH} />} data-testid="scm-connect-github">
              Connect GitHub
            </Button>
          }
        >
          Connect a GitHub account to open pull requests from here.
        </Callout>
      ) : null}
    </div>
  );
}

// ── Commit: summary + description, and the files it takes ────────

function CommitSection({
  selected,
  summary,
  onSummaryChange,
  description,
  onDescriptionChange,
  commitFiles,
  generating,
  onGenerate,
}: ShipDialogViewProps) {
  if (!selected.dirty) return null;
  return (
    <section aria-label="Commit" className="flex flex-col gap-3" data-testid="scm-commit-section">
      <SectionTitle icon="commit">Commit</SectionTitle>
      <Field label="Summary" hint="Leave both fields blank to have the message written from the changes.">
        <Input
          value={summary}
          onChange={(e) => onSummaryChange(e.target.value)}
          placeholder="Summarise the change in one line"
          aria-label="Commit message"
          data-testid="scm-commit-message"
          trailing={
            <Button
              variant="ghost"
              size="sm"
              icon="wand"
              loading={generating === 'commit'}
              onClick={() => onGenerate('commit')}
              data-testid="scm-generate-commit"
              className="-mr-1.5"
            >
              Generate
            </Button>
          }
        />
      </Field>
      <Field label="Description" optional>
        <Textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Why the change was made, anything a reviewer should know"
          aria-label="Commit description"
          autosize={{ minRows: 2, maxRows: 8 }}
          data-testid="scm-commit-description"
        />
      </Field>
      <FileList
        files={commitFiles}
        title={`${plural(commitFiles.length || selected.changedFiles, 'file')} will be committed`}
        testId="scm-commit-files"
      />
    </section>
  );
}

function PushNote({ selected }: { selected: RepoReadiness }) {
  const ahead = selected.ahead ?? 0;
  const behind = selected.behind ?? 0;
  const remote = remoteNameOf(selected);
  const pr = selected.openPullRequest;
  const text = !selected.hasUpstream
    ? `${selected.branch} goes to ${remote} for the first time.`
    : ahead > 0
      ? `${plural(ahead, 'commit')} on ${selected.branch} will be pushed${pr ? `, updating PR #${pr.number}` : ''}.`
      : behind > 0
        ? `Nothing of yours to push. ${remote} has ${plural(behind, 'newer commit')}; your next push merges them first.`
        : `Nothing to push: ${remote} already has every commit on ${selected.branch}.`;
  return <p className="text-ui text-fg-2">{text}</p>;
}

// ── Pull request: base, mergeability, title, description, contents ─

function PullRequestSection(props: ShipDialogViewProps) {
  const { selected, base, onBaseChange, branches, branchesLoading, compare, compareLoading } = props;
  const items = (branches?.branches ?? (base ? [base] : [])).map((name) => ({
    value: name,
    label: name,
    ...(name === branches?.defaultBranch ? { meta: 'default' } : {}),
  }));
  return (
    <section aria-label="Pull request" className="flex flex-col gap-3" data-testid="scm-pr-form">
      <SectionTitle icon="pr">Pull request</SectionTitle>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-ui text-fg-2">
        <span>Merge</span>
        <Badge icon="branch" className="min-w-0 font-mono">
          <span className="truncate">{selected.branch ?? 'a new branch'}</span>
        </Badge>
        <span>into</span>
        <Combobox
          label="Base branch"
          icon="branch"
          value={base || null}
          onValueChange={(v) => {
            if (v) onBaseChange(v);
          }}
          items={items}
          placeholder={branchesLoading ? 'Loading branches…' : 'Choose a branch'}
          searchPlaceholder="Find a branch"
          emptyText={branchesLoading ? 'Loading branches…' : 'No matching branch'}
          data-testid="scm-pr-base"
          className="w-80 max-w-full"
        />
        {branches && !branches.fresh ? (
          <span className="text-small text-fg-3" title="The remote could not be reached; this is the last fetched list">
            offline list
          </span>
        ) : null}
      </div>
      <MergeStatus compare={compare} loading={compareLoading ?? false} base={base} />

      <Field label="Title">
        <Input
          value={props.prTitle}
          onChange={(e) => props.onPrTitleChange(e.target.value)}
          placeholder="Leave blank to have it written from the commits"
          aria-label="Pull request title"
          data-testid="scm-pr-title"
          trailing={
            <Button
              variant="ghost"
              size="sm"
              icon="wand"
              loading={props.generating === 'pull_request'}
              onClick={() => props.onGenerate('pull_request')}
              data-testid="scm-generate-pr"
              className="-mr-1.5"
            >
              Generate
            </Button>
          }
        />
      </Field>
      <PullRequestBody value={props.prBody} onChange={props.onPrBodyChange} />
      <PullRequestContents compare={compare} loading={compareLoading ?? false} uncommitted={selected.dirty ? selected.changedFiles : 0} />
    </section>
  );
}

function MergeStatus({ compare, loading, base }: { compare: ScmCompareResult | undefined; loading: boolean; base: string }) {
  if (loading && !compare) {
    return (
      <p className="flex items-center gap-2 text-small text-fg-3" data-testid="scm-merge-status">
        <Spinner size={12} /> Checking against {base}…
      </p>
    );
  }
  if (!compare) return null;
  const behind =
    compare.behind > 0 ? ` ${base} has ${plural(compare.behind, 'new commit')}; they are merged into your branch before the push.` : '';
  if (compare.mergeable === 'clean') {
    return (
      <p className="flex items-start gap-2 text-small text-fg-2" data-testid="scm-merge-status">
        <Icon concept="status-succeeded" size={14} className="mt-0.5 shrink-0 text-ok" />
        <span>
          <span className="font-medium text-fg">Able to merge.</span> No conflicts with {base}.{behind}
        </span>
      </p>
    );
  }
  if (compare.mergeable === 'conflicts') {
    return (
      <p className="flex items-start gap-2 text-small text-fg-2" data-testid="scm-merge-status">
        <Icon concept="warning" size={14} className="mt-0.5 shrink-0 text-warn" />
        <span>
          <span className="font-medium text-fg">Conflicts with {base}</span> in {plural(compare.conflictFiles.length, 'file')}. You
          will be asked to resolve them before anything is pushed.
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-small text-fg-3" data-testid="scm-merge-status">
      <Icon concept="info" size={14} className="shrink-0" /> Conflicts with {base} are checked when you push.{behind}
    </p>
  );
}

function PullRequestBody({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [view, setView] = useState<'write' | 'preview'>('write');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-small font-medium text-fg-2">Description</span>
        <SegmentedControl<'write' | 'preview'>
          label="Description view"
          semantics="tabs"
          value={view}
          onValueChange={setView}
          items={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' },
          ]}
          className="ml-auto"
        />
      </div>
      {view === 'write' ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What changed and why. Markdown works. Leave blank to have it written from the commits (and the repo's PR template)."
          aria-label="Pull request description"
          autosize={{ minRows: 6, maxRows: 16 }}
          data-testid="scm-pr-body"
        />
      ) : (
        <div className="min-h-32 rounded-control border border-line-strong bg-sunken px-3 py-2" data-testid="scm-pr-body-preview">
          {value.trim() ? <Markdown size="compact">{value}</Markdown> : <p className="text-small text-fg-3">Nothing to preview.</p>}
        </div>
      )}
    </div>
  );
}

function PullRequestContents({
  compare,
  loading: _loading,
  uncommitted,
}: {
  compare: ScmCompareResult | undefined;
  loading: boolean;
  uncommitted: number;
}) {
  if (!compare) return null;
  const commits = compare.commits.length;
  const files = compare.files.length;
  // What the PR carries: the branch's commits, plus what this run commits first.
  const summary =
    commits === 0
      ? uncommitted > 0
        ? `the ${plural(uncommitted, 'file')} this commit adds`
        : 'no changes yet'
      : `${plural(commits, 'commit')} · ${plural(files, 'file')} changed${uncommitted > 0 ? `, plus the ${plural(uncommitted, 'file')} this commit adds` : ''}`;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line p-3" data-testid="scm-pr-contents">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui">
        <span className="font-medium text-fg">This pull request will contain</span>
        <span className="text-fg-2">{summary}</span>
        {compare.additions > 0 || compare.deletions > 0 ? <DiffStat added={compare.additions} removed={compare.deletions} /> : null}
      </div>
      {commits > 0 ? (
        <Collapsible variant="disclosure" trigger={`Commits (${commits})`} data-testid="scm-pr-commits">
          <ul className="flex flex-col">
            {compare.commits.map((c) => (
              <li key={c.sha} className="flex min-h-item min-w-0 items-center gap-2 text-small">
                <Icon concept="commit" size={12} className="shrink-0 text-fg-3" />
                <span className="min-w-0 flex-1 truncate text-fg">{c.subject}</span>
                <span className="shrink-0 text-fg-3">{c.author}</span>
                <span className="shrink-0 font-mono text-micro text-fg-3">{c.sha.slice(0, 7)}</span>
              </li>
            ))}
          </ul>
        </Collapsible>
      ) : null}
      {compare.files.length > 0 ? (
        <FileList files={compare.files} title={`Files changed (${compare.files.length})`} testId="scm-pr-files" />
      ) : null}
    </div>
  );
}

// ── Sidebar: reviewers, assignees, labels, linked issues ─────────

function PullRequestSidebar({
  prOptions,
  prOptionsLoading,
  reviewers,
  onReviewersChange,
  assignees,
  onAssigneesChange,
  labels,
  onLabelsChange,
  closesIssues,
  onClosesIssuesChange,
}: ShipDialogViewProps) {
  const viewer = prOptions?.viewer ?? null;
  const people = prOptions?.people ?? [];
  const reviewerItems = people.filter((p) => p.login !== viewer).map((p) => ({ value: p.login, label: p.login }));
  const assigneeItems = people.map((p) => ({ value: p.login, label: p.login, ...(p.login === viewer ? { meta: 'you' } : {}) }));
  const labelItems = (prOptions?.labels ?? []).map((l) => ({
    value: l.name,
    label: l.name,
    ...(l.description ? { meta: l.description } : {}),
  }));
  const issueItems = (prOptions?.issues ?? []).map((i) => ({
    value: String(i.number),
    label: `#${i.number} ${i.title}`,
    keywords: [String(i.number)],
  }));
  const loading = prOptionsLoading ?? false;
  const unavailable = prOptions && !prOptions.available ? prOptions.reason : undefined;

  return (
    <aside aria-label="Pull request details" className="flex w-72 shrink-0 flex-col gap-5 border-l border-line-soft p-5" data-testid="scm-pr-sidebar">
      {unavailable ? (
        <Callout tone="info" data-testid="scm-pr-options-unavailable">
          {unavailable}
        </Callout>
      ) : null}
      <SidebarField
        icon="users"
        title="Reviewers"
        empty={!loading && !unavailable && reviewerItems.length === 0 ? 'No one else in this repository can review.' : undefined}
      >
        <Combobox
          multiple
          variant="field"
          label="Reviewers"
          value={reviewers}
          onValueChange={onReviewersChange}
          items={reviewerItems}
          placeholder={loading ? 'Loading…' : 'Add reviewers'}
          disabled={loading || !!unavailable || reviewerItems.length === 0}
          data-testid="scm-pr-reviewers"
        />
      </SidebarField>
      <SidebarField icon="user" title="Assignees">
        <Combobox
          multiple
          variant="field"
          label="Assignees"
          value={assignees}
          onValueChange={onAssigneesChange}
          items={assigneeItems}
          placeholder={loading ? 'Loading…' : 'Add assignees'}
          disabled={loading || !!unavailable}
          data-testid="scm-pr-assignees"
        />
        {viewer && !assignees.includes(viewer) && !unavailable ? (
          <Button variant="ghost" size="sm" icon="user" onClick={() => onAssigneesChange([...assignees, viewer])} className="-ml-2 self-start">
            Assign yourself
          </Button>
        ) : null}
      </SidebarField>
      <SidebarField
        icon="tag"
        title="Labels"
        empty={!loading && !unavailable && labelItems.length === 0 ? 'This repository has no labels.' : undefined}
      >
        <Combobox
          multiple
          variant="field"
          label="Labels"
          value={labels}
          onValueChange={onLabelsChange}
          items={labelItems}
          placeholder={loading ? 'Loading…' : 'Add labels'}
          disabled={loading || !!unavailable || labelItems.length === 0}
          data-testid="scm-pr-labels"
        />
      </SidebarField>
      <SidebarField
        icon="issue"
        title="Closes issues"
        hint="Closed automatically when the pull request merges."
        empty={!loading && !unavailable && issueItems.length === 0 ? 'No open issues.' : undefined}
      >
        <Combobox
          multiple
          variant="field"
          label="Closes issues"
          value={closesIssues.map(String)}
          onValueChange={(v) => onClosesIssuesChange(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))}
          items={issueItems}
          placeholder={loading ? 'Loading…' : 'Link issues'}
          disabled={loading || !!unavailable || issueItems.length === 0}
          data-testid="scm-pr-issues"
        />
      </SidebarField>
    </aside>
  );
}

function SidebarField({
  icon,
  title,
  hint,
  empty,
  children,
}: {
  icon: 'users' | 'user' | 'tag' | 'issue';
  title: string;
  hint?: string;
  empty?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-small font-medium text-fg-2">
        <Icon concept={icon} size={12} className="text-fg-3" />
        {title}
      </span>
      {children}
      {empty ? <span className="text-small text-fg-3">{empty}</span> : hint ? <span className="text-small text-fg-3">{hint}</span> : null}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────

function SectionTitle({ icon, children }: { icon: 'commit' | 'pr'; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-ui font-semibold text-fg">
      <Icon concept={icon} size={14} className="text-fg-3" />
      {children}
    </h3>
  );
}

function FileList({ files, title, testId }: { files: readonly ShipFile[]; title: string; testId: string }) {
  if (files.length === 0) return null;
  return (
    <Collapsible variant="disclosure" trigger={title} data-testid={testId}>
      <ul className="flex flex-col">
        {files.map((f) => {
          const kind = CHANGE_KIND[f.status];
          return (
            <li key={f.path} className="flex min-h-item min-w-0 items-center gap-2 text-small">
              <span className={cn('w-3 shrink-0 font-mono text-micro font-semibold', CHANGE_TONE_CLASS[kind.tone])} title={kind.label}>
                {kind.letter}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-micro text-fg" title={f.path}>
                {f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
              </span>
              <DiffStat added={f.additions} removed={f.deletions} />
            </li>
          );
        })}
      </ul>
    </Collapsible>
  );
}

// ── Outcome: steps, result, conflicts ────────────────────────────

function ShipOutcome({ selected, availability, result, running, conflicts }: ShipDialogViewProps) {
  if (availability.blockedReason) {
    return (
      <Callout
        tone="warn"
        data-testid="scm-blocked"
        action={
          availability.needsConnect ? (
            <Button size="sm" render={<RouterLink to={SCM_SETTINGS_PATH} />} data-testid="scm-connect-github">
              Connect GitHub
            </Button>
          ) : undefined
        }
      >
        {availability.blockedReason}
      </Callout>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {!result && availability.mergeInProgress ? (
        <p className="text-ui text-fg-2">A merge into {selected.branch ?? 'this branch'} is in progress. Finish or abort it first.</p>
      ) : null}
      {running || result ? <ScmFlowSteps steps={result?.steps ?? []} running={running} /> : null}
      {conflicts}
      {result ? <ScmResultSummary result={result} /> : null}
    </div>
  );
}

function ShipFooter({
  mode,
  selected,
  commitFiles,
  base,
  result,
  onDismissResult,
  onRun,
  writingPr,
  showForm,
  running,
  availability,
}: ShipDialogViewProps & { writingPr: boolean; showForm: boolean }) {
  if (!showForm) {
    const pr = result?.status === 'ok' ? result.pullRequest : undefined;
    const failed = result && result.status !== 'ok' && result.status !== 'conflicts';
    return (
      <DialogFooter>
        {failed ? (
          <Button variant="ghost" onClick={onDismissResult}>
            Back
          </Button>
        ) : null}
        {pr ? (
          <Button variant="secondary" icon="external-link" render={<a href={pr.url} target="_blank" rel="noreferrer" />}>
            View on GitHub
          </Button>
        ) : null}
        <DialogClose render={<Button variant={pr || result?.status === 'ok' ? 'primary' : 'secondary'} />}>Done</DialogClose>
      </DialogFooter>
    );
  }
  const upToDate = !selected.dirty && selected.hasUpstream && selected.ahead === 0;
  const disabled =
    running ||
    (mode === 'commit' && !selected.dirty) ||
    (mode === 'push' && (!availability.canPush || upToDate)) ||
    (mode === 'pr' && !writingPr);
  const label = mode === 'commit' ? 'Commit' : mode === 'push' ? (selected.dirty ? 'Commit & push' : upToDate ? 'Up to date' : 'Push') : '';
  return (
    <DialogFooter hint={planOf(mode, selected, commitFiles.length, base)}>
      <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
      {mode === 'pr' && !running ? (
        <MenuButton
          split
          variant="primary"
          icon="pr"
          label="Create pull request"
          menuLabel="More ways to open it"
          onPrimary={() => onRun(false)}
          items={[{ id: 'draft', label: 'Create draft pull request', icon: 'pr', onSelect: () => onRun(true) }]}
          disabled={disabled}
          align="end"
        />
      ) : (
        <Button
          variant="primary"
          icon={mode === 'pr' ? 'pr' : 'commit'}
          loading={running}
          disabled={disabled}
          onClick={() => onRun(false)}
          data-testid="scm-run-flow"
        >
          {running ? 'Working…' : label}
        </Button>
      )}
    </DialogFooter>
  );
}

function stepGlyph(status: ScmFlowStep['status']): ReactNode {
  if (status === 'done') return <Icon concept="status-succeeded" size={14} className="text-ok" />;
  if (status === 'failed' || status === 'blocked') return <Icon concept="status-failed" size={14} className="text-err" />;
  return <Icon concept="status-skipped" size={14} className="text-fg-3" />;
}

/** The server's own steps — what is shown is what ran — plus "Running…" while in flight. */
export function ScmFlowSteps({ steps, running = false }: { steps: readonly ScmFlowStep[]; running?: boolean }) {
  const items: StepRailItem[] = steps.map((step) => ({
    id: step.id,
    glyph: stepGlyph(step.status),
    verb: SCM_STEP_LABEL[step.id],
    // A failed step's detail is the outcome callout's text; the rail just marks where it stopped.
    ...(step.detail && step.status !== 'failed' ? { target: step.detail } : {}),
    ...(step.status === 'skipped' ? { result: 'skipped', resultTone: 'muted' as const } : {}),
    ...(step.status === 'failed' ? { result: 'failed', resultTone: 'err' as const } : {}),
  }));
  if (running) items.push({ id: 'running', glyph: <Spinner size={14} className="text-run" />, verb: 'Running…' });
  return <StepRail items={items} label="Source control steps" data-testid="scm-steps" />;
}

/** The outcome: what landed, or why nothing did. Conflicts render the conflict card instead. */
export function ScmResultSummary({ result }: { result: ScmFlowResult }) {
  if (result.status === 'ok') {
    const pr = result.pullRequest;
    return (
      <div className="flex min-w-0 flex-col gap-2 rounded-card border border-line p-3 text-ui" data-testid="scm-result-ok" role="status">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-fg-2">
          <Icon concept="status-succeeded" size={14} className="text-ok" />
          {result.commit ? (
            <span>
              Committed <span className="font-mono text-fg">{result.commit.sha.slice(0, 7)}</span>
            </span>
          ) : result.pushed ? (
            <span>
              Pushed <span className="font-mono text-fg">{result.readiness.branch ?? 'the branch'}</span>
            </span>
          ) : (
            <span>Nothing to commit</span>
          )}
          {result.commit && result.branch ? <span className="font-mono text-fg-3">on {result.branch}</span> : null}
          {result.commit && result.pushed ? <span>· pushed</span> : null}
        </div>
        {pr ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon concept="pr" size={14} className="text-fg-3" />
            <Link variant="external" href={pr.url} className="min-w-0">
              <span className="font-mono">PR #{pr.number}</span>
              <span className="min-w-0 truncate">{pr.title}</span>
            </Link>
            {pr.draft ? <Badge>Draft</Badge> : null}
          </div>
        ) : null}
      </div>
    );
  }
  if (result.status === 'conflicts') return null;
  const failing = failingStep(result);
  const detail = failing?.detail ?? result.error;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {result.commit ? (
        // What already happened stays true: the commit is in the branch, only the later steps did not run.
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-ui text-fg-2" data-testid="scm-result-partial">
          <Icon concept="status-succeeded" size={14} className="text-ok" />
          <span>
            Committed <span className="font-mono text-fg">{result.commit.sha.slice(0, 7)}</span>
          </span>
          {result.pushed ? <span>· pushed</span> : <span>· not pushed yet</span>}
        </div>
      ) : null}
      <Callout tone="err" role="alert" data-testid="scm-result-problem">
        {result.status === 'blocked' ? 'Blocked' : 'Failed'}
        {failing ? ` at ${SCM_STEP_LABEL[failing.id]}` : ''}
        {detail ? ` — ${detail}` : ''}
      </Callout>
    </div>
  );
}
