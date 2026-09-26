// ────────────────────────────────────────────────────────────────
// ProjectDetail · Codebases (P5-04; F-projects-03; board ProjectDetail;
// 04 §4.5 #47). Intro line + Add codebase; the inline AddCodebaseCard
// (`?add=1` opens it — the Projects row menu's "Add codebase…"); the B-26
// CodebasesTable: Codebase · Status · Default branch · Last fetched ·
// Worktrees ("3 · 2 orphaned") · Fetch / Logs / More. Fetch runs as a G-16
// job; its progress and output show in Logs.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import type { ProjectCodebase } from '@generatorai/shared';
import { useLinkCodebase, useProjectWorktrees, useUnlinkCodebase } from '@/hooks/projectQueries.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import { DataTable, type DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import {
  CodebaseDraftFields,
  codebaseDraftProblem,
  codebaseLinkParams,
  emptyCodebaseDraft,
  type CodebaseDraft,
} from '../CodebaseDraftFields.js';
import { CodebaseLogsDialog, CodebaseStatusBadge, useFetchCodebaseAction } from '../codebaseParts.js';
import { CODEBASE_TYPE_LABEL, codebaseLocation, isCodebaseBusy } from '../projectFormat.js';

interface AddCodebaseCardProps {
  projectId: string;
  onClose: () => void;
}

/** The inline "Add codebase" form (board ProjectDetail; mobile MAddCodebase). */
function AddCodebaseCard({ projectId, onClose }: AddCodebaseCardProps) {
  const linkCodebase = useLinkCodebase();
  const [draft, setDraft] = useState<CodebaseDraft>(emptyCodebaseDraft);
  const problem = codebaseDraftProblem(draft);

  const submit = () => {
    if (problem) return;
    linkCodebase.mutate(
      { projectId, ...codebaseLinkParams(draft) },
      {
        onSuccess: onClose,
        onError: (err) =>
          toast.error(`Couldn't add “${draft.alias.trim()}”`, { description: err instanceof Error ? err.message : String(err) }),
      },
    );
  };

  return (
    <Card data-testid="add-codebase-card">
      <Card.Header title="Add codebase" action={<IconButton size="sm" icon="x" label="Cancel adding a codebase" onClick={onClose} />} />
      <Card.Body padding="lg">
        <CodebaseDraftFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
      </Card.Body>
      <div className="flex h-footer items-center gap-2 border-t border-line-soft pr-3 pl-3.5">
        <span className="min-w-0 flex-1 truncate text-small text-fg-3">
          {draft.type === 'git-remote' ? 'Cloning runs in the background; progress shows in Logs.' : (problem ?? ' ')}
        </span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={Boolean(problem)} loading={linkCodebase.isPending}>
          Add codebase
        </Button>
      </div>
    </Card>
  );
}

export interface CodebasesTabProps {
  projectId: string;
  codebases: ProjectCodebase[] | undefined;
  isLoading: boolean;
  error: unknown;
}

export function CodebasesTab({ projectId, codebases, isLoading, error }: CodebasesTabProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const { data: worktrees } = useProjectWorktrees(projectId);
  const unlink = useUnlinkCodebase();
  const fetchAction = useFetchCodebaseAction(projectId);
  const confirmer = useConfirm();

  // "Add codebase…" from the Projects row menu lands here with ?add=1.
  useEffect(() => {
    if (searchParams.get('add') !== '1') return;
    setAdding(true);
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const worktreeCounts = useMemo(() => {
    const counts = new Map<string, { active: number; orphaned: number }>();
    for (const wt of worktrees ?? []) {
      const c = counts.get(wt.codebaseId) ?? { active: 0, orphaned: 0 };
      if (wt.status === 'active') c.active += 1;
      else if (wt.status === 'orphaned') c.orphaned += 1;
      counts.set(wt.codebaseId, c);
    }
    return counts;
  }, [worktrees]);

  const onDelete = async (cb: ProjectCodebase) => {
    const ok = await confirmer.confirm({
      title: `Delete ${cb.alias}?`,
      description: 'This deletes the codebase, its cloned data and every worktree made from it. It can’t be undone.',
      confirmLabel: 'Delete codebase',
    });
    if (!ok) return;
    unlink.mutate(
      { projectId, codebaseId: cb.id },
      { onError: (err) => toast.error(`Couldn't delete “${cb.alias}”`, { description: err instanceof Error ? err.message : String(err) }) },
    );
  };

  const columns: DataTableColumn<ProjectCodebase>[] = [
    {
      id: 'codebase',
      header: 'Codebase',
      width: 'minmax(220px,1fr)',
      cell: (cb) => (
        <span className="flex min-w-0 flex-col">
          <Link render={<RouterLink to={`/projects/${projectId}/codebases/${cb.id}`} />} className="truncate font-medium">
            {cb.alias}
          </Link>
          <span className="truncate font-mono text-micro text-fg-3">
            {codebaseLocation(cb)} · {CODEBASE_TYPE_LABEL[cb.type].toLowerCase()}
          </span>
        </span>
      ),
    },
    { id: 'status', header: 'Status', width: 104, cell: (cb) => <CodebaseStatusBadge codebase={cb} /> },
    {
      id: 'branch',
      header: 'Default branch',
      width: 120,
      mono: true,
      hideBelow: 900,
      cell: (cb) => (cb.type === 'local-dir' ? '—' : (cb.defaultBranch ?? 'main')),
    },
    {
      id: 'fetched',
      header: 'Last fetched',
      width: 88,
      mono: true,
      hideBelow: 800,
      cell: (cb) => (cb.lastFetchedAt ? formatRelativeTime(new Date(cb.lastFetchedAt)) : '—'),
    },
    {
      id: 'worktrees',
      header: 'Worktrees',
      width: 120,
      cell: (cb) => {
        const c = worktreeCounts.get(cb.id);
        if (!worktrees) return <span className="font-mono text-micro text-fg-3">—</span>;
        return (
          <span className="font-mono text-small">
            {c?.active ?? 0}
            {c && c.orphaned > 0 ? <span className="text-warn"> · {c.orphaned} orphaned</span> : null}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-ui text-fg-2">
          Repositories are cloned under the project root. Every chat and run works in its own worktree.
        </p>
        {!adding ? (
          <Button icon="plus" onClick={() => setAdding(true)}>
            Add codebase
          </Button>
        ) : null}
      </div>
      {adding ? <AddCodebaseCard projectId={projectId} onClose={() => setAdding(false)} /> : null}
      <DataTable<ProjectCodebase>
        label="Codebases"
        columns={columns}
        rows={codebases ?? []}
        getRowId={(cb) => cb.id}
        onRowClick={(cb) => navigate(`/projects/${projectId}/codebases/${cb.id}`)}
        actionsWidth={172}
        rowActions={(cb) => (
          <span className="flex items-center gap-1">
            {cb.type !== 'local-dir' ? (
              <Button
                size="sm"
                variant="ghost"
                icon="refresh"
                aria-label={`Fetch ${cb.alias}`}
                loading={fetchAction.pendingId === cb.id}
                disabled={isCodebaseBusy(cb.status)}
                onClick={() => fetchAction.run(cb)}
              >
                Fetch
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon="terminal" aria-label={`Logs for ${cb.alias}`} onClick={() => setLogsFor(cb.id)}>
              Logs
            </Button>
            <MenuButton
              label={`More actions for ${cb.alias}`}
              iconOnly
              icon="more"
              size="sm"
              items={[
                { id: 'open', label: 'Open codebase', icon: 'branch', onSelect: () => navigate(`/projects/${projectId}/codebases/${cb.id}`) },
                { type: 'separator' },
                { id: 'delete', label: 'Delete codebase…', icon: 'trash', danger: true, onSelect: () => void onDelete(cb) },
              ]}
            />
          </span>
        )}
        loading={isLoading}
        error={
          error ? (
            <EmptyState framed tone="error" icon="warning" title="Couldn't load codebases" description={String(error)} />
          ) : undefined
        }
        empty={
          adding ? (
            <span />
          ) : (
            <EmptyState
              framed
              icon="branch"
              title="No codebases yet"
              description="Add a codebase to give agents something to work on."
              action={
                <Button icon="plus" onClick={() => setAdding(true)}>
                  Add codebase
                </Button>
              }
            />
          )
        }
      />
      <CodebaseLogsDialog
        projectId={projectId}
        codebase={codebases?.find((cb) => cb.id === logsFor)}
        open={logsFor !== null}
        onOpenChange={(open) => {
          if (!open) setLogsFor(null);
        }}
      />
      {confirmer.dialog}
    </div>
  );
}
