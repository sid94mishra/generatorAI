// ────────────────────────────────────────────────────────────────
// WorkflowDefinitionPage — Read-only view of a saved definition
// Shows DAG visualisation, metadata, run history, action buttons.
// A draft runs only as a test run; a published definition runs its
// current published version.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Edit3,
  Play,
  Trash2,
  Calendar,
  GitBranch,
  Clock,
  Tag,
  AlertCircle,
  Globe,
  MoreHorizontal,
  ChevronDown,
  Download,
  Upload,
} from 'lucide-react';

import { DAGCanvas } from '@/components/workflow/DAGCanvas.js';
import { VariableInputModal } from '@/components/workflow/VariableInputModal.js';
import type { UploadedFileSet, LinkedCodebaseInfo } from '@/components/workflow/VariableInputModal.js';
import { DefinitionStatusBadge } from '@/components/workflow/WorkflowCard.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import {
  useWorkflowDefinition,
  useDeleteWorkflowDefinition,
  useWorkflowRunsByDefinition,
  useCreateWorkflowRun,
  useStartWorkflowRun,
  useStartOrchestratedRun,
  usePublishDefinition,
} from '@/hooks/workflowQueries.js';
import { cn } from '@/lib/utils.js';
import {
  Button,
  Badge,
  Spinner,
  StatusBadge,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/index.js';
import { EntityListRow } from '@/components/data/index.js';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import type { WorkflowRun, CreateWorkflowRunParams } from '@generatorai/shared';
import { encodeStageOverrides, needsOrchestratedStart, type StageOverrideDraft } from '@generatorai/client-core';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { downloadBlobAsFile } from '@/utils/downloadBlobAsFile.js';
import { exportFileName } from '@/utils/workflowExport.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { runTitle } from '@generatorai/client-core';

/** How many runs the sidebar shows before "Show more". */
const RUNS_PAGE_SIZE = 5;

export function WorkflowDefinitionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const platform = usePlatform();
  const { data: definition, isLoading, error } = useWorkflowDefinition(id);
  const workflow = definition?.graph.workflow;

  usePageTitle(workflow?.name);
  const { data: runs } = useWorkflowRunsByDefinition(id);
  const deleteDefinition = useDeleteWorkflowDefinition();
  const createRun = useCreateWorkflowRun();
  const startRun = useStartWorkflowRun();
  const startOrchestratedRun = useStartOrchestratedRun();
  const publishDefinition = usePublishDefinition();

  // Only `loadRecord` is used on this read-only page — a single,
  // referentially-stable action selector rather than subscribing to the
  // whole builder store, which would re-render this page on every field the
  // *editor* touches even though this page never reads any of that state.
  const loadRecord = useWorkflowBuilderStore((s) => s.loadRecord);

  const [variableModalOpen, setVariableModalOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [visibleRunCount, setVisibleRunCount] = useState(RUNS_PAGE_SIZE);
  const [actionError, setActionError] = useState<string | null>(null);

  const projectId = workflow?.projectId ?? undefined;
  const codebaseAliases = workflow?.lifecycle.codebaseAliases;
  const isOrchestrated = !!workflow && needsOrchestratedStart(workflow);
  const isDraft = definition?.status !== 'published';

  // ── Project codebases for auto-filling git variables in run dialog ──
  const { data: projectCodebases } = useProjectCodebases(projectId);

  const linkedCodebases = React.useMemo((): LinkedCodebaseInfo[] | undefined => {
    if (!projectId || !codebaseAliases?.length || !projectCodebases) return undefined;
    return codebaseAliases
      .map((alias) => {
        const cb = projectCodebases.find((c) => c.alias === alias);
        if (!cb) return null;
        return { alias: cb.alias, url: cb.url ?? cb.localPath ?? '', branch: cb.defaultBranch ?? 'main' };
      })
      .filter((x): x is LinkedCodebaseInfo => x !== null);
  }, [projectId, codebaseAliases, projectCodebases]);

  const stages = React.useMemo(
    () => (definition?.graph.stages ?? []).map((s) => ({ key: s.key, name: s.name })),
    [definition?.graph.stages],
  );

  /**
   * Newest run first. The API returns rows ordered by `createdAt` ASC, so
   * slicing it directly used to surface the *oldest* runs in "Recent Runs".
   */
  const sortedRuns = React.useMemo(() => {
    if (!runs) return [] as WorkflowRun[];
    return [...runs].sort((a, b) => {
      const at = new Date(a.startedAt ?? a.createdAt).getTime();
      const bt = new Date(b.startedAt ?? b.createdAt).getTime();
      return bt - at;
    });
  }, [runs]);

  // Load definition into store for the read-only DAG view
  React.useEffect(() => {
    if (definition) {
      loadRecord(definition);
    }
  }, [definition, loadRecord]);

  const executeRun = useCallback(
    async (variables: Record<string, unknown>, uploads?: UploadedFileSet, stageOverrides?: StageOverrideDraft[]) => {
      if (!id) return;
      setIsRunning(true);
      setActionError(null);
      // A draft has no published version: it runs its working graph as a test run.
      const testRun = isDraft;

      try {
        // Uploads need the prepared-launch path even for a plain definition:
        // it creates the final workspace before storing/discovering content.
        if (isOrchestrated || Object.values(uploads ?? {}).some((files) => files.length > 0)) {
          const orchParams: Parameters<typeof startOrchestratedRun.mutateAsync>[0] = {
            workflowDefinitionId: id,
            variables,
            uploads,
            ...(testRun ? { testRun: true } : {}),
          };

          if (projectId) {
            orchParams['projectId'] = projectId;
            orchParams['selectedCodebases'] = codebaseAliases ?? [];
          }

          // Pass stage overrides if any are active (shared encoding: a
          // top-level array on the orchestrated route).
          const encoded = encodeStageOverrides(variables, stageOverrides);
          if (encoded.stageOverrides) orchParams['stageOverrides'] = encoded.stageOverrides;

          const context = await startOrchestratedRun.mutateAsync(orchParams);

          setVariableModalOpen(false);
          navigate(`/workflows/${id}/runs/${context.workflowRunId}`);
        } else {
          const params: CreateWorkflowRunParams = {
            workflowDefinitionId: id,
            ...encodeStageOverrides(variables, stageOverrides),
            ...(testRun ? { testRun: true } : {}),
          };
          const run = await createRun.mutateAsync(params);

          await startRun.mutateAsync(run.id);
          setVariableModalOpen(false);
          navigate(`/workflows/${id}/runs/${run.id}`);
        }
      } catch (err) {
        setActionError(err instanceof Error ? `Run failed: ${err.message}` : 'Run failed');
      } finally {
        setIsRunning(false);
      }
    },
    [id, isDraft, isOrchestrated, projectId, codebaseAliases, createRun, startRun, startOrchestratedRun, navigate],
  );

  const handlePublish = useCallback(async () => {
    if (!id) return;
    setActionError(null);
    try {
      await publishDefinition.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof Error ? `Publish failed: ${err.message}` : 'Publish failed');
    }
  }, [id, publishDefinition]);

  const handleExport = useCallback(async () => {
    if (!id || !workflow) return;
    setActionError(null);
    try {
      const text = await platform.exportDefinition(id);
      await downloadBlobAsFile(new Blob([text], { type: 'application/json' }), exportFileName(workflow.name));
    } catch (err) {
      setActionError(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed');
    }
  }, [id, workflow, platform]);

  const handleRun = useCallback(() => {
    if (!definition) return;
    setVariableModalOpen(true);
  }, [definition]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    setDeleteDialogOpen(true);
  }, [id]);

  // A definition with runs is archived rather than deleted (D-6); either way
  // it leaves the list.
  const confirmDelete = useCallback(async () => {
    if (!id) return;
    try {
      await deleteDefinition.mutateAsync(id);
      setDeleteDialogOpen(false);
      navigate('/workflows');
    } catch (err) {
      setDeleteDialogOpen(false);
      setActionError(err instanceof Error ? `Delete failed: ${err.message}` : 'Delete failed');
    }
  }, [id, deleteDefinition, navigate]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  if (error || !definition || !workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <AlertCircle className="h-10 w-10 text-danger" />
        <p className="text-sm text-muted-foreground">
          {error ? 'Failed to load workflow' : 'Workflow not found'}
        </p>
        <Button variant="unstyled"
          onClick={() => navigate('/workflows')}
          className="text-sm text-primary underline"
        >
          Back to workflows
        </Button>
      </div>
    );
  }

  const visibleRuns = sortedRuns.slice(0, visibleRunCount);
  const hasMoreRuns = sortedRuns.length > visibleRuns.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Workflow Definition"
        description="Delete this workflow definition? A workflow that has runs is archived instead, so its run history stays readable."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-background px-4 py-3 sm:px-6">
        <div className="flex items-start gap-3">
          {/* Identity — owns all the flexible width and truncates instead of
              pushing the action cluster off screen. */}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
                {workflow.name}
              </h1>
              <DefinitionStatusBadge status={definition.status} />
              {definition.hasUnpublishedChanges && definition.status === 'published' && (
                <Badge tone="neutral" size="sm" className="shrink-0" title="Runs use the published version">
                  Unpublished changes
                </Badge>
              )}
              {isOrchestrated && (
                <Badge tone="warning" size="sm" className="shrink-0">
                  <Globe className="h-3 w-3" />
                  Orchestrated
                </Badge>
              )}
            </div>

            {workflow.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {workflow.description}
              </p>
            )}
            {actionError && (
              <p role="alert" className="mt-1 text-xs text-danger">{actionError}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <MetaChip
                icon={<GitBranch className="h-3 w-3" />}
                label={`${definition.graph.stages.length} ${definition.graph.stages.length === 1 ? 'stage' : 'stages'}`}
              />
              <MetaChip
                icon={<Clock className="h-3 w-3" />}
                label={`Revision ${definition.revision}`}
                title={`Updated ${new Date(definition.updatedAt).toLocaleString()}`}
              />
              <MetaChip
                icon={<Calendar className="h-3 w-3" />}
                label={new Date(definition.createdAt).toLocaleDateString()}
                title={`Created ${new Date(definition.createdAt).toLocaleString()}`}
              />
              {workflow.tags.length > 0 && (
                <MetaChip
                  icon={<Tag className="h-3 w-3" />}
                  label={workflow.tags.join(', ')}
                  title={`Tags: ${workflow.tags.join(', ')}`}
                  className="max-w-[14rem]"
                />
              )}
            </div>
          </div>

          {/* Actions — full labels when there is room, primary + overflow menu
              once the header gets tight. */}
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              onClick={handleRun}
              disabled={isRunning}
              loading={isRunning}
              leftIcon={isRunning ? undefined : <Play className="h-3.5 w-3.5" />}
              title={isDraft ? 'A draft runs only as a test run' : 'Run the published version'}
            >
              <span className="hidden sm:inline">{isDraft ? 'Test run' : 'Run'}</span>
            </Button>

            {/* Wide: inline secondary actions */}
            <div className="hidden items-center gap-1.5 lg:flex">
              {(isDraft || definition.hasUnpublishedChanges) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handlePublish()}
                  loading={publishDefinition.isPending}
                  leftIcon={<Upload className="h-3.5 w-3.5" />}
                  title="Publish: runs use the published version"
                >
                  Publish
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/workflows/${id}/edit`)}
                leftIcon={<Edit3 className="h-3.5 w-3.5" />}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void handleExport()}
                title="Export as JSON"
                aria-label="Export workflow"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDelete}
                className="hover:bg-danger-muted hover:text-danger"
                title="Delete workflow"
                aria-label="Delete workflow"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Narrow: overflow menu */}
            <div className="lg:hidden">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="secondary" size="icon-sm" title="More actions" aria-label="More actions">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-44 p-1">
                  <MenuItem
                    icon={<Edit3 className="h-3.5 w-3.5" />}
                    label="Edit workflow"
                    onClick={() => navigate(`/workflows/${id}/edit`)}
                  />
                  {(isDraft || definition.hasUnpublishedChanges) && (
                    <MenuItem
                      icon={<Upload className="h-3.5 w-3.5" />}
                      label="Publish"
                      onClick={() => void handlePublish()}
                    />
                  )}
                  <MenuItem
                    icon={<Download className="h-3.5 w-3.5" />}
                    label="Export JSON"
                    onClick={() => void handleExport()}
                  />
                  <MenuItem
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    label="Delete workflow"
                    onClick={handleDelete}
                    destructive
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* DAG Preview */}
        <div className="flex-1 border-r border-border">
          <ReactFlowProvider>
            <DAGCanvas readonly />
          </ReactFlowProvider>
        </div>

        {/* Runs sidebar */}
        <div className="flex w-80 shrink-0 flex-col overflow-y-auto bg-card xl:w-96">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Recent Runs</h2>
            {sortedRuns.length > 0 && (
              <Badge tone="neutral" size="sm">
                {sortedRuns.length}
              </Badge>
            )}
          </div>

          {sortedRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Play className="mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No runs yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Run this workflow to see execution history
              </p>
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {visibleRuns.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}

              {(hasMoreRuns || visibleRunCount > RUNS_PAGE_SIZE) && (
                <div className="flex items-center justify-center gap-2 pt-1">
                  {hasMoreRuns && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setVisibleRunCount((n) => n + 10)}
                      className="text-primary hover:text-primary"
                      leftIcon={<ChevronDown className="h-3.5 w-3.5" />}
                    >
                      Show more ({sortedRuns.length - visibleRuns.length})
                    </Button>
                  )}
                  {visibleRunCount > RUNS_PAGE_SIZE && (
                    <Button variant="ghost" size="sm" onClick={() => setVisibleRunCount(RUNS_PAGE_SIZE)}>
                      Show less
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Variable Input Modal */}
      <VariableInputModal
        open={variableModalOpen}
        onClose={() => setVariableModalOpen(false)}
        onSubmit={executeRun}
        variables={workflow.variables}
        workflowName={workflow.name}
        isSubmitting={isRunning}
        linkedCodebases={linkedCodebases}
        stages={stages}
        submitLabel={isDraft ? 'Test run' : 'Start Run'}
      />
    </div>
  );
}

function RunRow({ run }: { run: WorkflowRun }) {
  const navigate = useNavigate();
  return (
    <EntityListRow
      size="sm"
      href={`/workflows/${run.workflowDefinitionId}/runs/${run.id}`}
      leading={<StatusBadge status={run.status} size="sm" />}
      title={<span className="truncate">{runTitle(run.name)}</span>}
      description={
        run.startedAt
          ? `Started ${new Date(run.startedAt).toLocaleString()}`
          : `Created ${new Date(run.createdAt).toLocaleString()}`
      }
    />
  );
}

/** Compact metadata pill used in the definition header. */
function MetaChip({
  icon,
  label,
  title,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title ?? label}
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-subtle px-2 py-0.5 text-[11px] text-muted-foreground',
        className,
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Row inside the header overflow popover. */
function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <Button variant="unstyled"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
        destructive
          ? 'text-danger hover:bg-danger-muted'
          : 'text-foreground hover:bg-subtle',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </Button>
  );
}

export default WorkflowDefinitionPage;
