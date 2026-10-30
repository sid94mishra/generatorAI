// ────────────────────────────────────────────────────────────────
// ProjectDetail · Runs (P5-04; F-projects-05; G-15 `GET /projects/:id/runs`).
// The read-only B-26 RunsTable: Run · Workflow · Status · Started · Duration;
// a row opens the run page. Newest first, 50 per page, "Load more" walks the
// server cursor. The Trigger column (WF-20) is not rendered: a run carries no
// trigger field yet (D-36).
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { toStatus, type ProjectRunListItem } from '@generatorai/shared';
import { useProjectRuns } from '@/hooks/projectQueries.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import { DataTable, type DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { formatDuration } from '../projectFormat.js';

const PAGE = 50;
const runHref = (run: ProjectRunListItem) => `/workflows/${run.workflowDefinitionId}/runs/${run.id}`;

const COLUMNS: DataTableColumn<ProjectRunListItem>[] = [
  {
    id: 'run',
    header: 'Run',
    width: 'minmax(200px,1fr)',
    cell: (run) => (
      <Link render={<RouterLink to={runHref(run)} />} className="truncate">
        {run.name}
      </Link>
    ),
  },
  {
    id: 'workflow',
    header: 'Workflow',
    width: 200,
    hideBelow: 820,
    cell: (run) => <span className="truncate text-small text-fg-2">{run.definitionName}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    width: 120,
    cell: (run) => {
      const s = toStatus('workflowRun', run.status);
      return s ? <StatusBadge state={s.state} label={s.label} /> : null;
    },
  },
  {
    id: 'started',
    header: 'Started',
    width: 88,
    align: 'end',
    mono: true,
    cell: (run) => formatRelativeTime(new Date(run.startedAt ?? run.createdAt)),
  },
  {
    id: 'duration',
    header: 'Duration',
    width: 80,
    align: 'end',
    mono: true,
    cell: (run) =>
      run.startedAt
        ? formatDuration(new Date(run.completedAt ?? Date.now()).getTime() - new Date(run.startedAt).getTime())
        : '—',
  },
];

export function RunsTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [earlier, setEarlier] = useState<ProjectRunListItem[]>([]);
  const { data, isLoading, isError, error, isFetching } = useProjectRuns(projectId, { limit: PAGE, ...(cursor ? { cursor } : {}) });
  useEffect(() => {
    setCursor(undefined);
    setEarlier([]);
  }, [projectId]);
  const rows = [...earlier, ...(data?.items ?? [])];

  return (
    <DataTable<ProjectRunListItem>
      label="Runs"
      columns={COLUMNS}
      rows={rows}
      getRowId={(run) => run.id}
      onRowClick={(run) => navigate(runHref(run))}
      loading={isLoading && earlier.length === 0}
      error={isError ? <EmptyState framed tone="error" icon="warning" title="Couldn't load runs" description={String(error)} /> : undefined}
      empty={
        <EmptyState framed icon="activity" title="No runs yet" description="Runs of this project's workflows appear here." />
      }
      footer={
        rows.length > 0 && data ? (
          <span className="flex items-center gap-2">
            Showing {rows.length} of {data.total}
            {data.nextCursor ? (
              <Button
                size="sm"
                variant="ghost"
                loading={isFetching}
                onClick={() => {
                  setEarlier(rows);
                  setCursor(data.nextCursor ?? undefined);
                }}
              >
                Load more
              </Button>
            ) : null}
          </span>
        ) : undefined
      }
    />
  );
}
