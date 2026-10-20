// ────────────────────────────────────────────────────────────────
// RunHeader — the run workspace's C-01 PageHeader (board WorkflowRun; D-21).
//
//   row 1   breadcrumb Workflows / <definition> / <run> (h1) · pinned version
//           chip · D-18 status (Needs you while a stage waits on a review) ·
//           the run clock · Pause/Resume · Cancel · Retry failed · Open (VS
//           Code / Cursor) · More (event timeline, Copy path …) · dock toggle
//   row 2   permission mode · WF-06 BudgetMeter · stage progress · budget
//           exhausted + Raise budget · the focused stage's context gauge ·
//           trigger and start time
//
// The header owns the run's ONE ticking clock (D-24): nothing else on the
// page re-renders every second.
// ────────────────────────────────────────────────────────────────

import { memo, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { resolveMapping, resolveStatus, type RunUsage, type WorkflowRunPermissionMode } from '@generatorai/shared';
import { runTitle } from '@generatorai/client-core';
import type { ContextUsageSnapshot, UsageInfo } from '@generatorai/client-core';
import { shortcutFor } from '@/lib/shortcuts.js';
import { useEditorActions, FILE_MANAGER } from '@/blocks/editor/useEditorActions.js';
import { OpenInEditorButton } from '@/blocks/editor/OpenInEditorButton.js';
import { ContextGauge } from '@/blocks/composer/parts/ContextGauge.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { Breadcrumb, type BreadcrumbItem } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { MenuButton, type MenuButtonItem } from '@/ui/patterns/MenuButton/MenuButton.js';
import { heldByPausedStages } from '../model/pausedStages.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { APPROVAL_MODE_LABELS, PERMISSION_GATE_COPY } from '@generatorai/shared/ui-contract';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { ProgressBar } from '@/ui/primitives/ProgressBar/ProgressBar.js';
import { Icon } from '@/ui/icons/Icon.js';
import { formatDuration } from '../model/format.js';
import type { RunView, StageView } from '../model/types.js';
import { BudgetMeter } from './BudgetMeter.js';
import { formatWhen } from '@/lib/formatWhen.js';

/** The chat's permission-mode wording, for the run row's layer (W-65). */
const PERMISSION_OPTIONS: Array<{ value: WorkflowRunPermissionMode; label: string }> = (
  ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const
).map((value) => ({ value, label: APPROVAL_MODE_LABELS[value].label }));

export interface RunHeaderProps {
  run: Pick<RunView, 'name' | 'status' | 'startedAt' | 'completedAt' | 'permissionMode'> & { stages: StageView[] };
  definitionId: string | undefined;
  definitionName: string | undefined;
  /** The breadcrumb's run label (the start time when the run is named like its workflow). */
  runCrumb: string;
  /** The pinned definition version number. */
  version?: number | undefined;
  /** How the run was started (`manual`, `chat`, `automation` …). */
  triggerKind?: string | undefined;
  awaitingCount: number;
  parallelCount: number;
  usage?: RunUsage | undefined;
  budget?: Record<string, unknown> | undefined;
  statusReason?: string | undefined;
  /** The focused stage's context window, for the subbar gauge. */
  focusedContext?: { snapshot?: ContextUsageSnapshot | undefined; usage?: UsageInfo | undefined } | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  retryBusy: boolean;
  onRaiseBudget: () => void;
  onPermissionModeChange: (mode: WorkflowRunPermissionMode) => void;
  permissionBusy: boolean;
  /** U-16 (D-147): what "Allow for this run" remembered, and how to forget it ("N rules · Clear"). */
  permissionRules?: { matches: readonly string[]; onClear: () => void; busy: boolean } | undefined;
  graphOpen: boolean;
  onToggleGraph: () => void;
  onOpenTimeline: () => void;
  dockOpen: boolean;
  onToggleDock: () => void;
}

/** Elapsed run time, ticking once a second while the run is live — in this component only. */
function useElapsed(startedAt: number, completedAt: number | undefined, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return Math.max(0, (completedAt ?? (live ? now : Date.now())) - startedAt);
}

function capitalize(s: string): string {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1).replace(/_/g, ' ')}` : s;
}

export const RunHeader = memo(function RunHeader({
  run,
  definitionId,
  definitionName,
  runCrumb,
  version,
  triggerKind,
  awaitingCount,
  parallelCount,
  usage,
  budget,
  statusReason,
  focusedContext,
  onPause,
  onResume,
  onCancel,
  onRetry,
  retryBusy,
  onRaiseBudget,
  onPermissionModeChange,
  permissionBusy,
  permissionRules,
  graphOpen,
  onToggleGraph,
  onOpenTimeline,
  dockOpen,
  onToggleDock,
}: RunHeaderProps) {
  const editor = useEditorActions();
  const total = run.stages.length;
  const done = run.stages.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  const failed = run.stages.filter((s) => s.status === 'failed').length;

  // U-32: a live run held only by paused stages reads and acts as paused (Resume resumes those stages).
  const heldPaused = heldByPausedStages(run).length > 0;
  const isRunning = (run.status === 'running' || run.status === 'starting' || run.status === 'waiting') && !heldPaused;
  const isPaused = run.status === 'paused' || heldPaused;
  const isTerminal = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
  const elapsedMs = useElapsed(run.startedAt, run.completedAt, !isTerminal && run.status !== 'pending');
  const budgetExhausted = statusReason === 'budget_exhausted';

  // A stage waiting on the user outranks the run's own state (the badge says who has the ball).
  const status =
    awaitingCount > 0 && !isTerminal
      ? { ...resolveMapping({ state: 'needs_you' }, 'workflowRun'), label: awaitingCount > 1 ? `Needs you · ${awaitingCount}` : 'Needs you' }
      : (resolveStatus('workflowRun', heldPaused ? 'paused' : run.status) ?? resolveMapping({ state: 'queued' }, 'workflowRun'));

  const crumbs: BreadcrumbItem[] = [
    { label: 'Workflows', render: <RouterLink to="/workflows" /> },
    definitionId
      ? { label: definitionName ?? 'Workflow', render: <RouterLink to={`/workflows/${definitionId}`} /> }
      : { label: definitionName ?? 'Workflow' },
    {
      label: (
        <h1 className="inline truncate text-ui font-semibold" title={runTitle(run.name)}>
          {runCrumb}
        </h1>
      ),
    },
  ];

  const more: MenuButtonItem[] = [
    { id: 'timeline', label: 'Event timeline', icon: 'history', onSelect: onOpenTimeline },
  ];
  if (editor.target) {
    more.push({ type: 'separator', id: 'sep-editor' });
    more.push({ id: 'copy-path', label: 'Copy path', icon: 'copy', onSelect: () => void editor.copyPath() });
    const reveal = editor.reveal;
    if (reveal) more.push({ id: 'reveal', label: `Show in ${FILE_MANAGER}`, icon: 'folder-open', onSelect: () => void reveal() });
  }

  const startedText = formatWhen(run.startedAt);

  return (
    <PageHeader
      data-testid="page-header"
      breadcrumb={<Breadcrumb items={crumbs} data-testid="page-header-breadcrumb" />}
      status={
        <>
          {version !== undefined ? (
            <Chip mono size="sm" title={`Runs version ${version} of the workflow`}>
              v{version}
            </Chip>
          ) : null}
          <StatusBadge state={status.state} label={status.label} context="run" data-testid="run-status-badge" />
        </>
      }
      meta={
        <>
          <span className="inline-flex items-center gap-1 font-mono text-micro text-fg-2 tabular-nums" title="Run time">
            <Icon concept="clock" size={12} />
            {formatDuration(elapsedMs)}
          </span>
          {parallelCount > 0 ? (
            <Badge tone="run" icon="zap">
              {parallelCount} parallel
            </Badge>
          ) : null}
        </>
      }
      actions={
        <>
          {isRunning ? (
            <Button size="md" icon="pause" onClick={onPause}>
              Pause
            </Button>
          ) : null}
          {isPaused ? (
            <Button size="md" variant="primary" icon="play" onClick={onResume}>
              Resume
            </Button>
          ) : null}
          {isRunning || isPaused ? (
            <Button size="md" variant="danger" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          {isTerminal && run.status !== 'completed' ? (
            <Button
              size="md"
              variant="primary"
              icon="retry"
              onClick={onRetry}
              disabled={retryBusy}
              title="Re-run every stage that did not complete in a new run"
            >
              Retry failed
            </Button>
          ) : null}
          {/* U-52: the graph is a view of the page, not an action buried in More. */}
          <IconButton
            icon="workflows"
            label={graphOpen ? 'Hide graph' : 'Show graph'}
            pressed={graphOpen}
            onClick={onToggleGraph}
            data-testid="run-graph-toggle"
          />
          <OpenInEditorButton />
          <MenuButton label="More" icon="more" iconOnly items={more} align="end" data-testid="run-header-more" />
        </>
      }
      dockToggle={
        <IconButton
          icon="dock"
          label={dockOpen ? 'Hide side pane' : 'Show side pane'}
          pressed={dockOpen}
          onClick={onToggleDock}
          shortcut={shortcutFor('dock.toggle')}
          data-testid="dock-toggle"
        />
      }
      subbar={
        <>
          <span className="flex shrink-0 items-center gap-1.5 text-small text-fg-2" title="Tool approvals for this run's stages (from their next turn)">
            <Icon concept="shield" size={14} className="text-fg-3" />
            <span className="hidden lg:inline">Permission:</span>
            <Select
              size="sm"
              aria-label="Run permission mode"
              value={run.permissionMode}
              disabled={isTerminal || permissionBusy}
              onValueChange={(v) => {
                if (v) onPermissionModeChange(v as WorkflowRunPermissionMode);
              }}
              items={PERMISSION_OPTIONS}
            />
            {permissionRules && permissionRules.matches.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                title={`Allowed without asking in this run: ${permissionRules.matches.join(', ')}. Clear to ask again.`}
                aria-label={`Clear ${PERMISSION_GATE_COPY.rulesCount(permissionRules.matches.length)} remembered for this run: ${permissionRules.matches.join(', ')}`}
                disabled={permissionRules.busy}
                onClick={permissionRules.onClear}
                data-testid="run-permission-rules"
              >
                {PERMISSION_GATE_COPY.rulesCount(permissionRules.matches.length)} · {PERMISSION_GATE_COPY.clearRules}
              </Button>
            ) : null}
          </span>
          <span aria-hidden className="h-control-sm w-px shrink-0 bg-line-soft" />
          <BudgetMeter usage={usage} budget={budget} elapsedMs={elapsedMs} active={isRunning || isPaused} />
          {budgetExhausted ? (
            <>
              <Badge
                tone="warn"
                icon="warning"
                role="status"
                title="The run spent its budget (turns, tokens, wall clock or reported cost) and paused before launching more work. While it is over budget, a resume pauses it again."
              >
                Budget exhausted{isPaused ? ' · paused' : ''}
              </Badge>
              <Button
                size="sm"
                onClick={onRaiseBudget}
                title="Add half of each limit to the run budget (turns, tokens, wall clock, cost); the run resumes when it is under the new budget"
              >
                Raise budget 50%
              </Button>
            </>
          ) : null}
          {total > 0 ? (
            <span className="hidden shrink-0 items-center gap-1.5 text-small text-fg-3 md:inline-flex">
              <ProgressBar kind="progress" size="inline" value={done} max={total} label={`${done} of ${total} stages done`} />
              <span className="tabular-nums">
                {done}/{total} stages
              </span>
              {failed > 0 ? <span className="text-err">· {failed} failed</span> : null}
            </span>
          ) : null}
          {focusedContext && (focusedContext.snapshot || focusedContext.usage) ? (
            <ContextGauge snapshot={focusedContext.snapshot ?? null} usage={focusedContext.usage ?? null} />
          ) : null}
          <span className="ml-auto hidden min-w-0 truncate text-small text-fg-3 lg:inline">
            {triggerKind ? `${capitalize(triggerKind)} · ` : ''}
            {startedText}
          </span>
        </>
      }
    />
  );
});
