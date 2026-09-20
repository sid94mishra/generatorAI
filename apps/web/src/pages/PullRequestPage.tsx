// ────────────────────────────────────────────────────────────────
// PullRequestPage — one pull request, read in the app.
//
// Header (state, author, head→base, "Open on GitHub"), mergeability and
// checks, the description, every changed file with its diff, the comment
// thread, and — the reason this page exists rather than a link to GitHub —
// "Review in chat": a chat on the PR's head branch, seeded with the review
// prompt and whatever extra instructions the user typed.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, ExternalLink,
  FileDiff, GitPullRequest, MessageSquare, Sparkles, X,
} from 'lucide-react';
import { parseUnifiedDiff } from '@generatorai/client-core';
import {
  usePullRequest,
  usePullRequestFiles,
  usePullRequestComments,
  useCreatePullRequestReviewChat,
} from '@/hooks/queries.js';
import { Badge, Button, Spinner, Textarea, type BadgeTone } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { PageHeader } from '@/components/ui/index.js';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';
import { InlineDiff } from '@/components/chat/InlineDiff.js';
import { ModelPicker } from '@/components/shared/ModelPicker.js';
import { toast } from '@/components/Toast.js';
import { cn } from '@/lib/utils.js';
import type {
  ScmChecksSummary,
  PullRequestFile,
  ScmPullRequestState,
} from '@generatorai/shared';

const STATE_TONE: Record<ScmPullRequestState, BadgeTone> = {
  open: 'success',
  merged: 'primary',
  closed: 'danger',
};

const FILE_STATUS_TONE: Record<PullRequestFile['status'], string> = {
  added: 'text-success',
  modified: 'text-warning',
  removed: 'text-danger',
  renamed: 'text-info',
};

export function PullRequestPage() {
  const { id: projectId, cid: codebaseId, number: numberParam } = useParams<{
    id: string;
    cid: string;
    number: string;
  }>();
  const navigate = useNavigate();
  const number = Number(numberParam);

  const pr = usePullRequest(projectId, codebaseId, number);
  const files = usePullRequestFiles(projectId, codebaseId, number);
  const comments = usePullRequestComments(projectId, codebaseId, number);
  const reviewChat = useCreatePullRequestReviewChat(projectId, codebaseId, number);

  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleFile = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const startReview = useCallback(async () => {
    try {
      const { chat } = await reviewChat.mutateAsync({
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(model ? { model } : {}),
      });
      navigate(`/chats/${chat.id}`);
    } catch (e) {
      toast({
        variant: 'error',
        title: 'Could not start the review chat',
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [reviewChat, instructions, model, navigate]);

  if (pr.isLoading) {
    return (
      <PageContainer>
        <div className="flex h-full items-center justify-center"><Spinner /></div>
      </PageContainer>
    );
  }

  if (pr.error || !pr.data) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-danger" />
          <p className="text-sm text-muted-foreground">
            {(pr.error as Error)?.message ?? 'Pull request not found.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
            Back to project
          </Button>
        </div>
      </PageContainer>
    );
  }

  const data = pr.data;

  return (
    <PageContainer>
      <div className="space-y-4" data-testid="pull-request-page">
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <span className="truncate">{data.title}</span>
              <span className="shrink-0 font-mono text-sm text-muted-foreground">#{data.number}</span>
            </span>
          }
          subtitle={
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={STATE_TONE[data.state]} size="sm" className="capitalize">{data.state}</Badge>
              {data.draft && <Badge tone="neutral" size="sm">Draft</Badge>}
              {data.author && <span className="text-muted-foreground">{data.author}</span>}
              <span className="font-mono text-muted-foreground">{data.head} → {data.base}</span>
            </span>
          }
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/projects/${projectId}`)}
                leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
              >
                Project
              </Button>
              <a
                href={data.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-subtle"
                data-testid="pr-open-on-github"
              >
                Open on GitHub <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          }
        />

        {/* ── Mergeability + checks ─────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs">
          <span data-testid="pr-mergeable">
            {data.mergeable === null ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Spinner size="xs" /> Mergeability computing…
              </span>
            ) : data.mergeable ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <Check className="h-3.5 w-3.5" /> Mergeable
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-danger">
                <X className="h-3.5 w-3.5" /> Not mergeable
              </span>
            )}
          </span>
          {data.mergeableState && (
            <span className="text-muted-foreground">state: {data.mergeableState}</span>
          )}
          {data.checks && <ChecksLine checks={data.checks} />}
          <span className="ml-auto font-mono text-muted-foreground">
            <span className="text-success">+{data.additions}</span>{' '}
            <span className="text-danger">−{data.deletions}</span> · {data.changedFiles} files ·{' '}
            {data.commits} commits
          </span>
        </div>

        {/* ── Description ───────────────────────────────────────── */}
        {data.body?.trim() && (
          <section className="rounded-lg border border-border bg-card p-4" data-testid="pr-body">
            <MarkdownRenderer content={data.body} />
          </section>
        )}

        {/* ── Review in chat ────────────────────────────────────── */}
        <section className="rounded-lg border border-border bg-card p-4" data-testid="pr-review-panel">
          <h3 className="mb-1 text-sm font-medium text-foreground">Review in chat</h3>
          <p className="mb-2.5 text-xs text-muted-foreground">
            Creates a chat on <span className="font-mono">{data.head}</span> and asks the agent to
            review the diff. Add anything you want it to focus on.
          </p>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Review instructions (optional)"
            aria-label="Review instructions"
            rows={3}
            data-testid="pr-review-instructions"
            className="resize-none text-sm"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div className="min-w-[16rem] flex-1">
              <ModelPicker
                variant="field"
                allowEmpty
                emptyLabel="Default"
                value={model}
                onChange={setModel}
                ariaLabel="Review model"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void startReview()}
              loading={reviewChat.isPending}
              leftIcon={<Sparkles className="h-3.5 w-3.5" />}
              data-testid="pr-review-start"
            >
              Review in chat
            </Button>
          </div>
        </section>

        {/* ── Files ─────────────────────────────────────────────── */}
        <section data-testid="pr-files">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <FileDiff className="h-3.5 w-3.5" /> Files
            {files.data && <span className="text-muted-foreground">({files.data.length})</span>}
          </h3>
          {files.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" /> Loading the diff…
            </div>
          ) : (files.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">No file changes reported.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {files.data!.map((file) => (
                <PrFileRow
                  key={file.path}
                  file={file}
                  open={expanded.has(file.path)}
                  onToggle={() => toggleFile(file.path)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ── Comments ──────────────────────────────────────────── */}
        <section data-testid="pr-comments">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <MessageSquare className="h-3.5 w-3.5" /> Comments
            {comments.data && <span className="text-muted-foreground">({comments.data.length})</span>}
          </h3>
          {comments.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" /> Loading comments…
            </div>
          ) : (comments.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          ) : (
            <ul className="space-y-2">
              {comments.data!.map((comment) => (
                <li key={comment.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{comment.author}</span>
                    <span>{new Date(comment.createdAt).toLocaleString()}</span>
                    {comment.path && (
                      <span className="font-mono">
                        {comment.path}{comment.line ? `:${comment.line}` : ''}
                      </span>
                    )}
                    <Badge tone="neutral" size="sm">{comment.kind}</Badge>
                  </div>
                  <MarkdownRenderer content={comment.body} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="pb-6 text-xs text-muted-foreground">
          <Link to={`/projects/${projectId}`} className="hover:underline">
            ← All pull requests for this project
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}

function ChecksLine({ checks }: { checks: ScmChecksSummary }) {
  const tone =
    checks.conclusion === 'success'
      ? 'text-success'
      : checks.conclusion === 'failure'
        ? 'text-danger'
        : 'text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center gap-1.5', tone)} data-testid="pr-checks">
      <GitPullRequest className="h-3.5 w-3.5" />
      {checks.passed}/{checks.total} checks passed
      {checks.failed > 0 && <span className="text-danger">· {checks.failed} failed</span>}
      {checks.pending > 0 && <span className="text-warning">· {checks.pending} pending</span>}
    </span>
  );
}

function PrFileRow({
  file,
  open,
  onToggle,
}: {
  file: PullRequestFile;
  open: boolean;
  onToggle: () => void;
}) {
  // Parsed lazily: a PR with 200 files should not parse 200 patches to render
  // a list of file names.
  const parsed = useMemo(() => {
    if (!open || !file.patch) return null;
    const diff = parseUnifiedDiff(file.patch);
    // `InlineDiff` renders raw diff TEXT rows; the parser returns structured
    // rows. Re-attaching the marker is the whole conversion.
    return {
      truncated: diff.truncated,
      hunks: diff.hunks.map((h) => ({
        oldStart: h.oldStart,
        oldLines: h.oldLines,
        newStart: h.newStart,
        newLines: h.newLines,
        lines: h.rows.map(
          (r) => `${r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}${r.content}`,
        ),
      })),
    };
  }, [open, file.patch]);

  return (
    <li>
      <Button variant="unstyled"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="pr-file-row"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-subtle"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-foreground">
          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        </span>
        <span className={cn('shrink-0 text-[10px] uppercase', FILE_STATUS_TONE[file.status])}>
          {file.status}
        </span>
        <span className="shrink-0 font-mono text-[10px]">
          <span className="text-success">+{file.additions}</span>{' '}
          <span className="text-danger">−{file.deletions}</span>
        </span>
      </Button>
      {open && (
        <div className="px-3 pb-3">
          {parsed && parsed.hunks.length > 0 ? (
            <InlineDiff hunks={parsed.hunks} truncated={parsed.truncated} />
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No diff available for this file (binary, or too large to include).
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export default PullRequestPage;
