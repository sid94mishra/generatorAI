// ────────────────────────────────────────────────────────────────
// PullRequestPage (P5-06; T-02 DetailPage + the DiffView block; D-31, no
// board — recipe in 04-screen-map.md §3; F-projects-10).
//
// PageHeader (Projects / project / codebase / #n · state · Open on GitHub),
// PageTitle (title; author · head → base · ± · files · commits), a status
// card (mergeability, checks), tabs Files / Comments, and a rail with the
// Merge control (D-146), "Review in chat" (the reason this page exists rather than a link to
// GitHub: a chat on the PR's head branch seeded with the review prompt) and
// the description. A file's diff is parsed and rendered only once it is
// expanded — a PR with 200 files should not parse 200 patches to list names.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import type { PullRequestFile, ScmChecksSummary } from '@generatorai/shared';
import { DiffCodeView, DiffProviders } from '@/blocks/diff/index.js';
import { DIFF_LINE_HEIGHT } from '@/blocks/diff/diffTheme.js';
import { useDocumentSmallTextPx } from '@/blocks/diff/useDocumentAppearance.js';
import { ModelPicker } from '@/blocks/model-picker/index.js';
import { useProject, useProjectCodebases } from '@/hooks/projectQueries.js';
import {
  useCreatePullRequestReviewChat,
  usePullRequest,
  usePullRequestComments,
  usePullRequestFiles,
} from '@/hooks/queries.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Tabs } from '@/ui/primitives/Tabs/Tabs.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { DetailPage } from '@/ui/templates/DetailPage/DetailPage.js';
import { PR_STATE_TONE } from './detail/PullRequestsTab.js';
import { MergePullRequestCard } from './MergePullRequestCard.js';
import { useNarrow } from '@/lib/useNarrow.js';
import { formatWhen } from '@/lib/formatWhen.js';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';

const FILE_STATUS_TONE: Record<PullRequestFile['status'], string> = {
  added: 'text-ok',
  modified: 'text-warn',
  removed: 'text-err',
  renamed: 'text-run',
};
/** Tallest an expanded file's diff grows before it scrolls inside itself. */
const MAX_DIFF_PX = 640;

function ChecksLine({ checks }: { checks: ScmChecksSummary }) {
  const tone = checks.conclusion === 'success' ? 'text-ok' : checks.conclusion === 'failure' ? 'text-err' : 'text-fg-2';
  return (
    <span className={cn('inline-flex items-center gap-1.5', tone)} data-testid="pr-checks">
      <Icon concept="pr" size={14} />
      {checks.passed}/{checks.total} checks passed
      {checks.failed > 0 ? <span className="text-err">· {checks.failed} failed</span> : null}
      {checks.pending > 0 ? <span className="text-warn">· {checks.pending} pending</span> : null}
    </span>
  );
}

/** One changed file; its DiffView mounts only when expanded. */
function PrFileRow({ file }: { file: PullRequestFile }) {
  const [open, setOpen] = useState(false);
  const lineHeight = useDocumentSmallTextPx() * DIFF_LINE_HEIGHT;
  const source = useMemo(() => {
    if (!open || !file.patch) return null;
    const from = file.previousPath ?? file.path;
    // GitHub sends hunks only; the diff parser wants the file headers too.
    const patch = `diff --git a/${from} b/${file.path}\n--- a/${from}\n+++ b/${file.path}\n${file.patch}`;
    return { id: file.path, alias: '', path: file.path, patch, cacheKey: `pr:${file.path}:${file.patch.length}` };
  }, [open, file]);
  const rows = file.patch ? file.patch.split('\n').length : 0;
  const height = Math.min(MAX_DIFF_PX, Math.ceil((rows + 2) * lineHeight));

  return (
    <li className="border-b border-line-soft last:border-b-0">
      <Button
        variant="ghost"
        fullWidth
        aria-expanded={open}
        data-testid="pr-file-row"
        onClick={() => setOpen((v) => !v)}
        className="justify-start rounded-none text-fg"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Icon concept={open ? 'chevron-down' : 'chevron-right'} size={14} className="shrink-0 text-fg-3" />
          <span className="min-w-0 flex-1 truncate text-left font-mono text-small">
            {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
          </span>
          <span className={cn('shrink-0 text-micro uppercase', FILE_STATUS_TONE[file.status])}>{file.status}</span>
          <span className="shrink-0 font-mono text-micro">
            <span className="text-ok">+{file.additions}</span> <span className="text-err">−{file.deletions}</span>
          </span>
        </span>
      </Button>
      <Reveal open={open}>
        <div className="border-t border-line-soft">
          {source ? (
            <DiffCodeView sources={[source]} renderHeader={() => null} headerHeight={0} style={{ height }} />
          ) : (
            <p className="px-3.5 py-3 text-small text-fg-3">No diff available for this file (binary, or too large to include).</p>
          )}
        </div>
      </Reveal>
    </li>
  );
}

export function PullRequestPage() {
  const { id: projectId, cid: codebaseId, number: numberParam } = useParams<{ id: string; cid: string; number: string }>();
  const navigate = useNavigate();
  const number = Number(numberParam);
  const pr = usePullRequest(projectId, codebaseId, number);
  const files = usePullRequestFiles(projectId, codebaseId, number);
  const comments = usePullRequestComments(projectId, codebaseId, number);
  const reviewChat = useCreatePullRequestReviewChat(projectId, codebaseId, number);
  const { data: project } = useProject(projectId);
  const { data: codebases } = useProjectCodebases(projectId);
  const codebase = codebases?.find((cb) => cb.id === codebaseId);
  const [tab, setTab] = useState<'files' | 'comments'>('files');
  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState('');
  const [ref, narrow] = useNarrow<HTMLDivElement>();
  usePageTitle(pr.data ? `#${pr.data.number} ${pr.data.title}` : undefined);

  const startReview = async () => {
    try {
      const { chat } = await reviewChat.mutateAsync({
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(model ? { model } : {}),
      });
      navigate(`/chats/${chat.id}`);
    } catch (err) {
      toast.error("Couldn't start the review chat", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const breadcrumb = (
    <Breadcrumb
      items={[
        { label: 'Projects', render: <RouterLink to="/projects" /> },
        { label: project?.name ?? 'Project', render: <RouterLink to={`/projects/${projectId}/pull-requests`} /> },
        { label: codebase?.alias ?? 'Codebase', render: <RouterLink to={`/projects/${projectId}/codebases/${codebaseId}`} /> },
        { label: `#${numberParam ?? ''}`, mono: true },
      ]}
    />
  );

  if (pr.isLoading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader breadcrumb={breadcrumb} />
        <SkeletonRows rows={6} label="Loading pull request" className="p-7" />
      </div>
    );
  }
  if (pr.error || !pr.data) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader breadcrumb={breadcrumb} />
        <EmptyState
          className="flex-1"
          tone="error"
          icon="warning"
          title="Couldn't load the pull request"
          description={pr.error instanceof Error ? pr.error.message : 'Pull request not found.'}
          action={
            <Button size="sm" render={<RouterLink to={`/projects/${projectId}/pull-requests`} />}>
              Back to pull requests
            </Button>
          }
        />
      </div>
    );
  }

  const data = pr.data;
  const fileCount = files.data?.length;
  const commentCount = comments.data?.length;

  const filesPanel = (
    <Card data-testid="pr-files">
      {files.isLoading ? (
        <div className="flex items-center gap-2 p-4 text-small text-fg-3">
          <Spinner size={14} /> Loading the diff…
        </div>
      ) : files.error ? (
        <EmptyState className="p-6" tone="error" icon="warning" title="Couldn't load the files" description={String(files.error)} />
      ) : (fileCount ?? 0) === 0 ? (
        <p className="p-4 text-small text-fg-3">No file changes reported.</p>
      ) : (
        <DiffProviders>
          <ul>
            {files.data!.map((file) => (
              <PrFileRow key={file.path} file={file} />
            ))}
          </ul>
        </DiffProviders>
      )}
    </Card>
  );

  const commentsPanel = (
    <div className="flex flex-col gap-2" data-testid="pr-comments">
      {comments.isLoading ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading comments…
        </div>
      ) : (commentCount ?? 0) === 0 ? (
        <EmptyState framed icon="message" title="No comments yet" />
      ) : (
        comments.data!.map((comment) => (
          <Card key={comment.id}>
            <Card.Body>
              <div className="flex flex-wrap items-center gap-2 text-small text-fg-3">
                <span className="font-medium text-fg">{comment.author}</span>
                <span>{formatWhen(comment.createdAt)}</span>
                {comment.path ? (
                  <span className="font-mono">
                    {comment.path}
                    {comment.line ? `:${comment.line}` : ''}
                  </span>
                ) : null}
                <Badge>{comment.kind}</Badge>
              </div>
              <Markdown>{comment.body}</Markdown>
            </Card.Body>
          </Card>
        ))
      )}
    </div>
  );

  return (
    <DetailPage
      ref={ref}
      data-testid="pull-request-page"
      railStacked={narrow}
      header={
        <PageHeader
          breadcrumb={breadcrumb}
          status={
            <span className="flex items-center gap-1.5">
              <Badge tone={PR_STATE_TONE[data.state]} className="capitalize">
                {data.state}
              </Badge>
              {data.draft ? <Badge>Draft</Badge> : null}
            </span>
          }
          actions={
            <Button
              icon="external-link"
              render={<a href={data.url} target="_blank" rel="noopener noreferrer" />}
              data-testid="pr-open-on-github"
            >
              Open on GitHub
            </Button>
          }
        />
      }
      title={
        <PageTitle
          variant="detail"
          title={
            <>
              {data.title} <span className="font-mono text-fg-3">#{data.number}</span>
            </>
          }
          meta={[
            ...(data.author ? [data.author] : []),
            `${data.head} → ${data.base}`,
            <span key="stat">
              <span className="text-ok">+{data.additions}</span> <span className="text-err">−{data.deletions}</span>
            </span>,
            `${data.changedFiles} files`,
            `${data.commits} commits`,
          ]}
        />
      }
      banner={
        <Card className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-small">
          <span data-testid="pr-mergeable">
            {/* GitHub reports a merged or closed PR as "not mergeable": say what happened instead (D-146). */}
            {data.state === 'merged' ? (
              <span className="inline-flex items-center gap-1.5 text-run">
                <Icon concept="merge" size={14} /> Merged into <span className="font-mono">{data.base}</span>
              </span>
            ) : data.state === 'closed' ? (
              <span className="inline-flex items-center gap-1.5 text-fg-2">
                <Icon concept="x" size={14} /> Closed without merging
              </span>
            ) : data.mergeable === null ? (
              <span className="inline-flex items-center gap-1.5 text-fg-2">
                <Spinner size={12} /> Mergeability computing…
              </span>
            ) : data.mergeable ? (
              <span className="inline-flex items-center gap-1.5 text-ok">
                <Icon concept="check" size={14} /> Mergeable
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-err">
                <Icon concept="x" size={14} /> Not mergeable
              </span>
            )}
          </span>
          {data.mergeableState && data.state === 'open' ? <span className="text-fg-3">state: {data.mergeableState}</span> : null}
          {data.checks ? <ChecksLine checks={data.checks} /> : null}
        </Card>
      }
      tabs={
        <Tabs
          label="Pull request sections"
          value={tab}
          onValueChange={(v) => setTab(v as 'files' | 'comments')}
          items={[
            { value: 'files', label: 'Files', count: fileCount },
            { value: 'comments', label: 'Comments', count: commentCount },
          ]}
        />
      }
      content={tab === 'files' ? filesPanel : commentsPanel}
      rail={
        <>
          <MergePullRequestCard projectId={projectId} codebaseId={codebaseId} pr={data} />
          <Card data-testid="pr-review-panel">
            <Card.Header title="Review in chat" />
            <Card.Body>
              <p className="text-small text-fg-3">
                Creates a chat on <span className="font-mono">{data.head}</span> and asks the agent to review the diff.
              </p>
              <Field label="Instructions" optional>
                <Textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Anything to focus on"
                  aria-label="Review instructions"
                  data-testid="pr-review-instructions"
                />
              </Field>
              <Field label="Model">
                <ModelPicker variant="field" value={model} onChange={setModel} ariaLabel="Review model" />
              </Field>
              <Button variant="primary" icon="chats" loading={reviewChat.isPending} onClick={() => void startReview()} data-testid="pr-review-start">
                Review in chat
              </Button>
            </Card.Body>
          </Card>
          {data.body?.trim() ? (
            <Card data-testid="pr-body">
              <Card.Header title="Description" />
              <Card.Body>
                <Markdown>{data.body}</Markdown>
              </Card.Body>
            </Card>
          ) : null}
        </>
      }
    />
  );
}
