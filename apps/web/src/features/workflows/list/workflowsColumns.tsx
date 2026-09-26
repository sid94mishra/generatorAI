// ────────────────────────────────────────────────────────────────
// Workflows table columns + row menu (board Workflows; B-26 EntityTable
// binding). Name (tags, agent draft, needs attention) · Project · Status
// (WF-01) · Stages · Last run · Success (G-10 `byDefinition`, last 30 days)
// · Updated. A value the server does not have is a dash, never invented
// (D-36): the list carries no published version number, so Status says
// "Published" without one.
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink } from 'react-router';
import { toStatus, type StatsByDefinitionRow } from '@generatorai/shared';
import type { WorkflowDefinitionSummary } from '@generatorai/workflow-spec';
import { VersionChip } from '@/blocks/workflow/index.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import type { DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { MenuButton, type MenuButtonItem } from '@/ui/patterns/MenuButton/MenuButton.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { formatPercent } from '../workflowFormat.js';

export interface WorkflowRow extends WorkflowDefinitionSummary {
  projectName?: string;
  stats?: StatsByDefinitionRow;
}

const DASH = <span className="font-mono text-micro text-fg-3">—</span>;

export function WorkflowNameCell({ row }: { row: WorkflowRow }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Link render={<RouterLink to={`/workflows/${row.id}`} />} className="truncate font-medium">
        {row.name}
      </Link>
      {row.agentAuthored ? <Badge icon="agents">Agent draft</Badge> : null}
      {row.needsAttention ? (
        <Badge tone="warn" icon="warning">
          Needs attention
        </Badge>
      ) : null}
      {row.tags.length > 0 ? (
        <span className="flex shrink-0 items-center gap-1" title={row.tags.join(', ')}>
          <Chip size="sm">{row.tags[0]}</Chip>
          {row.tags.length > 1 ? <Chip size="sm">+{row.tags.length - 1}</Chip> : null}
        </span>
      ) : null}
    </span>
  );
}

export function WorkflowStatusCell({ row }: { row: WorkflowRow }) {
  if (row.archivedAt) return <Badge>Archived</Badge>;
  return <VersionChip status={row.status} revision={row.status === 'draft' ? row.revision : undefined} />;
}

export function LastRunCell({ row }: { row: WorkflowRow }) {
  const run = row.stats?.lastRun;
  if (!run) return <span className="text-small text-fg-3">Never run</span>;
  const status = toStatus('workflowRun', run.status);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {status ? <StatusBadge state={status.state} label={status.label} /> : null}
      <Link
        render={<RouterLink to={`/workflows/${row.id}/runs/${run.id}`} />}
        className="shrink-0 font-mono text-micro text-fg-3"
        onClick={(event) => event.stopPropagation()}
      >
        {run.startedAt ? formatRelativeTime(new Date(run.startedAt)) : 'not started'}
      </Link>
    </span>
  );
}

export const WORKFLOWS_COLUMNS: readonly DataTableColumn<WorkflowRow>[] = [
  { id: 'name', header: 'Name', width: 'minmax(240px,1fr)', cell: (row) => <WorkflowNameCell row={row} /> },
  {
    id: 'project',
    header: 'Project',
    width: 150,
    hideBelow: 900,
    cell: (row) =>
      row.projectId ? (
        <span className="truncate text-small text-fg-2">{row.projectName ?? '—'}</span>
      ) : (
        <span className="text-small text-fg-3">No project</span>
      ),
  },
  { id: 'status', header: 'Status', width: 140, cell: (row) => <WorkflowStatusCell row={row} /> },
  {
    id: 'stages',
    header: 'Stages',
    width: 64,
    align: 'end',
    cell: (row) => <span className="font-mono text-small text-fg">{row.stageCount}</span>,
  },
  { id: 'lastRun', header: 'Last run', width: 190, hideBelow: 1000, cell: (row) => <LastRunCell row={row} /> },
  {
    id: 'success',
    header: 'Success',
    width: 72,
    align: 'end',
    hideBelow: 1100,
    cell: (row) =>
      row.stats?.successRate !== undefined ? <span className="font-mono text-small text-fg">{formatPercent(row.stats.successRate)}</span> : DASH,
  },
  {
    id: 'updated',
    header: 'Updated',
    width: 84,
    align: 'end',
    mono: true,
    cell: (row) => formatRelativeTime(new Date(row.updatedAt)),
  },
];

export interface WorkflowRowActions {
  onRun: (row: WorkflowRow) => void;
  onOpen: (row: WorkflowRow) => void;
  onEdit: (row: WorkflowRow) => void;
  onExport: (row: WorkflowRow) => void;
  onDelete: (row: WorkflowRow) => void;
}

/** Row menu: Run… (Test run… for a draft) · Open · Open in builder · — · Export JSON · — · Delete…. */
export function workflowRowMenu(row: WorkflowRow, actions: WorkflowRowActions) {
  const items: MenuButtonItem[] = [
    { id: 'run', label: row.status === 'draft' ? 'Test run…' : 'Run…', icon: 'play', onSelect: () => actions.onRun(row) },
    { id: 'open', label: 'Open', icon: 'workflows', onSelect: () => actions.onOpen(row) },
    { id: 'edit', label: 'Open in builder', icon: 'edit', onSelect: () => actions.onEdit(row) },
    { type: 'separator' },
    { id: 'export', label: 'Export JSON', icon: 'download', onSelect: () => actions.onExport(row) },
    { type: 'separator' },
    { id: 'delete', label: 'Delete…', icon: 'trash', danger: true, onSelect: () => actions.onDelete(row) },
  ];
  return <MenuButton label={`More actions for ${row.name}`} iconOnly icon="more" size="sm" items={items} />;
}
