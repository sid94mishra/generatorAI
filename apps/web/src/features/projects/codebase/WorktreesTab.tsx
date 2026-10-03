// ────────────────────────────────────────────────────────────────
// CodebaseDetail · Worktrees (P5-05; board CodebaseDetail; F-projects-09;
// G-17). Seg All / Active / Orphaned / Completed (counts), "1.27 GB on disk ·
// frees 385 MB" (only once the server has measured something — never a fake
// 0), Clean up orphans; the B-26 WorktreesTable: Branch (+ path) · Linked to ·
// Status (+ "removes in 26h") · Created · Size · Remove (not while active).
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import type { WorktreeListItem, WorktreeStatus } from '@generatorai/shared';
import { useCleanupWorktrees, useCodebaseWorktreesUsage, useRemoveWorktree } from '@/hooks/projectQueries.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import { DataTable, type DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Badge, type BadgeTone } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { formatBytes, formatUntil } from '../projectFormat.js';

type Scope = 'all' | 'active' | 'orphaned' | 'completed';

const STATUS: Record<WorktreeStatus, { tone: BadgeTone; label: string }> = {
  active: { tone: 'ok', label: 'Active' },
  orphaned: { tone: 'warn', label: 'Orphaned' },
  completed: { tone: 'neutral', label: 'Completed' },
  'cleanup-pending': { tone: 'neutral', label: 'Cleaning up' },
};

/** A worktree a live chat or run is working in is not offered for removal (the server refuses it too). */
function removable(status: WorktreeStatus): boolean {
  return status !== 'active' && status !== 'cleanup-pending';
}

function LinkedCell({ wt }: { wt: WorktreeListItem }) {
  if (!wt.link) return <span className="text-small text-fg-3">{wt.runType ? `${wt.runType} run` : '—'}</span>;
  const title =
    wt.link.entity === 'chat' ? (
      <Link render={<RouterLink to={`/chats/${wt.link.id}`} />} className="truncate">
        {wt.link.title}
      </Link>
    ) : (
      <span className="truncate text-fg">{wt.link.title}</span>
    );
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-small">
      {title}
      <span className="shrink-0 text-fg-3">· {wt.link.status}</span>
    </span>
  );
}

export function WorktreesTab({ projectId, codebaseId }: { projectId: string; codebaseId: string }) {
  const { data, isLoading, isError, error } = useCodebaseWorktreesUsage(projectId, codebaseId);
  const removeWorktree = useRemoveWorktree();
  const cleanup = useCleanupWorktrees();
  const confirmer = useConfirm();
  const [scope, setScope] = useState<Scope>('all');

  const items = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(
    () => ({
      all: items.length,
      active: items.filter((w) => w.status === 'active').length,
      orphaned: items.filter((w) => w.status === 'orphaned').length,
      completed: items.filter((w) => w.status === 'completed').length,
    }),
    [items],
  );
  const rows = scope === 'all' ? items : items.filter((w) => w.status === scope);

  const onRemove = async (wt: WorktreeListItem) => {
    const ok = await confirmer.confirm({
      title: `Remove ${wt.branchName}?`,
      description: 'This deletes the worktree directory. Its branch stays in the repository.',
      confirmLabel: 'Remove worktree',
    });
    if (!ok) return;
    removeWorktree.mutate(
      { projectId, worktreeId: wt.id },
      { onError: (err) => toast.error("Couldn't remove the worktree", { description: err instanceof Error ? err.message : String(err) }) },
    );
  };

  const onCleanup = async () => {
    const ok = await confirmer.confirm({
      title: 'Clean up orphaned worktrees?',
      description: 'Removes every worktree in this project whose chat or run no longer exists or has finished.',
      confirmLabel: 'Clean up',
    });
    if (!ok) return;
    cleanup.mutate(projectId, {
      onError: (err) => toast.error("Couldn't clean up worktrees", { description: err instanceof Error ? err.message : String(err) }),
    });
  };

  const columns: DataTableColumn<WorktreeListItem>[] = [
    {
      id: 'branch',
      header: 'Branch',
      width: 'minmax(220px,1fr)',
      cell: (wt) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-small text-fg">{wt.branchName}</span>
          <span className="truncate font-mono text-micro text-fg-3" title={wt.worktreePath}>
            {wt.worktreePath}
          </span>
        </span>
      ),
    },
    { id: 'linked', header: 'Linked to', width: 240, hideBelow: 900, cell: (wt) => <LinkedCell wt={wt} /> },
    {
      id: 'status',
      header: 'Status',
      width: 176,
      cell: (wt) => (
        <span className="flex items-center gap-1.5">
          <Badge tone={STATUS[wt.status].tone}>{STATUS[wt.status].label}</Badge>
          {wt.expiresAt && wt.status !== 'active' ? (
            <span className="truncate text-micro text-fg-3">removes {formatUntil(wt.expiresAt)}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'created',
      header: 'Created',
      width: 88,
      align: 'end',
      mono: true,
      cell: (wt) => formatRelativeTime(new Date(wt.createdAt)),
    },
    {
      id: 'size',
      header: 'Size',
      width: 72,
      align: 'end',
      mono: true,
      hideBelow: 760,
      cell: (wt) => (wt.sizeBytes !== undefined ? formatBytes(wt.sizeBytes) : '—'),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<Scope>
          value={scope}
          onValueChange={setScope}
          semantics="tabs"
          label="Worktree status"
          items={[
            { value: 'all', label: 'All', count: data ? counts.all : undefined },
            { value: 'active', label: 'Active', count: data ? counts.active : undefined },
            { value: 'orphaned', label: 'Orphaned', count: data ? counts.orphaned : undefined },
            { value: 'completed', label: 'Completed', count: data ? counts.completed : undefined },
          ]}
        />
        {data?.totalBytes !== undefined ? (
          <span className="text-small text-fg-3">
            <span className="font-mono text-fg-2">{formatBytes(data.totalBytes)}</span> on disk
            {data.reclaimableBytes ? (
              <>
                {' · frees '}
                <span className="font-mono text-fg-2">{formatBytes(data.reclaimableBytes)}</span>
              </>
            ) : null}
          </span>
        ) : null}
        <Button className="ml-auto" icon="trash" loading={cleanup.isPending} disabled={counts.orphaned === 0} onClick={() => void onCleanup()}>
          Clean up orphans{counts.orphaned > 0 ? ` (${counts.orphaned})` : ''}
        </Button>
      </div>
      <DataTable<WorktreeListItem>
        label="Worktrees"
        columns={columns}
        rows={rows}
        getRowId={(wt) => wt.id}
        actionsWidth={40}
        rowActions={(wt) =>
          removable(wt.status) ? (
            <IconButton size="sm" icon="trash" label={`Remove worktree ${wt.branchName}`} onClick={() => void onRemove(wt)} />
          ) : null
        }
        loading={isLoading}
        error={isError ? <EmptyState framed tone="error" icon="warning" title="Couldn't load worktrees" description={String(error)} /> : undefined}
        empty={
          <EmptyState
            framed
            icon="branch"
            title={scope === 'all' ? 'No worktrees yet' : `No ${scope} worktrees`}
            description="Chats and workflow runs create a worktree of this codebase to work in."
          />
        }
        footer="Orphaned worktrees have no live chat or run. Completed ones follow the project retention policy."
      />
      {confirmer.dialog}
    </div>
  );
}
