// ────────────────────────────────────────────────────────────────
// SourceControlPanel — the Changes tab's commit → push → PR block.
//
// Replaces the old "Commit / Pull request" pair, which offered both
// buttons unconditionally and failed at the server when the mount was not
// a repo or the host was not connected. Everything here is driven by
// `GET /scm/readiness`, so each mount states what it can do and, when it
// cannot, exactly why — with a link to the fix when the fix is "connect
// an account".
//
// One primary button runs the whole flow (`POST /scm/flow`); the step list
// is the server's own, so what the user watches is what actually ran.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Check, ExternalLink, GitBranch, GitCommit, GitPullRequest, Github, Sparkles, X,
} from 'lucide-react';
import {
  Button,
  Input,
  Spinner,
  Textarea,
} from '@/components/ui/index.js';
import { toast } from '@/components/Toast.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';
import { cn } from '@/lib/utils.js';
import {
  useGenerateScmText,
  useRunScmFlow,
  useWorkspaceReadiness,
} from '@/hooks/queries.js';
import { ScmConflictActions } from './ScmConflictActions.js';
import type { RepoReadiness, ScmFlowRequest, ScmFlowResult, ScmFlowStep } from '@generatorai/shared';

export interface SourceControlPanelProps {
  workspaceId: string | undefined;
  /** Chat that owns this workspace, when there is one — gates "Ask the agent". */
  chatId?: string;
  /** Seeds generated commit/PR text (the chat name or the run's task). */
  hint?: string;
  /** Opens a path in the user's editor; omitted when that is unavailable. */
  onOpenFile?: (absolutePath: string) => void;
  className?: string;
}

const STEP_LABEL: Record<ScmFlowStep['id'], string> = {
  readiness: 'Checks',
  branch: 'Branch',
  commit: 'Commit',
  sync: 'Sync with base',
  push: 'Push',
  pull_request: 'Pull request',
};

/** Which repo the panel opens on: the first with changes, else the first. */
export function pickDefaultAlias(repos: RepoReadiness[]): string | undefined {
  return (repos.find((r) => r.dirty) ?? repos[0])?.alias;
}

export function SourceControlPanel({
  workspaceId,
  chatId,
  hint,
  onOpenFile,
  className,
}: SourceControlPanelProps) {
  const readiness = useWorkspaceReadiness(workspaceId);
  const flow = useRunScmFlow(workspaceId);
  const generate = useGenerateScmText(workspaceId);

  const repos = useMemo(() => readiness.data?.repos ?? [], [readiness.data]);
  const [alias, setAlias] = useState<string | undefined>(undefined);
  const selected = repos.find((r) => r.alias === alias) ?? repos[0];

  const [message, setMessage] = useState('');
  const [push, setPush] = useState(true);
  const [openPr, setOpenPr] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [base, setBase] = useState('');
  const [draft, setDraft] = useState(false);
  const [result, setResult] = useState<ScmFlowResult | null>(null);
  const [generating, setGenerating] = useState<null | 'commit' | 'pull_request'>(null);

  // Follow the selected repo's own default branch unless the user typed one.
  const [baseTouched, setBaseTouched] = useState(false);
  useEffect(() => {
    if (!baseTouched) setBase(selected?.defaultBranch ?? '');
  }, [selected?.defaultBranch, baseTouched]);

  // A different mount is a different commit, a different branch and a
  // different PR — carrying the old text over would silently commit one
  // repo's message onto another.
  useEffect(() => {
    setResult(null);
  }, [alias]);

  const doGenerate = useCallback(
    async (kind: 'commit' | 'pull_request') => {
      if (!selected) return;
      setGenerating(kind);
      try {
        const text = await generate.mutateAsync({
          alias: selected.alias,
          kind,
          ...(hint ? { hint } : {}),
          ...(kind === 'pull_request' && base ? { base } : {}),
        });
        if (kind === 'commit') setMessage(text.message ?? '');
        else {
          if (text.title) setPrTitle(text.title);
          if (text.body) setPrBody(text.body);
        }
      } catch (e) {
        toast({
          variant: 'error',
          title: 'Could not generate the text',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setGenerating(null);
      }
    },
    [generate, selected, hint, base],
  );

  const composeRequest = useCallback((): ScmFlowRequest => {
    const trimmed = message.trim();
    // What this mount cannot do is never asked for, whatever the toggles were
    // left at — `push` defaults to on, and a repo with no remote must still be
    // able to commit.
    const wantsPr = openPr && (selected?.can.pullRequest ?? false);
    const wantsPush = (push || wantsPr) && (selected?.can.push ?? false);
    return {
      ...(selected ? { alias: selected.alias } : {}),
      commit: trimmed ? { message: trimmed } : { generate: true },
      push: wantsPush,
      ...(wantsPr
        ? {
            pullRequest: {
              ...(prTitle.trim() ? { title: prTitle.trim() } : { generate: true }),
              ...(prBody.trim() ? { body: prBody.trim() } : {}),
              ...(base.trim() ? { base: base.trim() } : {}),
              draft,
            },
          }
        : {}),
      ...(hint ? { hint } : {}),
    };
  }, [message, push, openPr, prTitle, prBody, base, draft, selected, hint]);

  const runFlow = useCallback(async () => {
    try {
      const res = await flow.mutateAsync(composeRequest());
      setResult(res);
      if (res.status === 'ok') {
        setMessage('');
        toast({
          variant: 'success',
          title: res.pullRequest
            ? `Pull request #${res.pullRequest.number} ready`
            : res.pushed
              ? 'Pushed'
              : 'Committed',
          description: res.commit ? `${res.commit.sha.slice(0, 7)} · ${res.commit.message}` : undefined,
        });
      }
    } catch (e) {
      toast({
        variant: 'error',
        title: 'Source control failed',
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [flow, composeRequest]);

  if (!workspaceId) return null;
  if (readiness.isLoading) {
    return (
      <div className={cn('flex items-center gap-2 border-b px-2 py-2 text-[11px] text-muted-foreground', className)}>
        <Spinner size="xs" /> Checking source control…
      </div>
    );
  }
  if (repos.length === 0) return null;

  // Blocked means NOTHING here can work — and the server is the judge of that
  // (`can`), one capability at a time.
  //
  // This used to be decided locally from `hasRemote` / `connected`, and it hid
  // the whole form — commit message, Generate, Commit — behind "Remote host is
  // not connected" for any repo whose remote was not a signed-in forge: a
  // local bare remote, a company git server, or no remote at all. None of
  // that has anything to do with committing, and the server said so
  // (`can.commit: true, can.push: true`). The user could not commit their own
  // work from the app. A missing remote or account now costs only the toggle
  // it actually affects.
  const blockedReason = selected
    ? !selected.isRepo
      ? 'Not a git repository'
      : !selected.can.commit && !selected.can.push && !selected.can.pullRequest
        ? (selected.reasons.commit ?? selected.reasons.push ?? selected.reasons.pullRequest ?? 'Source control is unavailable here')
        : null
    : null;
  // "Connect GitHub" only helps when the remote is a hosted forge. For a local
  // path or a bare `host:path` there is no account to connect.
  const remoteIsHosted = !!selected?.remoteUrl && /^(https?:\/\/|ssh:\/\/|git@)/i.test(selected.remoteUrl);
  const needsConnect = !!selected && selected.isRepo && selected.hasRemote && !selected.connected && remoteIsHosted;
  const canPush = selected?.can.push ?? false;
  const canOpenPr = selected?.can.pullRequest ?? false;
  // A merge someone started (Resolve manually / Ask the agent, or a git
  // merge outside the app) has to be finished or abandoned before anything
  // else makes sense — the commit form would only be refused by the server.
  const mergeInProgress = !!selected && !blockedReason && selected.mergeInProgress && result?.status !== 'conflicts';

  return (
    <div className={cn('border-b px-2 py-2', className)} data-testid="scm-panel">
      {/* Mount selector — only when there is a choice to make. */}
      {repos.length > 1 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1" data-testid="scm-mount-picker">
          {repos.map((repo) => (
            <Button
              key={repo.alias}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAlias(repo.alias)}
              aria-pressed={repo.alias === selected?.alias}
              className={cn(
                'h-auto rounded-md border px-1.5 py-0.5 text-[10.5px] font-normal',
                repo.alias === selected?.alias
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-subtle',
              )}
            >
              {repo.alias === '.' ? 'workspace' : repo.alias}
            </Button>
          ))}
        </div>
      )}

      {/* Status line */}
      {selected && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" data-testid="scm-status-line">
          <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="font-mono text-foreground">{selected.branch ?? 'detached HEAD'}</span>
          {selected.hasUpstream && (
            <span className="text-muted-foreground">
              {selected.ahead ?? 0} ahead · {selected.behind ?? 0} behind
            </span>
          )}
          {selected.openPullRequest && (
            <a
              href={selected.openPullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              data-testid="scm-open-pr-link"
            >
              <GitPullRequest className="h-3 w-3" />
              PR #{selected.openPullRequest.number} open
              <ExternalLink className="h-2.5 w-2.5 opacity-70" />
            </a>
          )}
        </div>
      )}

      {/* Why nothing can be done here, and the one-click fix when there is one. */}
      {blockedReason ? (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-border bg-subtle/50 px-2 py-1.5 text-[11px] text-muted-foreground"
          data-testid="scm-blocked"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">{blockedReason}</span>
          {needsConnect && (
            <Link
              to="/settings/source-control"
              data-testid="scm-connect-github"
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 text-[10.5px] font-medium text-foreground hover:bg-subtle"
            >
              <Github className="h-3 w-3" /> Connect GitHub
            </Link>
          )}
        </div>
      ) : mergeInProgress ? null : (
        <div className="mt-1.5 space-y-1.5">
          {/* Commit message + Generate */}
          <div className="relative">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Commit message (leave blank to generate one)"
              aria-label="Commit message"
              rows={2}
              data-testid="scm-commit-message"
              className="resize-none px-2 py-1 pr-20 text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void doGenerate('commit')}
              loading={generating === 'commit'}
              leftIcon={<Sparkles className="h-3 w-3" />}
              data-testid="scm-generate-commit"
              className="absolute right-1 top-1 h-6 rounded px-1.5 text-[10.5px] font-normal"
            >
              Generate
            </Button>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <label className="inline-flex items-center gap-1.5">
              <Checkbox
                checked={canPush && (push || openPr)}
                disabled={openPr || !canPush}
                onCheckedChange={(v) => setPush(v === true)}
                data-testid="scm-toggle-push"
                className="h-3.5 w-3.5"
              />
              Push
            </label>
            <label
              className={cn('inline-flex items-center gap-1.5', !canOpenPr && 'text-muted-foreground')}
              title={!canOpenPr ? selected?.reasons.pullRequest : undefined}
            >
              <Checkbox
                checked={canOpenPr && openPr}
                disabled={!canOpenPr}
                onCheckedChange={(v) => {
                  setOpenPr(v === true);
                  // A PR needs a pushed branch; saying so by forcing the
                  // toggle is clearer than failing at step 5.
                  if (v === true) setPush(true);
                }}
                data-testid="scm-toggle-pr"
                className="h-3.5 w-3.5"
              />
              Open pull request
            </label>
            {selected && !canPush && selected.reasons.push && (
              <span className="text-muted-foreground">{selected.reasons.push}</span>
            )}
            {needsConnect && !canOpenPr && (
              <Link
                to="/settings/source-control"
                data-testid="scm-connect-github"
                className="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 text-[10.5px] font-medium text-foreground hover:bg-subtle"
              >
                <Github className="h-3 w-3" /> Connect to open pull requests
              </Link>
            )}
          </div>

          {openPr && canOpenPr && (
            <div className="space-y-1.5 rounded-md border border-border p-1.5" data-testid="scm-pr-form">
              <div className="relative">
                <Input
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  placeholder="Pull request title (leave blank to generate)"
                  aria-label="Pull request title"
                  data-testid="scm-pr-title"
                  className="h-7 px-2 pr-20 text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void doGenerate('pull_request')}
                  loading={generating === 'pull_request'}
                  leftIcon={<Sparkles className="h-3 w-3" />}
                  data-testid="scm-generate-pr"
                  className="absolute right-0.5 top-0.5 h-6 rounded px-1.5 text-[10.5px] font-normal"
                >
                  Generate
                </Button>
              </div>
              <Textarea
                value={prBody}
                onChange={(e) => setPrBody(e.target.value)}
                placeholder="Description (optional)"
                aria-label="Pull request description"
                rows={2}
                data-testid="scm-pr-body"
                className="resize-none px-2 py-1 text-xs"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={base}
                  onChange={(e) => { setBase(e.target.value); setBaseTouched(true); }}
                  placeholder={selected?.defaultBranch ?? 'base branch'}
                  aria-label="Base branch"
                  data-testid="scm-pr-base"
                  className="h-7 w-40 px-2 text-xs"
                />
                <label className="inline-flex items-center gap-1.5 text-[11px]">
                  <Checkbox
                    checked={draft}
                    onCheckedChange={(v) => setDraft(v === true)}
                    data-testid="scm-pr-draft"
                    className="h-3.5 w-3.5"
                  />
                  Draft
                </label>
              </div>
            </div>
          )}

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void runFlow()}
            loading={flow.isPending}
            disabled={!selected?.can.commit && !selected?.dirty && !(push && canPush) && !(openPr && canOpenPr)}
            leftIcon={openPr && canOpenPr ? <GitPullRequest className="h-3 w-3" /> : <GitCommit className="h-3 w-3" />}
            data-testid="scm-run-flow"
          >
            {openPr && canOpenPr ? 'Commit & open pull request' : push && canPush ? 'Commit & push' : 'Commit'}
          </Button>
        </div>
      )}

      {/* Step list — the server's own steps, so what is shown is what ran. */}
      {(flow.isPending || result) && (
        <ul className="mt-2 space-y-0.5" data-testid="scm-steps">
          {(result?.steps ?? []).map((step) => (
            <li key={step.id} className="flex items-center gap-1.5 text-[11px]">
              <StepIcon status={step.status} />
              <span className="text-foreground">{STEP_LABEL[step.id]}</span>
              {step.detail && <span className="truncate text-muted-foreground">{step.detail}</span>}
            </li>
          ))}
          {flow.isPending && (
            <li className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Spinner size="xs" /> Running…
            </li>
          )}
        </ul>
      )}

      {mergeInProgress && selected && (
        <ScmConflictActions
          className="mt-2"
          workspaceId={workspaceId}
          conflicts={{
            base: selected.defaultBranch ?? (base.trim() || 'main'),
            head: selected.branch ?? 'HEAD',
            files: selected.conflictedFiles,
            mergeStarted: true,
          }}
          alias={selected.alias}
          {...(chatId ? { chatId } : {})}
          {...(onOpenFile
            ? { onOpenFile: (file: string) => onOpenFile(joinPath(selected.repoDir, file)) }
            : {})}
          onContinued={() => void runFlow()}
          onAborted={() => setResult(null)}
        />
      )}

      {result && <ScmResultSummary result={result} />}

      {result?.status === 'conflicts' && result.conflicts && (
        <ScmConflictActions
          className="mt-2"
          workspaceId={workspaceId}
          conflicts={result.conflicts}
          alias={result.alias}
          {...(chatId ? { chatId } : {})}
          {...(onOpenFile
            ? { onOpenFile: (file: string) => onOpenFile(joinPath(result.readiness.repoDir, file)) }
            : {})}
          onContinued={() => void runFlow()}
          onAborted={() => setResult(null)}
        />
      )}
    </div>
  );
}

/** Join a repo directory and a repo-relative path without assuming a separator. */
export function joinPath(dir: string, relative: string): string {
  if (!dir) return relative;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const trimmed = dir.endsWith('/') || dir.endsWith('\\') ? dir.slice(0, -1) : dir;
  return `${trimmed}${sep}${relative.replace(/^[\\/]+/, '')}`;
}

function StepIcon({ status }: { status: ScmFlowStep['status'] }) {
  if (status === 'done') return <Check className="h-3 w-3 shrink-0 text-success" />;
  if (status === 'failed' || status === 'blocked') return <X className="h-3 w-3 shrink-0 text-danger" />;
  return <span className="h-3 w-3 shrink-0 text-center text-[9px] text-muted-foreground">–</span>;
}

/** The one-line outcome: what landed, or why nothing did. */
export function ScmResultSummary({ result }: { result: ScmFlowResult }) {
  if (result.status === 'ok') {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]" data-testid="scm-result-ok">
        {result.commit && (
          <span className="inline-flex items-center gap-1 text-success">
            <GitCommit className="h-3 w-3" />
            <span className="font-mono">{result.commit.sha.slice(0, 7)}</span>
          </span>
        )}
        {result.pushed && <span className="text-success">pushed</span>}
        {result.pullRequest && (
          <a
            href={result.pullRequest.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <GitPullRequest className="h-3 w-3" />
            PR #{result.pullRequest.number}
            <ExternalLink className="h-2.5 w-2.5 opacity-70" />
          </a>
        )}
      </div>
    );
  }
  if (result.status === 'conflicts') return null;
  const failing = result.steps.find((s) => s.status === 'failed' || s.status === 'blocked');
  return (
    <div
      className="mt-1.5 flex items-start gap-1.5 rounded-md bg-danger-muted px-2 py-1 text-[11px] text-danger"
      data-testid="scm-result-problem"
    >
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
      <span>
        {result.status === 'blocked' ? 'Blocked' : 'Failed'}
        {failing ? ` at ${STEP_LABEL[failing.id]}` : ''}
        {failing?.detail || result.error ? ` — ${failing?.detail ?? result.error}` : ''}
      </span>
    </div>
  );
}
