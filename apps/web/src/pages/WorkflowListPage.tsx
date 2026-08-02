// ────────────────────────────────────────────────────────────────
// WorkflowListPage — Grid/list of all workflow definitions.
// Supports search, tag filtering, grid/list toggle, single delete,
// and bulk select-all / deselect / bulk-delete operations.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  useImportFromJSON,
  useWorkflowTemplates,
} from '@/hooks/workflowQueries.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { CardGridSkeleton } from '@/components/Skeleton.js';
import { WorkflowCard, WorkflowListRow } from '@/components/workflow/WorkflowCard.js';
import { SearchInput, EmptyState, Button, PageHeader } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { Toolbar } from '@/components/layout/Toolbar.js';
import { cn } from '@/lib/utils.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import type { ImportWorkflowJson } from '@generatorai/shared';

type ViewMode = 'grid' | 'list';

export function WorkflowListPage() {
  const navigate = useNavigate();
  const openSettings = useSettingsUiStore((s) => s.openSettings);
  const { data: definitions, isLoading, error } = useWorkflowDefinitions();
  const { data: systemWorkflows } = useWorkflowTemplates();
  const deleteDefinition = useDeleteWorkflowDefinition();
  const bulkDelete = useBulkDeleteWorkflowDefinitions();
  const importFromJSON = useImportFromJSON();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
      const raw = JSON.parse(text);

      // Basic client-side validation — full Zod validation happens on server
      if (!raw.name || typeof raw.name !== 'string') {
        setUploadError('Invalid workflow JSON: "name" field is required and must be a string');
        return;
      }
      if (!Array.isArray(raw.stages) || raw.stages.length === 0) {
        setUploadError('Invalid workflow JSON: "stages" array is required with at least one stage');
        return;
      }

      const result = await importFromJSON.mutateAsync(raw as ImportWorkflowJson);
      navigate(`/workflows/${result.id}/edit`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setUploadError('File contains invalid JSON');
      } else {
        setUploadError(err instanceof Error ? err.message : 'Failed to import workflow');
      }
    }
  };

  const handleDownloadTemplate = () => {
    const template = {
      name: 'My Workflow',
      description: 'Describe what this workflow does',
      sessionMode: 'auto',
      tags: ['custom'],
      variables: [
        {
          name: 'example_variable',
          type: 'string',
          label: 'Example Variable',
          description: 'An example variable referenced in prompts as {{example_variable}}',
          required: false,
          defaultValue: '',
        },
      ],
      harnessConfig: undefined,
      stages: [
        {
          name: 'Stage 1 - Analyze',
          description: 'First stage of the workflow',
          order: 0,
          prompts: [
            {
              label: 'Analyze Requirements',
              text: 'Analyze the following requirements: {{example_variable}}',
              waitForCompletion: true,
              attachments: [],
            },
          ],
          variables: {},
          hooks: [],
        },
        {
          name: 'Stage 2 - Generate',
          description: 'Second stage that depends on Stage 1',
          order: 1,
          prompts: [
            {
              label: 'Generate Output',
              text: 'Based on the analysis, generate the output.',
              waitForCompletion: true,
              attachments: [],
            },
          ],
          variables: {},
          hooks: [],
        },
      ],
      edges: [
        { fromStageIndex: 0, toStageIndex: 1, edgeType: 'on_success' },
      ],
    };
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow-template.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Confirm and execute single workflow deletion */
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteDefinition.mutateAsync(deleteTarget);
    setDeleteTarget(null);
  };

  /** Confirm and execute bulk workflow deletion */
  const confirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    await bulkDelete.mutateAsync(Array.from(selectedIds));
    setBulkDeleteOpen(false);
    exitSelectionMode();
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
    <PageContainer>
      {/* Single-delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Workflow"
        description="Delete this workflow? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />

      {/* Bulk-delete confirmation dialog */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => { if (!open) setBulkDeleteOpen(false); }}
        title={`Delete ${selectedIds.size} Workflow${selectedIds.size === 1 ? '' : 's'}`}
        description={`Are you sure you want to delete ${selectedIds.size} selected workflow${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`}
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
            <input
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
              disabled={importFromJSON.isPending}
              loading={importFromJSON.isPending}
              title="Upload a workflow JSON file"
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
          <button
            onClick={() => setUploadError(null)}
            className="text-danger/70 hover:text-danger"
          >
            &times;
          </button>
        </div>
      )}

      {/* ── Selection Toolbar — shown when in bulk selection mode ── */}
      {selectionMode && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-accent/50 px-4 py-2">
          <button
            onClick={selectedIds.size === filtered.length ? deselectAll : selectAll}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:opacity-80"
          >
            {selectedIds.size === filtered.length ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            {selectedIds.size === filtered.length ? 'Deselect All' : 'Select All'}
          </button>
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
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'rounded-l-lg p-1.5 transition-colors',
                viewMode === 'grid'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'rounded-r-lg p-1.5 transition-colors',
                viewMode === 'list'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        }
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search workflows..."
          className="flex-1"
        />
      </Toolbar>

      {/* ── Content ── */}
      <div>
        {/* Start-from-template entry point — templates live in Settings → Templates */}
        {systemWorkflows && systemWorkflows.length > 0 && (
          <button
            onClick={() => openSettings('templates')}
            className="group mb-6 flex w-full items-center justify-between gap-3 rounded-lg border border-dashed border-[color-mix(in_srgb,var(--color-primary)_30%,var(--color-border))] bg-info-muted px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)]"
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
          </button>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((def) => (
              <WorkflowCard
                key={def.id}
                definition={def}
                selectionMode={selectionMode}
                selected={selectedIds.has(def.id)}
                onToggleSelect={() => toggleSelect(def.id)}
                onEdit={() => navigate(`/workflows/${def.id}/edit`)}
                onRun={() => navigate(`/workflows/${def.id}`)}
                onDelete={(e) => handleDelete(e, def.id)}
                onClick={() => {
                  if (selectionMode) toggleSelect(def.id);
                  else navigate(`/workflows/${def.id}`);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((def) => (
              <WorkflowListRow
                key={def.id}
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
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}

export default WorkflowListPage;
