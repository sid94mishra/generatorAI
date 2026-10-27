// ────────────────────────────────────────────────────────────────
// AutomationDetailPage (T-02 DetailPage, G-10-style stats computed
// client-side from the already-fetched execution list — no automation stats
// endpoint exists, so this is real data aggregated in the browser, not fake
// data (D-36); 04-screen-map.md §2.6 AutomationDetail, §4.7 #58) — ports
// pages/AutomationDetailPage.tsx onto the kit (D-35 fallback port).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Link as RouterLink } from 'react-router';
import { resolveStatus, type AutomationExecution, type AutomationExecutionWithRuns } from '@generatorai/shared';
import {
  useAutomation,
  useAutomationExecution,
  useAutomationExecutions,
  useCancelAutomationExecution,
  useDeleteAutomation,
  useDisableAutomation,
  useEnableAutomation,
  useRotateWebhookToken,
  useTriggerAutomation,
} from '@/hooks/automationQueries.js';
import { useAutomationExecutionStream } from '@/hooks/useAutomationExecutionStream.js';
import { useWorkflowDefinitions, useWorkflowRun } from '@/hooks/workflowQueries.js';
import { ChangesPanel } from '@/blocks/changes/ChangesPanel.js';
import { IterationsTable, type IterationsColumn } from '@/blocks/workflow/index.js';
import { useNarrow } from '@/lib/useNarrow.js';
import { AutomationTriggerBadge } from './AutomationTriggerBadge.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { KeyValueList } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { StatStrip, type StatTileItem } from '@/ui/patterns/StatStrip/StatStrip.js';
import { DetailPage } from '@/ui/templates/DetailPage/DetailPage.js';
import { APPROVAL_MODE_LABELS, type ApprovalMode } from '@generatorai/shared/ui-contract';
import { formatNextRun } from '@/lib/nextRun.js';
import { TriggerAutomationDialog } from './TriggerAutomationDialog.js';
import { WebhookCredentialsDialog, type WebhookCredentials } from './WebhookCredentialsDialog.js';


function formatDate(date: Date | string | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** "45s", "6m 12s", "20h 10m" — a long run never reads "1210m 11s" (U-56). */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Client-side equivalent of D-58's G-10 stats: no automation-stats endpoint
 *  exists, so this aggregates the already-fetched execution list — real
 *  data, computed in the browser (D-36). */
/** Still being driven, so it can be cancelled: queued, running or paused on its runs (U-85). */
function isLive(status: AutomationExecution['status'] | undefined): boolean {
  return status === 'pending' || status === 'running' || status === 'paused';
}

function computeStats(executions: readonly AutomationExecution[] | undefined) {
  // A skipped slot (U-78) is history, not an execution: it counts towards none of the stats.
  const list = (executions ?? []).filter((e) => e.status !== 'skipped');
  const since = Date.now() - 30 * 24 * 60 * 60_000;
  const last30d = list.filter((e) => new Date(e.createdAt).getTime() >= since);
  const terminal = list.filter((e) => e.status === 'completed' || e.status === 'partial' || e.status === 'failed' || e.status === 'cancelled');
  const succeeded = terminal.filter((e) => e.status === 'completed');
  const durations = list
    .filter((e) => e.startedAt && e.completedAt)
    .map((e) => new Date(e.completedAt!).getTime() - new Date(e.startedAt!).getTime());
  const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : undefined;
  return {
    executions30d: last30d.length,
    successRate: terminal.length > 0 ? Math.round((succeeded.length / terminal.length) * 100) : undefined,
    successOf: terminal.length,
    avgDurationMs,
  };
}

export function AutomationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: automation, isLoading } = useAutomation(id);
  const { data: definitions } = useWorkflowDefinitions();
  // Below ~1150px of card the rail stacks under the history (T-02), as Workflow detail does.
  const [measureRef, narrow] = useNarrow<HTMLDivElement>();
  const { data: executions } = useAutomationExecutions(id);
  const triggerMutation = useTriggerAutomation();
  const enableMutation = useEnableAutomation();
  const disableMutation = useDisableAutomation();
  const deleteMutation = useDeleteAutomation();
  const rotateWebhookToken = useRotateWebhookToken();
  const cancelExecution = useCancelAutomationExecution();
  const confirmer = useConfirm();

  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);
  const [webhookCredentials, setWebhookCredentials] = useState<WebhookCredentials | null>(null);
  const [rotateError, setRotateError] = useState<string | null>(null);

  const { data: selectedExecution } = useAutomationExecution(selectedExecutionId ? id : undefined, selectedExecutionId ?? undefined);
  useAutomationExecutionStream(id, selectedExecutionId ?? undefined, {
    enabled: Boolean(selectedExecutionId) && isLive(selectedExecution?.status),
  });
  // U-85: the run a paused execution waits on, for the callout's Open run.
  const pausedRun = selectedExecution?.status === 'paused' ? selectedExecution.runs.find((r) => r.status === 'paused' && r.workflowRunId) : undefined;
  const selectedRun = selectedExecution?.runs.find((r) => r.id === selectedRunId);
  const { data: selectedRunData } = useWorkflowRun(selectedRun?.workflowRunId ?? undefined);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <StatusBadge state="running" label="Loading…" />
      </div>
    );
  }
  if (!automation) {
    return (
      <EmptyState
        icon="warning"
        title="Automation not found"
        action={
          <Button size="sm" onClick={() => navigate('/automations')}>
            Back to automations
          </Button>
        }
      />
    );
  }

  const stats = computeStats(executions);
  const nextRun = formatNextRun(automation.nextRunAt, { enabled: automation.enabled });
  const hasSchema = Boolean(automation.dataSchema);

  const statItems: StatTileItem[] = [
    { value: stats.executions30d, label: 'Executions · 30 days' },
    { value: stats.successRate != null ? `${stats.successRate}%` : '—', label: stats.successOf > 0 ? `Success · ${stats.successOf} ${stats.successOf === 1 ? 'run' : 'runs'}` : 'Success', numeric: false },
    { value: stats.avgDurationMs != null ? formatDuration(stats.avgDurationMs) : '—', label: 'Avg duration', numeric: false },
    { value: nextRun.short, label: 'Next run', tone: nextRun.none ? undefined : 'run', numeric: false },
  ];

  const handleRunNow = () => {
    if (hasSchema) {
      setTriggerDialogOpen(true);
      return;
    }
    triggerMutation.mutate({ id: automation.id });
  };

  const handleRotateWebhookToken = async () => {
    setRotateError(null);
    try {
      const result = await rotateWebhookToken.mutateAsync(automation.id);
      setWebhookCredentials({
        webhookUrl: `${window.location.origin}/api/automations/webhooks/${result.token}`,
        token: result.token,
        signingSecret: result.signingSecret,
      });
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async () => {
    const ok = await confirmer.confirm({
      title: `Delete "${automation.name}"?`,
      description: 'This cannot be undone.',
      confirmLabel: 'Delete automation',
    });
    if (!ok) return;
    await deleteMutation.mutateAsync(automation.id);
    navigate('/automations');
  };

  // Executions arrive newest-first; number them by creation order (no
  // sequential "execution number" field exists server-side).
  const numberedExecutions = new Map((executions ?? []).map((exec, i) => [exec.id, (executions?.length ?? 0) - i]));

  const executionColumns: IterationsColumn<AutomationExecution>[] = [
    { id: 'index', header: '#', width: 40, mono: true, cell: (row: AutomationExecution) => `#${numberedExecutions.get(row.id) ?? ''}` },
    {
      id: 'status',
      header: 'Status',
      width: 120,
      cell: (row: AutomationExecution) => {
        const resolved = resolveStatus('automationExecution', row.status);
        return resolved ? <StatusBadge state={resolved.state} label={resolved.label} context="run" /> : null;
      },
    },
    { id: 'trigger', header: 'Trigger', width: 104, cell: (row: AutomationExecution) => <AutomationTriggerBadge triggerType={row.triggeredBy} /> },
    {
      id: 'iterations',
      header: 'Iterations',
      // The flexible column: fixed widths summed past the card at 1440 and clipped "Started".
      width: 'minmax(72px,1fr)',
      mono: true as const,
      cell: (row: AutomationExecution) => (
        <span>
          {row.completedIterations}/{row.totalIterations}
          {row.failedIterations > 0 ? <span className="text-err"> ({row.failedIterations} failed)</span> : null}
        </span>
      ),
    },
    {
      id: 'duration',
      header: 'Duration',
      width: 80,
      align: 'end' as const,
      mono: true as const,
      cell: (row: AutomationExecution) => (row.startedAt && row.completedAt ? formatDuration(new Date(row.completedAt).getTime() - new Date(row.startedAt).getTime()) : '—'),
    },
    { id: 'started', header: 'Started', width: 168, align: 'end' as const, mono: true as const, cell: (row: AutomationExecution) => formatDate(row.createdAt) },
  ];

  return (
    <div ref={measureRef} className="h-full min-h-0">
      <DetailPage
        railStacked={narrow}
        header={
          <PageHeader
            breadcrumb={<Breadcrumb items={[{ label: 'Automations', render: <RouterLink to="/automations" /> }, { label: automation.name }]} />}
            status={<StatusBadge state={automation.enabled ? 'succeeded' : 'skipped'} label={automation.enabled ? 'Enabled' : 'Disabled'} />}
            actions={
              <>
                <Button variant="primary" icon="play" onClick={handleRunNow} disabled={!automation.enabled || triggerMutation.isPending} loading={triggerMutation.isPending}>
                  Run now
                </Button>
                <MenuButton
                  label="More actions"
                  iconOnly
                  icon="more"
                  items={[
                    automation.enabled
                      ? { id: 'disable', label: 'Disable', icon: 'pause', onSelect: () => disableMutation.mutate(automation.id) }
                      : { id: 'enable', label: 'Enable', icon: 'play', onSelect: () => enableMutation.mutate(automation.id) },
                    { type: 'separator' },
                    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: () => void handleDelete() },
                  ]}
                />
              </>
            }
          />
        }
        title={<PageTitle variant="detail" title={automation.name} description={automation.description} />}
        content={
          <div className="flex min-w-0 flex-col gap-5">
            <StatStrip items={statItems} />
            <div className="min-w-0">
              <h2 className="mb-3 text-title font-semibold text-fg">Execution history</h2>
              {!executions?.length ? (
                <EmptyState icon="automations" title="No executions yet" description='Click "Run now" to trigger the first execution.' />
              ) : (
                <IterationsTable
                  label="Execution history"
                  size="md"
                  columns={executionColumns}
                  rows={executions}
                  getRowId={(row) => row.id}
                  onRowClick={(row) => {
                    setSelectedExecutionId((current) => (current === row.id ? null : row.id));
                    setSelectedRunId(null);
                  }}
                  rowActions={(row) =>
                    isLive(row.status) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="x"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const ok = await confirmer.confirm({
                            title: 'Cancel execution',
                            description: 'Cancel this execution? Any running workflows will be stopped.',
                            confirmLabel: 'Cancel execution',
                            tone: 'danger',
                          });
                          if (ok) cancelExecution.mutate({ automationId: automation.id, executionId: row.id });
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null
                  }
                />
              )}
            </div>
            {selectedExecutionId && selectedExecution ? (
              <Card data-testid="execution-detail">
                <Card.Header title={`Execution #${selectedExecutionId.slice(0, 8)}…`} action={<Button variant="ghost" size="sm" onClick={() => setSelectedExecutionId(null)}>Close</Button>} />
                <Card.Body>
                  {selectedExecution.status === 'paused' ? (
                    <Callout
                      tone="warn"
                      title="Paused — waiting for you"
                      action={
                        pausedRun ? (
                          <Button size="sm" render={<RouterLink to={`/workflows/${pausedRun.workflowDefinitionId}/runs/${pausedRun.workflowRunId}`} />}>
                            Open run
                          </Button>
                        ) : undefined
                      }
                      data-testid="execution-paused"
                    >
                      {selectedExecution.error ?? 'A run paused.'} Retry it from the run, or cancel the execution.
                    </Callout>
                  ) : selectedExecution.error ? (
                    <Callout tone={selectedExecution.status === 'skipped' ? 'info' : 'err'}>{selectedExecution.error}</Callout>
                  ) : null}
                  {selectedExecution.runs.length === 0 ? (
                    <p className="text-small text-fg-3">{selectedExecution.status === 'skipped' ? 'Nothing ran.' : 'No workflow runs yet.'}</p>
                  ) : (
                    <IterationsTable
                      label={`Execution #${selectedExecutionId.slice(0, 8)} iterations`}
                      columns={[
                        {
                          id: 'status',
                          header: 'Status',
                          width: 110,
                          cell: (row: AutomationExecutionWithRuns['runs'][number]) => {
                            const resolved = resolveStatus('automationRunItem', row.status);
                            return resolved ? <StatusBadge state={resolved.state} label={resolved.label} context="run" /> : null;
                          },
                        },
                        {
                          id: 'iteration',
                          header: 'Iteration',
                          width: 'minmax(160px,1fr)',
                          cell: (row: AutomationExecutionWithRuns['runs'][number]) => (
                            <span className="font-mono text-micro">
                              {row.iterationIndex + 1}
                              {row.iterationLabel ? <span className="text-fg"> ({row.iterationLabel})</span> : null}
                            </span>
                          ),
                        },
                        {
                          id: 'run',
                          header: 'Workflow run',
                          width: 150,
                          cell: (row: AutomationExecutionWithRuns['runs'][number]) =>
                            row.workflowRunId ? (
                              <Link render={<RouterLink to={`/workflows/${row.workflowDefinitionId}/runs/${row.workflowRunId}`} />} className="font-mono text-small">
                                {row.workflowRunId.slice(0, 8)}…
                              </Link>
                            ) : (
                              <span className="text-small text-fg-3">Deleted</span>
                            ),
                        },
                        {
                          id: 'changes',
                          header: 'Changes',
                          width: 110,
                          cell: (row: AutomationExecutionWithRuns['runs'][number]) => (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="diff"
                              pressed={selectedRunId === row.id}
                              onClick={() => setSelectedRunId((current) => (current === row.id ? null : row.id))}
                            >
                              {selectedRunId === row.id ? 'Hide' : 'Show'}
                            </Button>
                          ),
                        },
                      ]}
                      rows={selectedExecution.runs}
                      getRowId={(row) => row.id}
                    />
                  )}
                  {selectedRunId ? (
                    <div className="max-h-96 overflow-hidden rounded-card border border-line-soft">
                      {selectedRunData?.workspaceId ? (
                        <ChangesPanel
                          workspaceId={selectedRunData.workspaceId}
                          enableReview
                          reviewScope={{ scope: 'automation', scopeId: selectedExecutionId }}
                          reviewDisabledReason="Automation runs have no live session. Open the workflow run to send review feedback."
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center p-4 text-center text-small text-fg-3">
                          {selectedRunData ? 'This run has no workspace, so there are no file changes to show.' : 'Loading changes…'}
                        </div>
                      )}
                    </div>
                  ) : null}
                </Card.Body>
              </Card>
            ) : null}
          </div>
        }
        rail={
          <>
            <Card>
              <Card.Header title="Trigger" />
              <Card.Body>
                {/* A row of its own: the card body is a column that would stretch the badge. */}
                <div className="flex">
                  <AutomationTriggerBadge triggerType={automation.triggerType} label={automation.triggerType === 'schedule' ? automation.cronExpression : undefined} />
                </div>
                {automation.triggerType === 'webhook' ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-small text-fg-3">
                      The token and signing secret are shown once, when the webhook is created or rotated. Send a signed POST with{' '}
                      <InlineCode>X-Signature-256</InlineCode>.
                    </p>
                    {rotateError ? <Callout tone="err">{rotateError}</Callout> : null}
                    <Button variant="secondary" size="sm" onClick={() => void handleRotateWebhookToken()} disabled={rotateWebhookToken.isPending} loading={rotateWebhookToken.isPending}>
                      Rotate token &amp; secret
                    </Button>
                  </div>
                ) : null}
              </Card.Body>
            </Card>
            <Card>
              <Card.Header title="Workflow" />
              <Card.Body>
                <KeyValueList
                  labelWidth={92}
                  items={[
                    {
                      label: automation.workflowIds.length === 1 ? 'Workflow' : 'Workflows',
                      // Board AutomationDetail names the workflow; the count is the fallback.
                      value:
                        automation.workflowIds
                          .map((wid) => definitions?.find((d) => d.id === wid)?.name)
                          .filter(Boolean)
                          .join(', ') || `${automation.workflowIds.length} workflow${automation.workflowIds.length === 1 ? '' : 's'}`,
                    },
                    { label: 'Permission', value: APPROVAL_MODE_LABELS[automation.permissionMode as ApprovalMode]?.word ?? automation.permissionMode },
                    { label: 'On error', value: automation.onError === 'stop' ? 'Stop on error' : 'Continue on error' },
                    { label: 'Concurrency', value: String(automation.maxConcurrency) },
                    // D-103: the codebases runs mount and the branch each is cut from.
                    ...(automation.codebases?.length
                      ? [{ label: 'Codebases', value: automation.codebases.map((c) => `${c.alias} @ ${c.baseRef ?? 'default branch'}`).join(', ') }]
                      : []),
                  ]}
                />
              </Card.Body>
            </Card>
            {automation.dataSchema ? (
              <Card>
                <Card.Header title="Dataset" meta={`${automation.dataSchema.fields.length} fields`} />
                <Card.Body>
                  <KeyValueList
                    labelWidth={92}
                    items={[
                      { label: 'Format', value: automation.dataSchema.format },
                      {
                        label: 'Iteration',
                        value:
                          automation.iterationMode?.kind === 'each_row'
                            ? 'Each row'
                            : automation.iterationMode?.kind === 'group_by'
                              ? `Grouped by ${automation.iterationMode.fields.join(', ')}`
                              : 'Whole dataset',
                      },
                      ...(automation.defaultDataset?.parsedRowCount != null
                        ? [{ label: 'Default rows', value: String(automation.defaultDataset.parsedRowCount) }]
                        : []),
                    ]}
                  />
                </Card.Body>
              </Card>
            ) : null}
            {Object.keys(automation.variables).length > 0 ? (
              <Card>
                <Card.Header title="Base variables" />
                <Card.Body>
                  <pre className="max-h-40 overflow-auto rounded-control bg-sunken p-2.5 font-mono text-micro text-fg">{JSON.stringify(automation.variables, null, 2)}</pre>
                </Card.Body>
              </Card>
            ) : null}
            {automation.retryPolicy ? (
              <Card>
                <Card.Header title="Retry policy" />
                <Card.Body>
                  <KeyValueList
                    labelWidth={92}
                    items={[
                      { label: 'Attempts', value: String(automation.retryPolicy.maxAttempts) },
                      { label: 'Backoff', value: `${automation.retryPolicy.initialBackoffMs}ms × ${automation.retryPolicy.backoffMultiplier}`, mono: true },
                      { label: 'Max backoff', value: `${automation.retryPolicy.maxBackoffMs}ms`, mono: true },
                      { label: 'Retry on', value: automation.retryPolicy.retryOn.join(', ') },
                    ]}
                  />
                </Card.Body>
              </Card>
            ) : null}
          </>
        }
      />
      {confirmer.dialog}
      <TriggerAutomationDialog key={triggerDialogOpen ? 'open' : 'closed'} open={triggerDialogOpen} onClose={() => setTriggerDialogOpen(false)} automation={automation} />
      <WebhookCredentialsDialog open={webhookCredentials !== null} credentials={webhookCredentials} onClose={() => setWebhookCredentials(null)} />
    </div>
  );
}
