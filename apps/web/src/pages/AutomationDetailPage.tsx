// ────────────────────────────────────────────────────────────────
// AutomationDetailPage — View automation config + execution history
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useAutomation,
  useAutomationExecutions,
  useAutomationExecution,
  useTriggerAutomation,
  useEnableAutomation,
  useDisableAutomation,
  useDeleteAutomation,
  useCancelAutomationExecution,
} from '@/hooks/automationQueries.js';
import {
  ArrowLeft,
  Play,
  Trash2,
  Clock,
  Webhook,
  Hand,
  ChevronDown,
  ChevronRight,
  XCircle,
  Repeat,
  Copy,
  FileCode,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { ConfirmDialog, Button, Spinner, StatusBadge, PageHeader } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { TriggerAutomationModal } from '@/components/automation/TriggerAutomationModal.js';
import { ChangesSurface } from '@/components/diff/ChangesSurface.js';
import { useWorkflowRun } from '@/hooks/workflowQueries.js';
import { useAutomationExecutionStream } from '@/hooks/useAutomationExecutionStream.js';
import type { AutomationExecution, AutomationExecutionWithRuns } from '@generatorai/shared';

function formatDate(date: Date | string | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function AutomationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: automation, isLoading } = useAutomation(id);
  const { data: executions } = useAutomationExecutions(id);
  const triggerMutation = useTriggerAutomation();
  const enableMutation = useEnableAutomation();
  const disableMutation = useDisableAutomation();
  const deleteMutation = useDeleteAutomation();
  const cancelMutation = useCancelAutomationExecution();

  const [expandedExecId, setExpandedExecId] = useState<string | null>(null);
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  if (!automation) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <h2 className="text-lg font-semibold text-foreground">Automation not found</h2>
        <button onClick={() => navigate('/automations')} className="text-sm text-primary underline">
          Back to Automations
        </button>
      </div>
    );
  }

  const webhookUrl = automation.triggerType === 'webhook' && automation.webhookToken
    ? `${window.location.origin}/api/automations/webhooks/${automation.webhookToken}`
    : null;

  // Schema-driven automations need the trigger modal to collect per-run
  // dataset input. Legacy modes (single/loop/batch/script) have nothing
  // to configure at run time — Run Now fires the trigger immediately.
  const hasSchema = !!automation.dataSchema;
  const handleRunNow = () => {
    if (hasSchema) {
      setTriggerModalOpen(true);
      return;
    }
    triggerMutation.mutate({ id: automation.id });
  };

  return (
    <PageContainer className="max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/automations')}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Automations
        </button>

        <PageHeader
          title={
            <span className="flex items-center gap-3">
              {automation.name}
              <span className={cn(
                'h-2.5 w-2.5 rounded-full',
                automation.enabled ? 'bg-success' : 'bg-muted-foreground',
              )} />
            </span>
          }
          subtitle={automation.description}
          actions={
            <>
              <Button
                variant="primary"
                onClick={handleRunNow}
                disabled={!automation.enabled || triggerMutation.isPending}
                loading={triggerMutation.isPending}
                leftIcon={<Play className="h-4 w-4" />}
              >
                Run Now
              </Button>
              <Button
                variant="secondary"
                onClick={() => automation.enabled ? disableMutation.mutate(automation.id) : enableMutation.mutate(automation.id)}
              >
                {automation.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button
                variant="danger"
                size="icon"
                onClick={async () => { try { await deleteMutation.mutateAsync(automation.id); navigate('/automations'); } catch { /* error handled by mutation */ } }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          }
        />
      </div>

      {/* Config Summary */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Trigger</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {automation.triggerType === 'schedule' ? <Clock className="h-4 w-4" /> : automation.triggerType === 'webhook' ? <Webhook className="h-4 w-4" /> : <Hand className="h-4 w-4" />}
            {automation.triggerType === 'schedule' ? automation.cronExpression : automation.triggerType.charAt(0).toUpperCase() + automation.triggerType.slice(1)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Workflows</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{automation.workflowIds.length} workflow{automation.workflowIds.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Input Mode</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {automation.dataSchema && automation.iterationMode
              ? <><Repeat className="h-4 w-4" /> Schema · {automation.iterationMode.kind.replace('_', ' ')}</>
              : automation.inputMode === 'loop'
              ? <><Repeat className="h-4 w-4" /> Loop ({automation.loopItems?.length ?? 0})</>
              : automation.inputMode === 'batch'
              ? <><Repeat className="h-4 w-4" /> Batch ({automation.batchColumns?.length ?? 0} cols)</>
              : automation.inputMode === 'script'
              ? <><Repeat className="h-4 w-4" /> Script</>
              : 'Single'}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Last Run</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{formatDate(automation.lastRunAt)}</div>
        </div>
      </div>

      {/* Webhook URL */}
      {webhookUrl && (
        <div className="mb-8 rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Webhook URL</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
              {webhookUrl}
            </code>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigator.clipboard.writeText(webhookUrl)}
              title="Copy webhook URL"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-warning">
            Keep this URL secret — anyone with this URL can trigger the automation. Send a POST request with a JSON body to trigger; fields will be merged as variables.
          </p>
        </div>
      )}

      {/* Variables */}
      {Object.keys(automation.variables).length > 0 && (
        <div className="mb-8 rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Base Variables</div>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-3 text-xs text-foreground">
            {JSON.stringify(automation.variables, null, 2)}
          </pre>
        </div>
      )}

      {/* Batch Data Info */}
      {automation.inputMode === 'batch' && automation.batchDataFormat && (
        <div className="mb-8 rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Batch Data</div>
          <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Format: </span>
              <span className="font-medium text-foreground">{automation.batchDataFormat.toUpperCase()}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Columns: </span>
              <span className="font-medium text-foreground">{automation.batchColumns?.join(', ') ?? '—'}</span>
            </div>
            {automation.batchColumnMapping && Object.keys(automation.batchColumnMapping).length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground">Mappings: </span>
                <span className="font-medium text-foreground">
                  {Object.entries(automation.batchColumnMapping).map(([k, v]) => `${k}→${v}`).join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Track C — schema-driven data config */}
      {automation.dataSchema && (
        <div className="mb-8 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">Data schema</div>
            <div className="text-[10px] text-muted-foreground">
              Format: {automation.dataSchema.format} · {automation.dataSchema.fields.length} fields
              {automation.dataSchema.primaryKey && ` · key=${automation.dataSchema.primaryKey}`}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1 text-xs text-foreground md:grid-cols-2">
            {automation.dataSchema.fields.map((f) => (
              <div key={f.name} className="flex items-center gap-2 rounded bg-muted/40 px-2 py-1">
                <span className="font-medium">{f.name}</span>
                <span className="text-muted-foreground">: {f.type}</span>
                {f.required !== false && <span className="text-[10px] text-warning">required</span>}
                {f.enum && (
                  <span className="text-[10px] text-muted-foreground">enum({f.enum.length})</span>
                )}
              </div>
            ))}
          </div>
          {automation.iterationMode && (
            <div className="mt-2 text-xs text-muted-foreground">
              Iteration:{' '}
              <span className="font-medium text-foreground">
                {automation.iterationMode.kind === 'each_row' && 'each row'}
                {automation.iterationMode.kind === 'group_by' &&
                  `group by ${automation.iterationMode.fields.join(', ')}${
                    automation.iterationMode.groupVariable
                      ? ` → ${automation.iterationMode.groupVariable}`
                      : ''
                  }`}
                {automation.iterationMode.kind === 'single' &&
                  `single${
                    automation.iterationMode.datasetVariable
                      ? ` → ${automation.iterationMode.datasetVariable}`
                      : ''
                  }`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Track C — default dataset preview */}
      {automation.defaultDataset && (
        <div className="mb-8 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">Default dataset</div>
            <span className="text-[10px] text-muted-foreground">
              {automation.defaultDataset.format}
              {automation.defaultDataset.parsedRowCount != null &&
                ` · ${automation.defaultDataset.parsedRowCount} rows`}
            </span>
          </div>
          <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-tight text-foreground">
            {automation.defaultDataset.data.slice(0, 2000)}
            {automation.defaultDataset.data.length > 2000 && '\n… (truncated)'}
          </pre>
        </div>
      )}

      {/* Track A — retry policy */}
      {automation.retryPolicy && (
        <div className="mb-8 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Retry policy</div>
          <div className="grid grid-cols-2 gap-2 text-xs text-foreground md:grid-cols-4">
            <div>
              <span className="text-muted-foreground">Attempts: </span>
              <span className="font-medium">{automation.retryPolicy.maxAttempts}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Backoff: </span>
              <span className="font-medium">{automation.retryPolicy.initialBackoffMs}ms × {automation.retryPolicy.backoffMultiplier}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Max backoff: </span>
              <span className="font-medium">{automation.retryPolicy.maxBackoffMs}ms</span>
            </div>
            <div className="col-span-2 md:col-span-1">
              <span className="text-muted-foreground">Retry on: </span>
              <span className="font-medium">{automation.retryPolicy.retryOn.join(', ')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Execution History */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Execution History</h2>
        {!executions?.length ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            No executions yet. Click "Run Now" to trigger the first execution.
          </div>
        ) : (
          <div className="space-y-2">
            {executions.map((exec) => (
              <ExecutionRow
                key={exec.id}
                execution={exec}
                automationId={automation.id}
                expanded={expandedExecId === exec.id}
                onToggle={() => setExpandedExecId(expandedExecId === exec.id ? null : exec.id)}
                onCancel={() => cancelMutation.mutate({ automationId: automation.id, executionId: exec.id })}
                onViewRun={(runId, defId) => {
                  if (defId) navigate(`/workflows/${defId}/runs/${runId}`);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <TriggerAutomationModal
        // Remount on each open so paste/upload state is fresh.
        key={triggerModalOpen ? 'open' : 'closed'}
        open={triggerModalOpen}
        onClose={() => setTriggerModalOpen(false)}
        automation={automation}
      />
    </PageContainer>
  );
}

function ExecutionRow({
  execution,
  automationId,
  expanded,
  onToggle,
  onCancel,
  onViewRun,
}: {
  execution: AutomationExecution;
  automationId: string;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onViewRun: (runId: string, defId: string) => void;
}) {
  const { data: execWithRuns } = useAutomationExecution(
    expanded ? automationId : undefined,
    expanded ? execution.id : undefined,
  );
  // Track B — live updates while the execution is running.
  useAutomationExecutionStream(automationId, execution.id, {
    enabled: expanded && (execution.status === 'running' || execution.status === 'pending'),
  });
  const [confirmCancel, setConfirmCancel] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="flex w-full cursor-pointer items-center gap-3 p-4 text-left"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <StatusBadge status={execution.status} size="sm" />
        <span className="text-sm text-foreground">
          {execution.triggeredBy === 'schedule' ? 'Scheduled' : execution.triggeredBy === 'webhook' ? 'Webhook' : 'Manual'} trigger
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {execution.completedIterations}/{execution.totalIterations} completed
          {execution.failedIterations > 0 && <span className="ml-1 text-danger">({execution.failedIterations} failed)</span>}
        </span>
        <span className="text-xs text-muted-foreground">{formatDate(execution.createdAt)}</span>
        {(execution.status === 'running' || execution.status === 'pending') && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmCancel(true);
            }}
            className="rounded-lg p-1 text-danger transition-colors hover:bg-danger-muted"
            title="Cancel execution"
          >
            <XCircle className="h-4 w-4" />
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel execution"
        description="Cancel this execution? Any running workflows will be stopped."
        confirmLabel="Cancel execution"
        cancelLabel="Keep running"
        variant="warning"
        onConfirm={() => {
          setConfirmCancel(false);
          onCancel();
        }}
      />

      {expanded && execWithRuns && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {execution.error && (
            <div className="mb-3 rounded-lg bg-danger-muted p-3 text-xs text-danger">
              {execution.error}
            </div>
          )}
          {execWithRuns.runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No workflow runs yet</p>
          ) : (
            <div className="space-y-1">
              {execWithRuns.runs.map((run) => (
                <IterationRow
                  key={run.id}
                  run={run}
                  executionId={execution.id}
                  onViewRun={onViewRun}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One workflow run inside an automation execution.
 *
 * Changes are scoped to the ITERATION rather than the execution because the
 * workspace belongs to the workflow run — an execution that fans out over a
 * batch has one workspace per iteration, so there is no single diff for the
 * execution as a whole.
 */
function IterationRow({
  run,
  executionId,
  onViewRun,
}: {
  run: AutomationExecutionWithRuns['runs'][number];
  executionId: string;
  onViewRun: (runId: string, defId: string) => void;
}) {
  const [showChanges, setShowChanges] = useState(false);
  // Only fetch once the user asks — an execution can hold many iterations.
  const { data: runData } = useWorkflowRun(showChanges ? run.workflowRunId : undefined);

  return (
    <div className="rounded-lg">
      <div className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent">
        <StatusBadge status={run.status} size="sm" />
        <span className="text-xs text-muted-foreground">
          Iteration {run.iterationIndex + 1}
          {run.iterationLabel && (
            <span className="ml-1 font-mono text-foreground">({run.iterationLabel})</span>
          )}
        </span>
        <button
          onClick={() => setShowChanges((v) => !v)}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          title="Show the files this iteration changed"
        >
          <FileCode className="h-3 w-3" />
          {showChanges ? 'Hide changes' : 'Changes'}
        </button>
        <button
          onClick={() => onViewRun(run.workflowRunId, run.workflowDefinitionId)}
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Run: {run.workflowRunId.slice(0, 8)}…
        </button>
      </div>

      {showChanges && (
        <div className="mt-1 h-96 overflow-hidden rounded-lg border border-border">
          {runData?.workspaceId ? (
            // Review is read-only here: a finished automation run has no live
            // conversation, so a comment would have nowhere to be delivered.
            <ChangesSurface
              embedded
              workspaceId={runData.workspaceId}
              enableReview
              reviewScope={{ scope: 'automation', scopeId: executionId }}
              reviewDisabledReason="Automation runs have no live session. Open the workflow run to send review feedback."
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
              {runData
                ? 'This run has no workspace, so there are no file changes to show.'
                : 'Loading changes…'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
