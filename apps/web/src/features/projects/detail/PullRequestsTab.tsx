// ────────────────────────────────────────────────────────────────
// ProjectDetail · Pull requests (P5-04; D-31; F-projects-06). Every PR across
// the project's codebases (restyled from scm/ProjectPullRequestsTab): an
// Open / Closed / All scope and a DataTable — # · Title (codebase, head → base,
// author) · State · Updated; a row opens the PR page. Codebases that could
// NOT be listed stay visible with the server's reason (a silently short list
// would read as "nothing in flight"), with Connect GitHub when that is the fix.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import type { ProjectPullRequest, ScmPullRequestState } from '@generatorai/shared';
import { useProjectPullRequests } from '@/hooks/queries.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import { DataTable, type DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { Badge, type BadgeTone } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';

type StateFilter = 'open' | 'closed' | 'all';

export const PR_STATE_TONE: Record<ScmPullRequestState, BadgeTone> = { open: 'ok', merged: 'run', closed: 'err' };

/** True when the reason is the one thing Settings › Source control can fix. */
export function isConnectReason(reason: string): boolean {
  return /not connected|connect it in settings|no account/i.test(reason);
}

export function PullRequestsTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<StateFilter>('open');
  const { data, isLoading, isError, error } = useProjectPullRequests(projectId, state);
  const href = (pr: ProjectPullRequest) => `/projects/${projectId}/codebases/${pr.codebaseId}/pull-requests/${pr.number}`;

  const columns: DataTableColumn<ProjectPullRequest>[] = [
    { id: 'number', header: '#', width: 64, mono: true, cell: (pr) => `#${pr.number}` },
    {
      id: 'title',
      header: 'Pull request',
      width: 'minmax(240px,1fr)',
      cell: (pr) => (
        <span className="flex min-w-0 flex-col">
          <Link render={<RouterLink to={href(pr)} />} className="truncate">
            {pr.title}
          </Link>
          <span className="truncate text-micro text-fg-3">
            {pr.codebaseAlias} · <span className="font-mono">{pr.head} → {pr.base}</span>
            {pr.author ? ` · ${pr.author}` : ''}
          </span>
        </span>
      ),
    },
    {
      id: 'state',
      header: 'State',
      width: 128,
      cell: (pr) => (
        <span className="flex items-center gap-1.5">
          <Badge tone={PR_STATE_TONE[pr.state]} className="capitalize">
            {pr.state}
          </Badge>
          {pr.draft ? <Badge tone="neutral">Draft</Badge> : null}
        </span>
      ),
    },
    {
      id: 'updated',
      header: 'Updated',
      width: 80,
      align: 'end',
      mono: true,
      cell: (pr) => (pr.updatedAt ? formatRelativeTime(new Date(pr.updatedAt)) : '—'),
    },
  ];

  const unavailable = data?.unavailable ?? [];

  return (
    <div className="flex flex-col gap-3" data-testid="project-pull-requests">
      <SegmentedControl<StateFilter>
        value={state}
        onValueChange={setState}
        semantics="tabs"
        label="Pull request state"
        className="self-start"
        items={[
          { value: 'open', label: 'Open' },
          { value: 'closed', label: 'Closed' },
          { value: 'all', label: 'All' },
        ]}
      />
      <DataTable<ProjectPullRequest>
        label="Pull requests"
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(pr) => `${pr.codebaseId}#${pr.number}`}
        onRowClick={(pr) => navigate(href(pr))}
        loading={isLoading}
        error={
          isError ? (
            <EmptyState framed tone="error" icon="warning" title="Couldn't load pull requests" description={String(error)} />
          ) : undefined
        }
        empty={
          <EmptyState
            framed
            icon="pr"
            title={`No ${state === 'all' ? '' : `${state} `}pull requests`}
            description="Across this project’s codebases."
            data-testid="pr-empty"
          />
        }
      />
      {unavailable.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="pr-unavailable">
          {unavailable.map((entry) => (
            <Callout
              key={entry.codebaseId}
              tone="warn"
              title={`${entry.alias}: pull requests unavailable`}
              action={
                isConnectReason(entry.reason) ? (
                  <Button size="sm" render={<RouterLink to="/settings/source-control" />} data-testid="pr-connect-github">
                    Connect GitHub
                  </Button>
                ) : undefined
              }
            >
              {entry.reason}
            </Callout>
          ))}
        </div>
      ) : null}
    </div>
  );
}
