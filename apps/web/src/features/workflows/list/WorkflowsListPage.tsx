// ────────────────────────────────────────────────────────────────
// WorkflowsListPage (PW-a; T-01 ListPage; board Workflows; 04-screen-map
// §2.6, §4.7 #54). Replaces pages/WorkflowListPage.tsx.
//
// PageTitle "Workflows · N" + Import JSON + New workflow; G-10 StatStrip
// (Needs you / Running from the attention feed, runs · success · median run
// time over the last 30 days); FilterBar: search, Published/Drafts scope,
// project, list/grid; the definitions table (virtualized) or an EntityCard
// grid; multi-select → bulk delete (a definition with runs is archived
// instead, D-6). Row: Run… (the definition page's Run dialog), Open, Open in
// builder, Export JSON, Delete. Header More: Download sample JSON,
// Templates in Settings.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState, type MouseEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { toStatus } from '@generatorai/shared';
import {
  useBulkDeleteWorkflowDefinitions,
  useDeleteWorkflowDefinition,
  useExportWorkflowDefinition,
  useWorkflowDefinitions,
} from '@/hooks/workflowQueries.js';
import { useStatsSummary } from '@/hooks/statsQueries.js';
import { useAttentionCounts } from '@/hooks/attentionQueries.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { downloadBlobAsFile } from '@/utils/downloadBlobAsFile.js';
import { exportFileName } from '@/utils/workflowExport.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import { VersionChip } from '@/blocks/workflow/index.js';
import { BulkActionBar } from '@/ui/patterns/BulkActionBar/BulkActionBar.js';
import { DataTable } from '@/ui/patterns/DataTable/DataTable.js';
import { CardGrid, EntityCard } from '@/ui/patterns/EntityCard/EntityCard.js';
import { FilterBar } from '@/ui/patterns/FilterBar/FilterBar.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { StatStrip, type StatTileItem } from '@/ui/patterns/StatStrip/StatStrip.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { FileInput } from '@/ui/primitives/FileInput/FileInput.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { ToolbarButton } from '@/ui/primitives/Toolbar/Toolbar.js';
import { ListPage } from '@/ui/templates/ListPage/ListPage.js';
import { readWorkflowFile, useWorkflowImport } from '../useWorkflowImport.js';
import { formatDuration, formatPercent, last30Days, plural, sampleWorkflowDocument } from '../workflowFormat.js';
import { WORKFLOWS_COLUMNS, workflowRowMenu, type WorkflowRow, type WorkflowRowActions } from './workflowsColumns.js';

type Scope = 'all' | 'published' | 'draft';
type ViewMode = 'list' | 'grid';
const VIEW_KEY = 'generatorai:workflows:view';
const ALL_PROJECTS = '__all__';
const NO_PROJECT = '__none__';

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

export function WorkflowsListPage() {
  const navigate = useNavigate();
  const openSettings = useSettingsUiStore((s) => s.openSettings);
  const { data: definitions, isLoading, isError, error, refetch } = useWorkflowDefinitions();
  const { data: projects } = useProjects();
  const range = useMemo(() => last30Days(), []);
  const stats = useStatsSummary(useMemo(() => ({ ...range, groupBy: 'definition' as const }), [range]));
  const attention = useAttentionCounts();
  const deleteDefinition = useDeleteWorkflowDefinition();
  const bulkDelete = useBulkDeleteWorkflowDefinitions();
  const exportDefinition = useExportWorkflowDefinition();
  const { importDocument, pending: importing } = useWorkflowImport();
  const confirmer = useConfirm();

  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [project, setProject] = useState<string>(ALL_PROJECTS);
  const [view, setView] = useState<ViewMode>(readView);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);

  const setViewMode = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };

  const allRows = useMemo((): WorkflowRow[] => {
    const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
    const byDefinition = new Map((stats.data?.byDefinition ?? []).map((r) => [r.definitionId, r]));
    return (definitions ?? []).map((d) => ({
      ...d,
      ...(d.projectId ? { projectName: projectName.get(d.projectId) } : {}),
      ...(byDefinition.has(d.id) ? { stats: byDefinition.get(d.id) } : {}),
    }));
  }, [definitions, projects, stats.data]);

  const counts = useMemo(
    () => ({
      all: allRows.length,
      published: allRows.filter((d) => d.status === 'published').length,
      draft: allRows.filter((d) => d.status === 'draft').length,
    }),
    [allRows],
  );
  const projectsInUse = useMemo(() => {
    const ids = new Set(allRows.map((d) => d.projectId).filter((id): id is string => !!id));
    return (projects ?? []).filter((p) => ids.has(p.id));
  }, [allRows, projects]);

  // Newest edit first (then newest created).
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows
      .filter((d) => scope === 'all' || d.status === scope)
      .filter((d) => project === ALL_PROJECTS || (project === NO_PROJECT ? !d.projectId : d.projectId === project))
      .filter(
        (d) =>
          !q ||
          d.name.toLowerCase().includes(q) ||
          (d.description ?? '').toLowerCase().includes(q) ||
          d.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .sort((a, b) => {
        const updated = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        return updated !== 0 ? updated : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [allRows, scope, project, search]);

  // ── Actions ──

  const exportRow = async (id: string, name: string) => {
    const text = await exportDefinition.mutateAsync(id).catch(() => null);
    if (text !== null) await downloadBlobAsFile(new Blob([text], { type: 'application/json' }), exportFileName(name));
  };

  const deleteRow = async (row: WorkflowRow) => {
    const ok = await confirmer.confirm({
      title: `Delete ${row.name}?`,
      description: 'A workflow that has runs is archived instead, so its run history stays readable.',
      confirmLabel: 'Delete workflow',
    });
    if (!ok) return;
    deleteDefinition.mutate(row.id, {
      onSuccess: (outcome) => {
        if ('archived' in outcome) {
          toast.info(`${row.name} was archived`, {
            description: `It has ${plural(outcome.runs, 'run')}, so it was archived instead of deleted; its run history stays readable.`,
          });
        }
      },
      onError: (err) => toast.error(`Couldn't delete "${row.name}"`, { description: String(err) }),
    });
  };

  const deleteSelected = async () => {
    const ids = [...selection];
    const ok = await confirmer.confirm({
      title: `Delete ${plural(ids.length, 'workflow')}?`,
      description: 'Workflows that have runs are archived instead, so their run history stays readable.',
      confirmLabel: `Delete ${ids.length}`,
    });
    if (!ok) return;
    bulkDelete.mutate(ids, {
      onSuccess: ({ archived }) => {
        setSelection(new Set());
        if (archived > 0) toast.info(`${plural(archived, 'workflow')} had runs and ${archived === 1 ? 'was' : 'were'} archived instead of deleted.`);
      },
      onError: (err) => toast.error('Delete failed', { description: err instanceof Error ? err.message : String(err) }),
    });
  };

  const onImportFiles = async (files: FileList) => {
    const file = files[0];
    if (!file) return;
    setImportError(null);
    const read = await readWorkflowFile(file);
    if (!read.ok) {
      setImportError(read.error);
      return;
    }
    const outcome = await importDocument(read.document);
    if (outcome.ok) navigate(`/workflows/${outcome.record.id}/edit`);
    else setImportError(outcome.error);
  };

  const actions: WorkflowRowActions = {
    onRun: (row) => navigate(`/workflows/${row.id}?run=1`),
    onOpen: (row) => navigate(`/workflows/${row.id}`),
    onEdit: (row) => navigate(`/workflows/${row.id}/edit`),
    onExport: (row) => void exportRow(row.id, row.name),
    onDelete: (row) => void deleteRow(row),
  };
  const rowActions = (row: WorkflowRow) => (
    <span className="flex items-center gap-0.5">
      <IconButton
        icon="play"
        size="sm"
        label={row.status === 'draft' ? `Test run ${row.name}` : `Run ${row.name}`}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          actions.onRun(row);
        }}
      />
      {workflowRowMenu(row, actions)}
    </span>
  );

  // ── Stat strip (G-10): only tiles with data (D-36) ──

  const tiles: StatTileItem[] = [];
  const wfAttention = attention?.byEntity.workflow_run;
  if (wfAttention) {
    tiles.push({ value: wfAttention.needsYou, label: 'Needs you', tone: wfAttention.needsYou > 0 ? 'warn' : undefined });
    tiles.push({ value: wfAttention.running, label: 'Running', tone: wfAttention.running > 0 ? 'run' : undefined });
  }
  if (stats.data) {
    const { runs } = stats.data;
    tiles.push({ value: runs.total, label: 'Runs · last 30 days' });
    if (runs.successRate !== undefined) tiles.push({ value: formatPercent(runs.successRate), label: 'Succeeded · last 30 days' });
    if (runs.medianDurationMs !== undefined) tiles.push({ value: formatDuration(runs.medianDurationMs), label: 'Median run time' });
  }

  // ── Render ──

  const hasFilter = Boolean(search.trim()) || scope !== 'all' || project !== ALL_PROJECTS;
  const newWorkflow = (
    <Button variant="primary" icon="plus" onClick={() => navigate('/workflows/new')}>
      New workflow
    </Button>
  );
  const importButton = (
    <FileInput accept=".json,application/json" multiple={false} onFilesSelected={(files) => void onImportFiles(files)}>
      {(open) => (
        <Button icon="upload" loading={importing} onClick={open}>
          Import JSON
        </Button>
      )}
    </FileInput>
  );
  const empty = (
    <EmptyState
      framed
      icon={hasFilter ? 'search' : 'workflows'}
      title={hasFilter ? 'No matching workflows' : 'No workflows yet'}
      description={hasFilter ? 'Try another search or filter.' : 'Create your first workflow to get started.'}
      action={
        hasFilter ? (
          <Button
            size="sm"
            onClick={() => {
              setSearch('');
              setScope('all');
              setProject(ALL_PROJECTS);
            }}
          >
            Clear filters
          </Button>
        ) : (
          newWorkflow
        )
      }
    />
  );
  const errorState = isError ? (
    <EmptyState
      framed
      tone="error"
      icon="warning"
      title="Couldn't load workflows"
      description={error instanceof Error ? error.message : String(error)}
      action={
        <Button size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      }
    />
  ) : undefined;

  const grid = isLoading ? (
    <SkeletonRows rows={4} label="Loading workflows" />
  ) : (
    errorState ??
    (rows.length === 0 ? (
      empty
    ) : (
      <CardGrid columns={3}>
        {rows.map((row) => {
          const last = row.stats?.lastRun;
          const lastStatus = last ? toStatus('workflowRun', last.status) : null;
          return (
            <EntityCard
              key={row.id}
              title={
                <Link render={<RouterLink to={`/workflows/${row.id}`} />} className="truncate">
                  {row.name}
                </Link>
              }
              badge={<VersionChip status={row.status} revision={row.status === 'draft' ? row.revision : undefined} />}
              description={row.description}
              meta={[plural(row.stageCount, 'stage'), row.projectName, `updated ${formatRelativeTime(new Date(row.updatedAt))}`]
                .filter(Boolean)
                .join(' · ')}
              footer={lastStatus ? <StatusBadge state={lastStatus.state} label={`Last run ${(lastStatus.label ?? lastStatus.state).toLowerCase()}`} /> : undefined}
              actions={rowActions(row)}
            />
          );
        })}
      </CardGrid>
    ))
  );

  return (
    <>
      <ListPage
        header={
          <PageHeader
            title="Workflows"
            actions={
              <MenuButton
                label="More workflow actions"
                iconOnly
                icon="more"
                items={[
                  {
                    id: 'sample',
                    label: 'Download sample JSON',
                    icon: 'download',
                    onSelect: () =>
                      void downloadBlobAsFile(new Blob([sampleWorkflowDocument()], { type: 'application/json' }), 'workflow-template.workflow.json'),
                  },
                  { id: 'templates', label: 'Templates in Settings', icon: 'layers', onSelect: () => openSettings('templates') },
                ]}
              />
            }
          />
        }
        title={
          <PageTitle
            title="Workflows"
            count={definitions ? definitions.length : undefined}
            actions={
              <>
                {importButton}
                {newWorkflow}
              </>
            }
          />
        }
        stats={tiles.length > 0 ? <StatStrip items={tiles} /> : undefined}
        filters={
          <>
            {importError ? (
              <Callout
                tone="err"
                title="Import failed"
                role="alert"
                action={<IconButton icon="x" size="sm" label="Dismiss import error" onClick={() => setImportError(null)} />}
              >
                <span className="whitespace-pre-wrap">{importError}</span>
              </Callout>
            ) : null}
            <FilterBar
              search={<SearchInput value={search} onValueChange={setSearch} label="Search workflows" placeholder="Search workflows" />}
              scope={
                <SegmentedControl<Scope>
                  value={scope}
                  onValueChange={setScope}
                  semantics="tabs"
                  label="Workflow status"
                  items={[
                    { value: 'all', label: 'All', count: definitions ? counts.all : undefined },
                    { value: 'published', label: 'Published', count: definitions ? counts.published : undefined },
                    { value: 'draft', label: 'Drafts', count: definitions ? counts.draft : undefined },
                  ]}
                />
              }
              filters={
                projectsInUse.length > 0 ? (
                  <Select
                    aria-label="Project"
                    size="sm"
                    value={project}
                    onValueChange={(v) => setProject(v ?? ALL_PROJECTS)}
                    items={[
                      { value: ALL_PROJECTS, label: 'All projects', icon: 'projects' },
                      ...projectsInUse.map((p) => ({ value: p.id, label: p.name })),
                      { value: NO_PROJECT, label: 'No project' },
                    ]}
                  />
                ) : undefined
              }
              view={
                <SegmentedControl<ViewMode>
                  value={view}
                  onValueChange={setViewMode}
                  label="Layout"
                  items={[
                    { value: 'list', icon: 'list', ariaLabel: 'List view' },
                    { value: 'grid', icon: 'widgets', ariaLabel: 'Grid view' },
                  ]}
                />
              }
            />
          </>
        }
        content={
          view === 'grid' ? (
            grid
          ) : (
            <DataTable<WorkflowRow>
              label="Workflows"
              columns={WORKFLOWS_COLUMNS}
              rows={rows}
              getRowId={(row) => row.id}
              getRowLabel={(row) => row.name}
              selection={selection}
              onSelectionChange={setSelection}
              onRowClick={(row) => navigate(`/workflows/${row.id}`)}
              rowActions={rowActions}
              actionsWidth={64}
              virtualized={rows.length > 100}
              loading={isLoading}
              error={errorState}
              empty={empty}
            />
          )
        }
        footer={
          <span>
            File-based workflows such as <span className="font-mono">nightly-audit.workflow.mjs</span> live in{' '}
            <Link render={<RouterLink to="/scripts" />}>Scripts</Link>.
          </span>
        }
        overlay={
          <BulkActionBar
            count={selection.size}
            total={rows.length}
            onSelectAll={() => setSelection(new Set(rows.map((r) => r.id)))}
            onClear={() => setSelection(new Set())}
            actions={
              <ToolbarButton
                render={<Button variant="danger-ghost" size="sm" icon="trash" loading={bulkDelete.isPending} />}
                onClick={() => void deleteSelected()}
              >
                Delete
              </ToolbarButton>
            }
          />
        }
      />
      {confirmer.dialog}
    </>
  );
}
