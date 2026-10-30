// ────────────────────────────────────────────────────────────────
// ProjectDetail · Issues (D-146). Every GitHub issue across the project's
// codebases, built like the Pull requests tab: an Open / Closed / All scope,
// a DataTable — # · Issue (codebase, author, labels) · Comments · Updated —
// whose row opens the issue page, and "New issue". Codebases that could NOT
// be listed stay visible with the server's reason, with Connect GitHub when
// that is the fix (a silently short list would read as "no issues").
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import type { ProjectIssue } from '@generatorai/shared';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import { useProjectIssues } from '@/hooks/queries.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import { Icon } from '@/ui/icons/Icon.js';
import { DataTable, type DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { NewIssueDialog } from './NewIssueDialog.js';
import { isConnectReason } from './PullRequestsTab.js';

type StateFilter = 'open' | 'closed' | 'all';

export function IssuesTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<StateFilter>('open');
  const [creating, setCreating] = useState(false);
  const { data, isLoading, isError, error } = useProjectIssues(projectId, state);
  const { data: codebases } = useProjectCodebases(projectId);
  const href = (issue: ProjectIssue) => `/projects/${projectId}/codebases/${issue.codebaseId}/issues/${issue.number}`;

  const unavailable = data?.unavailable ?? [];
  // A codebase the list could reach is one an issue can be filed against.
  const reachable = data ? (codebases ?? []).filter((cb) => !unavailable.some((u) => u.codebaseId === cb.id)) : [];

  const columns: DataTableColumn<ProjectIssue>[] = [
    { id: 'number', header: '#', width: 64, mono: true, cell: (issue) => `#${issue.number}` },
    {
      id: 'title',
      header: 'Issue',
      width: 'minmax(240px,1fr)',
      cell: (issue) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <Link render={<RouterLink to={href(issue)} />} className="truncate">
              {issue.title}
            </Link>
            {issue.labels.slice(0, 3).map((label) => (
              <Badge key={label} size="sm" className="shrink-0">
                {label}
              </Badge>
            ))}
          </span>
          <span className="truncate text-micro text-fg-3">
            {issue.codebaseAlias}
            {issue.author ? ` · ${issue.author}` : ''}
            {issue.state === 'closed' ? ` · closed${issue.stateReason === 'not_planned' ? ' as not planned' : ''}` : ''}
          </span>
        </span>
      ),
    },
    {
      id: 'comments',
      header: 'Comments',
      width: 96,
      align: 'end',
      mono: true,
      cell: (issue) =>
        issue.comments > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Icon concept="message" size={12} />
            {issue.comments}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'updated',
      header: 'Updated',
      width: 80,
      align: 'end',
      mono: true,
      cell: (issue) => (issue.updatedAt ? formatRelativeTime(new Date(issue.updatedAt)) : '—'),
    },
  ];

  return (
    <div className="flex flex-col gap-3" data-testid="project-issues">
      <div className="flex items-center justify-between gap-3">
        <SegmentedControl<StateFilter>
          value={state}
          onValueChange={setState}
          semantics="tabs"
          label="Issue state"
          items={[
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
        {reachable.length > 0 ? (
          <Button icon="plus" onClick={() => setCreating(true)} data-testid="issue-new">
            New issue
          </Button>
        ) : null}
      </div>
      <DataTable<ProjectIssue>
        label="Issues"
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(issue) => `${issue.codebaseId}#${issue.number}`}
        onRowClick={(issue) => navigate(href(issue))}
        loading={isLoading}
        error={
          isError ? (
            <EmptyState framed tone="error" icon="warning" title="Couldn't load issues" description={String(error)} />
          ) : undefined
        }
        empty={
          <EmptyState
            framed
            icon="issue"
            title={`No ${state === 'all' ? '' : `${state} `}issues`}
            description="Across this project’s GitHub repositories."
            data-testid="issue-empty"
          />
        }
      />
      {unavailable.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="issue-unavailable">
          {unavailable.map((entry) => (
            <Callout
              key={entry.codebaseId}
              tone="warn"
              title={`${entry.alias}: issues unavailable`}
              action={
                isConnectReason(entry.reason) ? (
                  <Button size="sm" render={<RouterLink to="/settings/source-control" />} data-testid="issue-connect-github">
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
      <NewIssueDialog
        projectId={projectId}
        codebases={reachable}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(codebaseId, number) => navigate(`/projects/${projectId}/codebases/${codebaseId}/issues/${number}`)}
      />
    </div>
  );
}
