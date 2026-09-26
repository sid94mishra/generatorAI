// ────────────────────────────────────────────────────────────────
// CommitBarView — the Changes panel's "Ship" footer (F-dock-01 CommitBar),
// pure: CommitBar feeds it from useCommitBar.
//
// Anatomy (boards DockChanges "Ship", Main dock footer): mount picker (only
// with a choice) · status line (branch, ahead/behind, open PR) · either the
// blocked callout (with "Connect GitHub" when an account is the fix) or the
// form: commit message + Generate, Push / Open pull request toggles, the PR
// card (head → base, title + Generate, description, draft), one primary
// action whose label says what will run · the server's own step list · the
// conflict card slot · the outcome.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import type { RepoReadiness, ScmFlowResult, ScmFlowStep } from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { StepRail, type StepRailItem } from '@/ui/patterns/StepRail/StepRail.js';
import { failingStep, SCM_SETTINGS_PATH, SCM_STEP_LABEL, type ScmAvailability } from './scmFlow.js';
import type { ScmTextKind } from './useCommitBar.js';

export interface CommitBarViewProps {
  repos: RepoReadiness[];
  selected: RepoReadiness;
  onSelectAlias: (alias: string) => void;
  availability: ScmAvailability;

  message: string;
  onMessageChange: (value: string) => void;
  push: boolean;
  onPushChange: (value: boolean) => void;
  openPr: boolean;
  onOpenPrChange: (value: boolean) => void;
  prTitle: string;
  onPrTitleChange: (value: string) => void;
  prBody: string;
  onPrBodyChange: (value: string) => void;
  base: string;
  onBaseChange: (value: string) => void;
  draft: boolean;
  onDraftChange: (value: boolean) => void;

  generating: ScmTextKind | null;
  onGenerate: (kind: ScmTextKind) => void;
  running: boolean;
  result: ScmFlowResult | null;
  onRun: () => void;
  /** The conflict card (ScmConflictActions) when a merge needs a decision. */
  conflicts?: ReactNode;
  className?: string;
}

const shell = 'flex min-w-0 flex-col gap-2 border-t border-line px-3 py-2.5';

function mountLabel(alias: string): string {
  return alias === '.' ? 'workspace' : alias;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Readiness is loading. */
export function CommitBarLoading({ className }: { className?: string }) {
  return (
    <div className={cn(shell, 'flex-row items-center text-small text-fg-2', className)}>
      <Spinner size={14} /> Checking source control…
    </div>
  );
}

export function CommitBarView({
  repos,
  selected,
  onSelectAlias,
  availability,
  message,
  onMessageChange,
  push,
  onPushChange,
  openPr,
  onOpenPrChange,
  prTitle,
  onPrTitleChange,
  prBody,
  onPrBodyChange,
  base,
  onBaseChange,
  draft,
  onDraftChange,
  generating,
  onGenerate,
  running,
  result,
  onRun,
  conflicts,
  className,
}: CommitBarViewProps) {
  const { blockedReason, needsConnect, canPush, canOpenPr, mergeInProgress } = availability;
  const prOn = openPr && canOpenPr;
  const pushOn = push && canPush;
  // One note for what the toggles cannot do (the connect link covers the PR when it is the fix).
  const unavailable = [
    ...new Set(
      [!canPush ? selected.reasons.push : undefined, !canOpenPr && !needsConnect ? selected.reasons.pullRequest : undefined].filter(
        (r): r is string => !!r,
      ),
    ),
  ];
  const showHead = !!selected.branch && !selected.onDefaultBranch;

  return (
    <section aria-label="Source control" className={cn(shell, className)} data-testid="scm-panel">
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
        <Icon concept="branch" size={12} className="text-fg-3" />
        <span className="min-w-0 truncate font-mono text-fg">{selected.branch ?? 'detached HEAD'}</span>
        {selected.hasUpstream ? (
          <span className="text-fg-3">
            {selected.ahead ?? 0} ahead · {selected.behind ?? 0} behind
          </span>
        ) : null}
        {selected.openPullRequest ? (
          <Link variant="external" href={selected.openPullRequest.url} data-testid="scm-open-pr-link">
            PR #{selected.openPullRequest.number} open
          </Link>
        ) : null}
      </div>

      {blockedReason ? (
        <Callout
          tone="warn"
          data-testid="scm-blocked"
          action={
            needsConnect ? (
              <Button size="sm" render={<RouterLink to={SCM_SETTINGS_PATH} />} data-testid="scm-connect-github">
                Connect GitHub
              </Button>
            ) : undefined
          }
        >
          {blockedReason}
        </Callout>
      ) : mergeInProgress ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <Textarea
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            placeholder="Commit message (leave blank to generate one)"
            aria-label="Commit message"
            autosize={{ minRows: 2, maxRows: 6 }}
            data-testid="scm-commit-message"
            footer={
              <>
                <span className="min-w-0 flex-1 truncate text-small text-fg-3">
                  {selected.dirty && selected.changedFiles > 0
                    ? `Commits all ${plural(selected.changedFiles, 'changed file', 'changed files')}`
                    : null}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={generating === 'commit'}
                  onClick={() => onGenerate('commit')}
                  data-testid="scm-generate-commit"
                >
                  Generate
                </Button>
              </>
            }
          />

          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
            <Checkbox
              label="Push"
              checked={canPush && (push || openPr)}
              disabled={openPr || !canPush}
              onCheckedChange={onPushChange}
              data-testid="scm-toggle-push"
            />
            <Checkbox
              label="Open pull request"
              checked={prOn}
              disabled={!canOpenPr}
              onCheckedChange={onOpenPrChange}
              data-testid="scm-toggle-pr"
            />
            {needsConnect && !canOpenPr ? (
              <Button
                variant="ghost"
                size="sm"
                render={<RouterLink to={SCM_SETTINGS_PATH} />}
                data-testid="scm-connect-github"
                className="ml-auto"
              >
                Connect to open pull requests
              </Button>
            ) : null}
          </div>
          {unavailable.length > 0 ? <p className="text-small text-fg-3">{unavailable.join(' · ')}</p> : null}

          {prOn ? (
            <div className="flex min-w-0 flex-col gap-2 rounded-card border border-line p-2.5" data-testid="scm-pr-form">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Icon concept="pr" size={14} className="text-fg-3" />
                <span className="text-ui font-medium text-fg">Pull request</span>
                <span className="ml-auto flex min-w-0 items-center gap-1.5">
                  {showHead ? (
                    <>
                      <Badge icon="branch" className="min-w-0 font-mono">
                        <span className="truncate">{selected.branch}</span>
                      </Badge>
                      <Icon concept="forward" size={12} className="text-fg-3" />
                    </>
                  ) : null}
                  <Input
                    size="sm"
                    mono
                    leading="branch"
                    value={base}
                    onChange={(e) => onBaseChange(e.target.value)}
                    placeholder={selected.defaultBranch ?? 'base branch'}
                    aria-label="Base branch"
                    data-testid="scm-pr-base"
                    className="w-36"
                  />
                </span>
              </div>
              <Input
                size="sm"
                value={prTitle}
                onChange={(e) => onPrTitleChange(e.target.value)}
                placeholder="Pull request title (leave blank to generate)"
                aria-label="Pull request title"
                data-testid="scm-pr-title"
                trailing={
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={generating === 'pull_request'}
                    onClick={() => onGenerate('pull_request')}
                    data-testid="scm-generate-pr"
                    className="-mr-1.5"
                  >
                    Generate
                  </Button>
                }
              />
              <Textarea
                value={prBody}
                onChange={(e) => onPrBodyChange(e.target.value)}
                placeholder="Description (optional)"
                aria-label="Pull request description"
                autosize={{ minRows: 2, maxRows: 8 }}
                data-testid="scm-pr-body"
              />
              <Checkbox label="Open as draft" checked={draft} onCheckedChange={onDraftChange} data-testid="scm-pr-draft" />
            </div>
          ) : null}

          <div className="flex min-w-0 items-center justify-end gap-2">
            <Button
              variant="primary"
              icon={prOn ? 'pr' : 'commit'}
              loading={running}
              disabled={!selected.can.commit && !selected.dirty && !pushOn && !prOn}
              onClick={onRun}
              data-testid="scm-run-flow"
            >
              {prOn ? 'Commit & open pull request' : pushOn ? 'Commit & push' : 'Commit'}
            </Button>
          </div>
        </div>
      )}

      {running || result ? <ScmFlowSteps steps={result?.steps ?? []} running={running} /> : null}

      {conflicts}

      {result ? <ScmResultSummary result={result} /> : null}
    </section>
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
    ...(step.detail ? { target: step.detail } : {}),
    ...(step.status === 'skipped' ? { result: 'skipped', resultTone: 'muted' as const } : {}),
  }));
  if (running) items.push({ id: 'running', glyph: <Spinner size={14} className="text-run" />, verb: 'Running…' });
  return <StepRail items={items} label="Source control steps" data-testid="scm-steps" />;
}

/** The outcome: what landed, or why nothing did. Conflicts render the conflict card instead. */
export function ScmResultSummary({ result }: { result: ScmFlowResult }) {
  if (result.status === 'ok') {
    const pr = result.pullRequest;
    return (
      <div className="flex min-w-0 flex-col gap-1 text-small" data-testid="scm-result-ok" role="status">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-fg-2">
          <Icon concept="status-succeeded" size={14} className="text-ok" />
          {result.commit ? (
            <span>
              Committed <span className="font-mono text-fg">{result.commit.sha.slice(0, 7)}</span>
            </span>
          ) : (
            <span>Nothing to commit</span>
          )}
          {result.branch ? <span className="font-mono text-fg-3">on {result.branch}</span> : null}
          {result.pushed ? <span>· pushed</span> : null}
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
    <Callout tone="err" role="alert" data-testid="scm-result-problem">
      {result.status === 'blocked' ? 'Blocked' : 'Failed'}
      {failing ? ` at ${SCM_STEP_LABEL[failing.id]}` : ''}
      {detail ? ` — ${detail}` : ''}
    </Callout>
  );
}
