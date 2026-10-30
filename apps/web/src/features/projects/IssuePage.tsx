// ────────────────────────────────────────────────────────────────
// IssuePage (D-146; T-02 DetailPage, built like PullRequestPage).
//
// PageHeader (Projects / project / codebase / #n · state · Close · Open on
// GitHub), PageTitle (title; author · opened · comments), the description
// and the comment thread (Markdown) with a comment box, and a rail with
// "Fix in chat" — the reason this page exists rather than a link to GitHub:
// it opens the New chat dialog on the project with the issue as the first
// message, asking for a PR that closes it — and the issue's details.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import type { IssueCloseReason, IssueSummary } from '@generatorai/shared';
import { useProject, useProjectCodebases } from '@/hooks/projectQueries.js';
import { useCloseIssue, useCommentOnIssue, useIssue } from '@/hooks/queries.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { formatWhen } from '@/lib/formatWhen.js';
import { useNarrow } from '@/lib/useNarrow.js';
import { useNewChatStore } from '@/stores/newChatStore.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { KeyValueList } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Badge, type BadgeTone } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { DetailPage } from '@/ui/templates/DetailPage/DetailPage.js';
import { issueFixPrompt } from './githubActions.js';

function stateBadge(issue: IssueSummary): { tone: BadgeTone; label: string } {
  if (issue.state === 'open') return { tone: 'ok', label: 'Open' };
  return issue.stateReason === 'not_planned' ? { tone: 'neutral', label: 'Closed · not planned' } : { tone: 'run', label: 'Closed' };
}

const CLOSE_COPY: Record<IssueCloseReason, { label: string; title: string; description: string }> = {
  completed: { label: 'Close as completed', title: 'Close as completed?', description: 'The issue is done: it was fixed or answered.' },
  not_planned: { label: 'Close as not planned', title: 'Close as not planned?', description: 'Won’t fix, a duplicate, or no longer relevant.' },
};

export function IssuePage() {
  const { id: projectId, cid: codebaseId, number: numberParam } = useParams<{ id: string; cid: string; number: string }>();
  const number = Number(numberParam);
  const detail = useIssue(projectId, codebaseId, number);
  const comment = useCommentOnIssue(projectId, codebaseId, number);
  const close = useCloseIssue(projectId, codebaseId, number);
  const { data: project } = useProject(projectId);
  const { data: codebases } = useProjectCodebases(projectId);
  const codebase = codebases?.find((cb) => cb.id === codebaseId);
  const openNewChat = useNewChatStore((s) => s.open);
  const confirmer = useConfirm();
  const [draft, setDraft] = useState('');
  const [ref, narrow] = useNarrow<HTMLDivElement>();
  const issue = detail.data?.issue;
  usePageTitle(issue ? `#${issue.number} ${issue.title}` : undefined);

  const breadcrumb = (
    <Breadcrumb
      items={[
        { label: 'Projects', render: <RouterLink to="/projects" /> },
        { label: project?.name ?? 'Project', render: <RouterLink to={`/projects/${projectId}/issues`} /> },
        { label: codebase?.alias ?? 'Codebase', render: <RouterLink to={`/projects/${projectId}/codebases/${codebaseId}`} /> },
        { label: `#${numberParam ?? ''}`, mono: true },
      ]}
    />
  );

  if (detail.isLoading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader breadcrumb={breadcrumb} />
        <SkeletonRows rows={6} label="Loading issue" className="p-7" />
      </div>
    );
  }
  if (detail.error || !detail.data || !issue) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader breadcrumb={breadcrumb} />
        <EmptyState
          className="flex-1"
          tone="error"
          icon="warning"
          title="Couldn't load the issue"
          description={detail.error instanceof Error ? detail.error.message : 'Issue not found.'}
          action={
            <Button size="sm" render={<RouterLink to={`/projects/${projectId}/issues`} />}>
              Back to issues
            </Button>
          }
        />
      </div>
    );
  }

  const comments = detail.data.comments;
  const badge = stateBadge(issue);

  const closeAs = async (reason: IssueCloseReason) => {
    const copy = CLOSE_COPY[reason];
    const ok = await confirmer.confirm({ title: copy.title, description: copy.description, confirmLabel: copy.label, tone: 'primary' });
    if (!ok) return;
    try {
      await close.mutateAsync({ reason });
    } catch (err) {
      toast.error("Couldn't close the issue", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const postComment = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await comment.mutateAsync(body);
      setDraft('');
    } catch (err) {
      toast.error("Couldn't post the comment", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const fixInChat = () =>
    openNewChat({ ...(projectId ? { projectId } : {}), name: `Fix #${issue.number}: ${issue.title}`.slice(0, 120), prompt: issueFixPrompt(issue) });

  const content = (
    <div className="flex flex-col gap-3">
      <Card data-testid="issue-body">
        <Card.Header title="Description" meta={issue.author ? `${issue.author} · ${formatWhen(issue.createdAt)}` : formatWhen(issue.createdAt)} />
        <Card.Body>
          {issue.body.trim() ? <Markdown>{issue.body}</Markdown> : <p className="text-small text-fg-3">No description provided.</p>}
        </Card.Body>
      </Card>
      <div className="flex flex-col gap-2" data-testid="issue-comments">
        {comments.map((c) => (
          <Card key={c.id}>
            <Card.Body>
              <div className="flex flex-wrap items-center gap-2 text-small text-fg-3">
                <span className="font-medium text-fg">{c.author}</span>
                <span>{formatWhen(c.createdAt)}</span>
              </div>
              <Markdown>{c.body}</Markdown>
            </Card.Body>
          </Card>
        ))}
      </div>
      <Card data-testid="issue-comment-box">
        <Card.Body>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Leave a comment (Markdown)"
            aria-label="Comment"
            autosize={{ minRows: 3, maxRows: 12 }}
            data-testid="issue-comment-input"
          />
          <Button
            variant="primary"
            icon="message"
            className="self-end"
            disabled={!draft.trim()}
            loading={comment.isPending}
            onClick={() => void postComment()}
            data-testid="issue-comment-submit"
          >
            Comment
          </Button>
        </Card.Body>
      </Card>
    </div>
  );

  return (
    <>
      <DetailPage
        ref={ref}
        data-testid="issue-page"
        railStacked={narrow}
        header={
          <PageHeader
            breadcrumb={breadcrumb}
            status={<Badge tone={badge.tone}>{badge.label}</Badge>}
            actions={
              <>
                {issue.state === 'open' ? (
                  <MenuButton
                    label="Close issue"
                    icon="check"
                    data-testid="issue-close"
                    items={(['completed', 'not_planned'] as const).map((reason) => ({
                      id: reason,
                      label: CLOSE_COPY[reason].label,
                      onSelect: () => void closeAs(reason),
                    }))}
                  />
                ) : null}
                <Button
                  icon="external-link"
                  render={<a href={issue.url} target="_blank" rel="noopener noreferrer" />}
                  data-testid="issue-open-on-github"
                >
                  Open on GitHub
                </Button>
              </>
            }
          />
        }
        title={
          <PageTitle
            variant="detail"
            title={
              <>
                {issue.title} <span className="font-mono text-fg-3">#{issue.number}</span>
              </>
            }
            meta={[
              ...(issue.author ? [issue.author] : []),
              `opened ${formatWhen(issue.createdAt)}`,
              `${issue.comments} ${issue.comments === 1 ? 'comment' : 'comments'}`,
            ]}
          />
        }
        content={content}
        rail={
          <>
            <Card data-testid="issue-fix-panel">
              <Card.Header title="Fix in chat" />
              <Card.Body>
                <p className="text-small text-fg-3">
                  Opens a new chat in this project with the issue as its first message, asking the agent for a pull request that
                  closes <span className="font-mono">#{issue.number}</span>.
                </p>
                <Button variant="primary" icon="chats" className="self-start" onClick={fixInChat} data-testid="issue-fix-in-chat">
                  Fix in chat
                </Button>
              </Card.Body>
            </Card>
            <Card data-testid="issue-details">
              <Card.Header title="Details" />
              <Card.Body>
                <KeyValueList
                  dense
                  items={[
                    {
                      label: 'Labels',
                      value:
                        issue.labels.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {issue.labels.map((label) => (
                              <Badge key={label} size="sm">
                                {label}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          'None'
                        ),
                    },
                    { label: 'Codebase', value: codebase?.alias ?? '—', mono: true },
                    { label: 'Updated', value: formatWhen(issue.updatedAt) },
                  ]}
                />
              </Card.Body>
            </Card>
          </>
        }
      />
      {confirmer.dialog}
    </>
  );
}
