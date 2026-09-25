// ────────────────────────────────────────────────────────────────
// WorkflowListPage — Grid/list of all workflow definitions.
// Supports search, tag filtering, grid/list toggle, single delete,
// and bulk select-all / deselect / bulk-delete operations.
// ────────────────────────────────────────────────────────────────

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Plus,
  GitBranch,
  Trash2,
  AlertCircle,
  LayoutGrid,
  List,
  Upload,
  Download,
  Sparkles,
  ChevronRight,
  CheckSquare,
  Square,
  X,
} from 'lucide-react';

import {
  useWorkflowDefinitions,
  useDeleteWorkflowDefinition,
  useBulkDeleteWorkflowDefinitions,
  useImportDefinition,
} from '@/hooks/workflowQueries.js';
import { useTemplates } from '@/hooks/queries.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { CardGridSkeleton } from '@/components/Skeleton.js';
import { WorkflowCard, WorkflowListRow } from '@/components/workflow/WorkflowCard.js';
import { SearchInput, EmptyState, Button, Input, PageHeader } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { Toolbar } from '@/components/layout/Toolbar.js';
import { cn } from '@/lib/utils.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { useMediaQuery } from '@/hooks/useMediaQuery.js';
import { exportGraph, parseGraph, WORKFLOW_FORMAT_VERSION, type ValidationIssue } from '@generatorai/workflow-spec';
import { ApiError } from '@/platform/apiFetch.js';
import { downloadBlobAsFile } from '@/utils/downloadBlobAsFile.js';

type ViewMode = 'grid' | 'list';

/** Splits a flat list into fixed-size chunks — used to virtualize the grid
 * view by row-of-cards rather than by individual card. */
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** Estimated row heights fed to the virtualizer before it measures the real
 * DOM node; @tanstack/react-virtual's `measureElement` corrects these after
 * the first render of each row, so these only need to be in the right
 * ballpark to avoid an initial scrollbar jump. */
const GRID_ROW_ESTIMATE = 220;
const LIST_ROW_ESTIMATE = 76;

export function WorkflowListPage() {
  const navigate = useNavigate();
  const openSettings = useSettingsUiStore((s) => s.openSettings);
  const { data: definitions, isLoading, error } = useWorkflowDefinitions();
  const { data: systemWorkflows } = useTemplates();
  const deleteDefinition = useDeleteWorkflowDefinition();
  const bulkDelete = useBulkDeleteWorkflowDefinitions();
  const importDefinition = useImportDefinition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Informational result of the last action (a delete that archived). */
  const [notice, setNotice] = useState<string | null>(null);

  // ── Bulk selection state ──
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Filter + sort definitions (updatedAt desc, then createdAt desc)
  const filtered = useMemo(() => {
    if (!definitions) return [];
    let result = definitions;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.description?.toLowerCase().includes(q) ||
          d.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return [...result].sort((a, b) => {
      const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (updatedDiff !== 0) return updatedDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [definitions, search]);

  // ── Virtualization ──
  // Measured on /workflows with 343 real definitions: 13,887 DOM nodes in the
  // default grid view, 4 long tasks totalling 889ms (worst 495ms). Mounting
  // only the rows near the viewport is the fix; the rest of this page's DOM
  // cost scales with data the user controls, this is the outlier.
  //
  // Column count follows the same breakpoints as the grid's own Tailwind
  // classes (`sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`) so a virtual row
  // always holds exactly one visual row of cards.
  const isSmUp = useMediaQuery('(min-width: 640px)');
  const isLgUp = useMediaQuery('(min-width: 1024px)');
  const isXlUp = useMediaQuery('(min-width: 1280px)');
  const columns = isXlUp ? 4 : isLgUp ? 3 : isSmUp ? 2 : 1;
  const gridRows = useMemo(() => chunk(filtered, columns), [filtered, columns]);

  // PageContainer is the actual scroll parent here (`h-full overflow-y-auto`
  // on the page/main container — see layout/PageContainer.tsx), not the
  // window, so the virtualizer observes that node directly.
  const scrollElRef = useRef<HTMLDivElement>(null);
  // Wraps just the grid/list region. Everything above it (header, toolbar,
  // the selection bar, the upload-error banner, the template banner) scrolls
  // in the same PageContainer, so its height has to be added to every virtual
  // row's offset via `scrollMargin`.
  const listStartRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // Deliberately no dependency array: this has to re-measure after every
  // commit, since any of several conditionally-rendered banners above the
  // list (selection bar, upload-error toast, template CTA) can resize it.
  // The `Math.abs` guard below keeps it from looping — once the measured
  // offset stabilizes, `setScrollMargin` stops being called.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const scrollEl = scrollElRef.current;
    const listStart = listStartRef.current;
    if (!scrollEl || !listStart) return;
    // Content-relative offset of the list within the scroll container; stable
    // across scroll position (scrollTop cancels the rect delta), so this only
    // actually changes when something above the list resizes — e.g. toggling
    // selection mode.
    const next =
      listStart.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  });

  // Two virtualizers, one per view mode: grid and list rows have different
  // heights and counts, and switching modes shouldn't reuse the other mode's
  // measured sizes. The inactive one gets `count: 0` so it does no work.
  const gridVirtualizer = useVirtualizer({
    count: viewMode === 'grid' ? gridRows.length : 0,
    getScrollElement: () => scrollElRef.current,
    estimateSize: () => GRID_ROW_ESTIMATE,
    overscan: 3,
    scrollMargin,
  });
  const listVirtualizer = useVirtualizer({
    count: viewMode === 'list' ? filtered.length : 0,
    getScrollElement: () => scrollElRef.current,
    estimateSize: () => LIST_ROW_ESTIMATE,
    overscan: 8,
    scrollMargin,
  });

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteTarget(id);
  };

  /** Toggle selection of a single workflow */
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Select all currently-visible (filtered) workflows */
  const selectAll = () => {
    setSelectedIds(new Set(filtered.map((d) => d.id)));
  };

  /** Deselect all */
  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  /** Enter selection mode, pre-selecting all visible workflows */
  const enterSelectionMode = () => {
    setSelectionMode(true);
    selectAll();
  };

  /** Exit selection mode and clear selection */
  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleUploadClick = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected
    e.target.value = '';

    if (!file.name.endsWith('.json')) {
      setUploadError('Please select a .json file');
      return;
    }

    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_FILE_SIZE) {
      setUploadError(`File too large. Maximum size is 5MB. Received: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      return;
    }

    try {
      const text = await file.text();
      // The canonical document (what Export writes); the server validates it
      // and answers 422 with located issues when it is not a valid workflow.
      const result = await importDefinition.mutateAsync(JSON.parse(text) as unknown);
      navigate(`/workflows/${result.id}/edit`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setUploadError('File contains invalid JSON');
      } else if (err instanceof ApiError && err.status === 422) {
        const issues = (err.details as { issues?: ValidationIssue[] } | undefined)?.issues ?? [];
        setUploadError(
          [err.message, ...issues.map((i) => `${i.path || '/'}: ${i.message}${i.hint ? ` (${i.hint})` : ''}`)].join('\n'),
        );
      } else {
        setUploadError(err instanceof Error ? err.message : 'Failed to import workflow');
      }
    }
  };

  const handleDownloadTemplate = () => {
    // A sample in the canonical document format: what Export writes and
    // Upload JSON reads.
    const sample = exportGraph(
      parseGraph({
        formatVersion: WORKFLOW_FORMAT_VERSION,
        workflow: {
          name: 'My Workflow',
          description: 'Describe what this workflow does',
          tags: ['custom'],
          variables: [
            {
              name: 'example_variable',
              type: 'string',
              label: 'Example Variable',
              description: 'Referenced in prompts as {{variables.example_variable}}',
            },
          ],
        },
        stages: [
          {
            kind: 'agent',
            key: 'analyze',
            name: 'Analyze',
            description: 'First stage of the workflow',
            prompts: [{ label: 'Analyze Requirements', text: 'Analyze the following requirements: {{variables.example_variable}}' }],
          },
          {
            kind: 'agent',
            key: 'generate',
            name: 'Generate',
            description: 'Runs after Analyze succeeds',
            prompts: [{ label: 'Generate Output', text: 'Based on the analysis, generate the output.' }],
          },
        ],
        edges: [{ from: 'analyze', to: 'generate', on: 'success' }],
      }),
    );
    void downloadBlobAsFile(new Blob([sample], { type: 'application/json' }), 'workflow-template.workflow.json');
  };

  /** Confirm and execute single workflow deletion (archived instead when it has runs, D-6). */
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const outcome = await deleteDefinition.mutateAsync(deleteTarget);
      setNotice(
        'archived' in outcome
          ? `The workflow has ${outcome.runs} ${outcome.runs === 1 ? 'run' : 'runs'}, so it was archived instead of deleted; its run history stays readable.`
          : null,
      );
    } catch (err) {
      setUploadError(err instanceof Error ? `Delete failed: ${err.message}` : 'Delete failed');
    } finally {
      setDeleteTarget(null);
    }
  };

  /** Confirm and execute bulk workflow deletion */
  const confirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      const { archived } = await bulkDelete.mutateAsync(Array.from(selectedIds));
      setNotice(
        archived > 0
          ? `${archived} ${archived === 1 ? 'workflow has' : 'workflows have'} runs and ${archived === 1 ? 'was' : 'were'} archived instead of deleted.`
          : null,
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBulkDeleteOpen(false);
      exitSelectionMode();
    }
  };

  if (isLoading) {
    return (
      <PageContainer>
        <CardGridSkeleton count={8} />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <AlertCircle className="h-10 w-10 text-danger" />
        <p className="text-sm text-muted-foreground">Failed to load workflows</p>
      </div>
    );
  }

  return (
    <PageContainer ref={scrollElRef}>
      {/* Single-delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Workflow"
        description="Delete this workflow? A workflow that has runs is archived instead, so its run history stays readable."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />

      {/* Bulk-delete confirmation dialog */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => { if (!open) setBulkDeleteOpen(false); }}
        title={`Delete ${selectedIds.size} Workflow${selectedIds.size === 1 ? '' : 's'}`}
        description={`Delete ${selectedIds.size} selected workflow${selectedIds.size === 1 ? '' : 's'}? Workflows that have runs are archived instead.`}
        confirmLabel={`Delete ${selectedIds.size}`}
        variant="destructive"
        loading={bulkDelete.isPending}
        onConfirm={confirmBulkDelete}
      />

      {/* ── Header ── */}
      <PageHeader
        className="mb-6"
        title="Workflows"
        subtitle="Build and manage multi-stage AI workflows"
        actions={
          <>
            {/* Hidden file input for JSON upload */}
            <Input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="hidden"
            />
            {/* Bulk select toggle — enters/exits selection mode */}
            {!selectionMode && definitions && definitions.length > 0 && (
              <Button
                variant="secondary"
                onClick={enterSelectionMode}
                title="Select multiple workflows for bulk actions"
                leftIcon={<CheckSquare className="h-4 w-4" />}
              >
                Select
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleDownloadTemplate}
              title="Download a template JSON file to customize"
              leftIcon={<Download className="h-4 w-4" />}
            >
              Template
            </Button>
            <Button
              variant="secondary"
              onClick={handleUploadClick}
              disabled={importDefinition.isPending}
              loading={importDefinition.isPending}
              title="Import a workflow document (the JSON Export writes)"
              leftIcon={<Upload className="h-4 w-4" />}
            >
              Upload JSON
            </Button>
            <Button
              variant="primary"
              onClick={() => navigate('/workflows/new')}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              New Workflow
            </Button>
          </>
        }
      />

      {/* Upload error toast */}
      {uploadError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="flex-1">
            <p className="text-sm font-medium text-danger">Upload Error</p>
            <pre className="mt-1 whitespace-pre-wrap text-xs text-danger">{uploadError}</pre>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setUploadError(null)}
            className="text-danger/70 hover:text-danger"
            aria-label="Dismiss upload error"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {notice && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info-muted p-3">
          <p className="flex-1 text-sm text-info">{notice}</p>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setNotice(null)}
            className="text-info/70 hover:text-info"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── Selection Toolbar — shown when in bulk selection mode ── */}
      {selectionMode && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-accent/50 px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={selectedIds.size === filtered.length ? deselectAll : selectAll}
            className="text-foreground"
            leftIcon={
              selectedIds.size === filtered.length ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4" />
              )
            }
          >
            {selectedIds.size === filtered.length ? 'Deselect All' : 'Select All'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {selectedIds.size} of {filtered.length} selected
          </span>
          <div className="flex-1" />
          <Button
            variant="danger"
            size="sm"
            onClick={() => setBulkDeleteOpen(true)}
            disabled={selectedIds.size === 0 || bulkDelete.isPending}
            loading={bulkDelete.isPending}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          >
            Delete Selected
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={exitSelectionMode}
            title="Cancel selection"
            aria-label="Cancel selection"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Search & view toggle bar */}
      <Toolbar
        className="mb-6"
        end={
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
              className={cn(
                'h-auto w-auto rounded-l-lg rounded-r-none p-1.5 transition-colors',
                viewMode === 'grid'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setViewMode('list')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              className={cn(
                'h-auto w-auto rounded-r-lg rounded-l-none p-1.5 transition-colors',
                viewMode === 'list'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        }
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search workflows..."
          aria-label="Search workflows"
          className="min-w-0 flex-1"
        />
      </Toolbar>

      {/* ── Content ── */}
      <div>
        {/* Start-from-template entry point — templates live in Settings → Templates */}
        {systemWorkflows && systemWorkflows.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => openSettings('templates')}
            className="group mb-6 h-auto w-full items-center justify-between gap-3 whitespace-normal rounded-lg border border-dashed border-[color-mix(in_srgb,var(--color-primary)_30%,var(--color-border))] bg-info-muted px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)]"
          >
            <span className="flex items-center gap-2.5 text-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-medium text-foreground">Start from a template</span>
              <span className="text-muted-foreground">
                {systemWorkflows.length} ready-to-use workflow{systemWorkflows.length !== 1 ? 's' : ''}
              </span>
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-primary">
              Browse templates
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Button>
        )}

        {/* Custom Workflows */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={<GitBranch className="h-12 w-12" />}
            title={definitions?.length === 0 ? 'No workflows yet' : 'No matching workflows'}
            hint={
              definitions?.length === 0
                ? 'Create your first workflow to get started'
                : 'Try adjusting your search or filter'
            }
            action={
              definitions?.length === 0 ? (
                <Button
                  variant="primary"
                  onClick={() => navigate('/workflows/new')}
                  leftIcon={<Plus className="h-4 w-4" />}
                >
                  Create Workflow
                </Button>
              ) : undefined
            }
          />
        ) : viewMode === 'grid' ? (
          <div ref={listStartRef} style={{ position: 'relative', height: gridVirtualizer.getTotalSize() }}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${
                  (gridVirtualizer.getVirtualItems()[0]?.start ?? 0) - gridVirtualizer.options.scrollMargin
                }px)`,
              }}
            >
              {gridVirtualizer.getVirtualItems().map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={gridVirtualizer.measureElement}
                  className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                >
                  {gridRows[virtualRow.index]?.map((def) => (
                    <WorkflowCard
                      key={def.id}
                      definition={def}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(def.id)}
                      onToggleSelect={() => toggleSelect(def.id)}
                      onEdit={() => navigate(`/workflows/${def.id}/edit`)}
                      onRun={() => navigate(`/workflows/${def.id}`)}
                      onDelete={(e) => handleDelete(e, def.id)}
                      onClick={() => toggleSelect(def.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div ref={listStartRef} style={{ position: 'relative', height: listVirtualizer.getTotalSize() }}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${
                  (listVirtualizer.getVirtualItems()[0]?.start ?? 0) - listVirtualizer.options.scrollMargin
                }px)`,
              }}
            >
              {listVirtualizer.getVirtualItems().map((virtualRow) => {
                const def = filtered[virtualRow.index];
                if (!def) return null;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={listVirtualizer.measureElement}
                    className="pb-2"
                  >
                    <WorkflowListRow
                      definition={def}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(def.id)}
                      onToggleSelect={() => toggleSelect(def.id)}
                      onEdit={() => navigate(`/workflows/${def.id}/edit`)}
                      onDelete={(e) => handleDelete(e, def.id)}
                      onClick={() => {
                        if (selectionMode) toggleSelect(def.id);
                        else navigate(`/workflows/${def.id}`);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}

export default WorkflowListPage;
