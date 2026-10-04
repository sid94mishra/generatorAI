// ────────────────────────────────────────────────────────────────
// ActivityDetails (D-92; board EnhActivityPopovers) — the popover beside an
// Activity card or a rail tile, for every kind: what it is, what it needs,
// where and how it runs, then actions.
//
// Data: the entry (attention / G-11 item) draws the header, band and
// actions at once; the details and lists come from the entity's existing
// reads, fetched only while the popover is open and refetched when the
// entry changes (the attention feed is the trigger — no polling):
//   chat           GET /chats/:id (agent, model, effort) + workspace info (branch)
//   orchestrator   + GET /chats/:id/background-tasks (the workers)
//   workflow run   GET /workflow-runs/:id (trigger, stages, the failing stage)
//   automation     GET /automations/:id + its executions (today's runs)
// A field the reads do not have is left out, never invented (D-36): no
// server, no context gauge, no recent tool steps.
// ────────────────────────────────────────────────────────────────

import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  activityStages,
  askSubject,
  describeAutomationTrigger,
  workerTallyLine,
  type ActivityEntry,
} from '@generatorai/client-core';
import { resolveStatus, type StageRun, type StatusState } from '@generatorai/shared';
import { PERMISSION_GATE_COPY } from '@generatorai/shared/ui-contract';
import type { IconConcept } from '@generatorai/design-tokens';
import { useAttentionAction } from '@/hooks/attentionQueries.js';
import { useRetryActivity } from '@/hooks/activityQueries.js';
import { useAutomation, useAutomationExecutions } from '@/hooks/automationQueries.js';
import { useBackgroundTasks, useChat } from '@/hooks/queries.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { useWorkflowRun } from '@/hooks/workflowQueries.js';
import { useActivityStore } from '@/stores/activityStore.js';
import {
  ActivityPopoverBand,
  ActivityPopoverBody,
  ActivityPopoverCode,
  ActivityListRow,
  ActivityPopoverSection,
} from '@/ui/patterns/ActivityPopover/ActivityPopover.js';
import { ActivityStageBar } from '@/ui/patterns/ActivityCard/ActivityCard.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import type { KeyValueItem } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { askAnswers, kindIcon, kindLabel, openLabel, stopLabel } from './activityView.js';

export interface ActivityDetailsProps {
  entry: ActivityEntry;
  now: number;
  modelLabel: (id: string) => string;
  /** Close the popover (after an inline action, or on Open). */
  onDone: () => void;
  /** After Open navigated (the overlay column closes itself). */
  onNavigate?: () => void;
  titleId?: string;
}

const clock = (iso: string | Date | undefined): string | undefined => {
  if (!iso) return undefined;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
};

function duration(fromIso: string, to: number): string {
  const seconds = Math.max(0, Math.floor((to - Date.parse(fromIso)) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

/** First-row label + value for when it started / waited / ended. */
function timeRow(entry: ActivityEntry, now: number): KeyValueItem {
  const since = clock(entry.at);
  switch (entry.group) {
    case 'needs_you':
      return { label: 'Waiting', value: duration(entry.at, now), meta: since ? `since ${since}` : undefined };
    case 'running':
      return { label: 'Running for', value: duration(entry.at, now), mono: true, meta: since ? `since ${since}` : undefined };
    case 'failed':
      return { label: 'Failed', value: since ?? '', mono: true };
    case 'recent':
      return { label: entry.outcome === 'cancelled' ? 'Stopped' : 'Finished', value: since ?? '', mono: true };
  }
}

/** The run's trigger in words (WorkflowRun.trigger.kind). */
function triggerWord(kind: string | undefined): string | undefined {
  if (!kind) return undefined;
  const words: Record<string, string> = { user: 'Manual', manual: 'Manual', schedule: 'Schedule', automation: 'Automation', webhook: 'Webhook', fork: 'Retry of a run', chat: 'From a chat', api: 'API' };
  return words[kind] ?? kind;
}

function stageGlyph(stage: Pick<StageRun, 'status'>): { icon: IconConcept; tone: 'run' | 'ok' | 'warn' | 'err' | 'muted'; spin: boolean; word: string; state: StatusState } {
  const status = resolveStatus('stageRun', stage.status);
  const state = status?.state ?? 'queued';
  const tone = state === 'running' ? 'run' : state === 'succeeded' ? 'ok' : state === 'needs_you' ? 'warn' : state === 'failed' ? 'err' : 'muted';
  return { icon: `status-${state === 'needs_you' ? 'needs-you' : state}` as IconConcept, tone, spin: state === 'running', word: (status?.label ?? stage.status).toLowerCase(), state };
}

export function ActivityDetails({ entry, now, modelLabel, onDone, onNavigate, titleId }: ActivityDetailsProps) {
  const navigate = useNavigate();
  const act = useAttentionAction();
  const retry = useRetryActivity();
  const dismiss = useActivityStore((s) => s.dismiss);

  const isChat = entry.entity === 'chat';
  const isRun = entry.entity === 'workflow_run';
  const automationId = entry.meta?.automation?.id ?? /^\/automations\/([^/?#]+)/.exec(entry.href)?.[1];

  const chat = useChat(isChat ? entry.entityId : undefined);
  const workspace = useWorkspaceInfo(chat.data?.workspaceId, isChat);
  const workers = useBackgroundTasks(isChat && entry.kind === 'orchestrator' ? entry.entityId : undefined, true, { poll: false });
  const run = useWorkflowRun(isRun ? entry.entityId : undefined, { poll: false });
  const automation = useAutomation(entry.entity === 'automation_execution' ? automationId : undefined);
  const executions = useAutomationExecutions(entry.entity === 'automation_execution' ? automationId : undefined);

  // The attention feed is the trigger: a new step, a worker's change or a new stage refetches what is shown.
  const signature = JSON.stringify([entry.state, entry.progress, entry.meta?.workers, entry.ask?.id, entry.at]);
  const { refetch: refetchWorkers } = workers;
  const { refetch: refetchRun } = run;
  useEffect(() => {
    if (entry.kind === 'orchestrator') void refetchWorkers();
    if (isRun) void refetchRun();
  }, [signature, entry.kind, isRun, refetchWorkers, refetchRun]);

  const open = () => {
    onDone();
    navigate(entry.href);
    onNavigate?.();
  };
  const busy = act.isPending || retry.isPending;

  // ── Band ──
  let band: ReactNode = null;
  const answers = askAnswers(entry);
  if (entry.group === 'needs_you' && entry.ask) {
    const ask = entry.ask;
    const more = entry.asks.length - 1;
    const item = entry.asks[0]!;
    const subject = ask.kind === 'tool_permission' || ask.kind === 'computer_consent' ? askSubject(ask.detail, { plainIsCommand: ask.kind === 'tool_permission' }) : undefined;
    const bandTitle = entry.worker ? `Worker ${entry.worker.title} asks` : subject?.command ? 'Allow this command?' : ask.summary;
    const stageAside = isRun && entry.progress?.step !== undefined && entry.progress.of !== undefined ? `stage ${entry.progress.step} of ${entry.progress.of}` : undefined;
    const stages = activityStages(entry);
    band = (
      <ActivityPopoverBand tone="warn" title={bandTitle} aside={stageAside} data-testid="activity-popover-ask">
        {stages ? <ActivityStageBar stages={stages} /> : null}
        {ask.detail ? (
          subject ? (
            // D-86: the command / path the gate names, not its JSON wrapper.
            <ActivityPopoverCode>{subject.text}</ActivityPopoverCode>
          ) : (
            // The aside already says where the gate sits: drop the detail's "Stage n of m · " prefix.
            <p className="line-clamp-3 text-small text-fg-2">{stageAside ? ask.detail.replace(/^Stage \d+ of \d+( · )?/, '') : ask.detail}</p>
          )
        ) : null}
        {entry.worker && !subject?.command ? <p className="text-small text-fg-2">{ask.summary}</p> : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {ask.risk === 'risky' ? <Badge tone="warn">{PERMISSION_GATE_COPY.risky}</Badge> : null}
          {more > 0 ? <span className="text-micro text-fg-2">+{more} more waiting</span> : null}
          <span className="ml-auto flex items-center gap-1.5">
            {!answers.approve ? (
              <Button size="sm" onClick={open}>
                {openLabel(entry)}
              </Button>
            ) : ask.kind === 'stage_approval' || ask.kind === 'plan_review' ? (
              <Button size="sm" variant="ghost" onClick={open}>
                Review
              </Button>
            ) : null}
            {answers.decline ? (
              <Button
                size="sm"
                disabled={busy}
                aria-label={`${answers.decline.label} — ${entry.title}`}
                onClick={() => act.mutate({ item, action: answers.decline!.action }, { onSuccess: onDone })}
              >
                {answers.decline.label}
              </Button>
            ) : null}
            {answers.approve ? (
              <Button
                size="sm"
                variant="primary"
                loading={act.isPending}
                disabled={busy}
                aria-label={`${answers.approve.label} — ${entry.title}`}
                onClick={() => act.mutate({ item, action: answers.approve!.action }, { onSuccess: onDone })}
              >
                {answers.approve.label}
              </Button>
            ) : null}
          </span>
        </div>
      </ActivityPopoverBand>
    );
  } else if (entry.group === 'failed') {
    const failedStage = run.data?.stageRuns.find((s) => !s.scopeId && s.status === 'failed');
    const message = failedStage?.error ?? run.data?.error ?? entry.summary ?? 'Failed';
    band = (
      <ActivityPopoverBand
        tone="err"
        title={failedStage ? `Stage · ${failedStage.name}` : entry.kind === 'automation' ? 'Automation run failed' : 'Error'}
        aside={failedStage?.errorCode}
        data-testid="activity-popover-error"
      >
        <ActivityPopoverCode tone="err">{message}</ActivityPopoverCode>
        <div className="flex items-center gap-1.5">
          <Button size="sm" icon="file-text" onClick={open}>
            {isRun ? 'Full log' : 'Open'}
          </Button>
          {entry.retry ? (
            <Button
              size="sm"
              variant="primary"
              icon="retry"
              className="ml-auto"
              loading={retry.isPending}
              disabled={busy}
              onClick={() =>
                retry.mutate(entry.recent!, {
                  onSuccess: (res) => {
                    onDone();
                    if (res.runId) {
                      navigate(entry.href.replace(/[^/]+$/, res.runId));
                      onNavigate?.();
                    }
                  },
                })
              }
            >
              {entry.retry === 'run_retry' ? 'Retry run' : 'Retry last prompt'}
            </Button>
          ) : null}
        </div>
      </ActivityPopoverBand>
    );
  } else if (entry.group === 'running') {
    const stages = activityStages(entry);
    const tally = entry.meta?.workers;
    if (entry.kind === 'orchestrator' && tally && tally.total > 0) {
      band = (
        <ActivityPopoverBand title={`${tally.done} of ${tally.total} workers done`} aside={workerTallyLine({ ...tally, done: 0 })}>
          <ActivityStageBar
            stages={Array.from({ length: Math.min(tally.total, 12) }, (_, i) =>
              i < tally.done ? 'done' : i < tally.done + tally.running + tally.inReview ? 'current' : 'pending',
            )}
          />
        </ActivityPopoverBand>
      );
    } else if (entry.progress?.label || stages) {
      const p = entry.progress;
      band = (
        <ActivityPopoverBand
          title={p?.label ?? 'Running'}
          aside={p?.step !== undefined && p.of !== undefined ? `${isRun ? 'stage' : 'step'} ${p.step} of ${p.of}` : undefined}
        >
          {stages ? <ActivityStageBar stages={stages} /> : null}
        </ActivityPopoverBand>
      );
    }
  }

  // ── Details ──
  const details: KeyValueItem[] = [timeRow(entry, now)];
  if (isChat) {
    const agent = entry.meta?.agent ?? chat.data?.agentSnapshot?.driving?.name;
    const model = entry.meta?.model ?? chat.data?.model;
    const effort = chat.data?.harnessConfig?.reasoningEffort;
    if (agent) details.push({ label: 'Agent', value: agent });
    if (model) details.push({ label: 'Model', value: modelLabel(model) });
    if (typeof effort === 'string' && effort) details.push({ label: 'Effort', value: effort.charAt(0).toUpperCase() + effort.slice(1) });
    const primary = [...(workspace.data?.mounts ?? [])].filter((m) => m.status !== 'removed').sort((a, b) => a.position - b.position)[0];
    if (primary?.git?.branch) details.push({ label: 'Workspace', value: primary.git.branch, mono: true, meta: primary.mode === 'worktree' ? 'worktree' : undefined });
  }
  if (isRun && run.data) {
    const trigger = triggerWord(run.data.trigger?.kind);
    if (trigger) details.push({ label: 'Trigger', value: trigger });
  }
  if (entry.entity === 'automation_execution') {
    const trig = entry.meta?.automation ?? (automation.data ? { id: automation.data.id, triggerType: automation.data.triggerType, cronExpression: automation.data.cronExpression } : undefined);
    if (trig) details.push({ label: 'Schedule', value: describeAutomationTrigger(trig) });
    const today = (executions.data ?? []).filter((e) => new Date(e.createdAt).toDateString() === new Date(now).toDateString());
    if (today.length > 0) {
      const failed = today.filter((e) => e.status === 'failed' || e.status === 'partial').length;
      details.push({ label: 'Today', value: `${today.length} run${today.length === 1 ? '' : 's'}${failed > 0 ? ` · ${failed} failed` : ''}` });
    }
  }
  if (entry.changes && (entry.changes.additions > 0 || entry.changes.deletions > 0)) {
    details.push({ label: 'Changes', value: <DiffStat added={entry.changes.additions} removed={entry.changes.deletions} files={entry.changes.files} /> });
  }

  // ── Sections ──
  let sections: ReactNode = null;
  if (entry.kind === 'orchestrator' && workers.data && workers.data.tasks.length > 0) {
    const tasks = workers.data.tasks;
    sections = (
      // The list holds this server session's workers; the tally counts every wave (D-92).
      <ActivityPopoverSection
        title={entry.meta?.workers && entry.meta.workers.total > tasks.length ? 'Latest workers' : 'Workers'}
        count={tasks.length}
        data-testid="activity-popover-workers"
      >
        {tasks.map((task) => {
          const status = resolveStatus('backgroundTask', task.status);
          const asking = entry.worker?.id === task.taskId;
          const state = asking ? 'needs_you' : (status?.state ?? 'queued');
          return (
            <ActivityListRow
              key={task.taskId}
              icon={`status-${state === 'needs_you' ? 'needs-you' : state}` as IconConcept}
              tone={state === 'running' ? 'run' : state === 'succeeded' ? 'ok' : state === 'needs_you' ? 'warn' : state === 'failed' ? 'err' : 'muted'}
              spin={state === 'running'}
              name={task.taskName}
              detail={task.model ? modelLabel(task.model) : undefined}
              end={asking ? 'needs you' : (status?.label ?? task.status).toLowerCase()}
              endTone={asking || state === 'failed'}
            />
          );
        })}
      </ActivityPopoverSection>
    );
  } else if (isRun && run.data) {
    const stages = run.data.stageRuns
      .filter((s) => !s.scopeId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (stages.length > 0) {
      sections = (
        <ActivityPopoverSection title="Stages" count={stages.length} data-testid="activity-popover-stages">
          {stages.slice(0, 10).map((stage) => {
            const g = stageGlyph(stage);
            return <ActivityListRow key={stage.id} icon={g.icon} tone={g.tone} spin={g.spin} name={stage.name} end={g.word} endTone={g.state === 'failed' || g.state === 'needs_you'} />;
          })}
          {stages.length > 10 ? <span className="text-micro text-fg-3">+{stages.length - 10} more</span> : null}
        </ActivityPopoverSection>
      );
    }
  }

  // ── Footer ──
  const stoppable = entry.live?.stoppable ?? entry.stoppable;
  const footerEnd =
    entry.group === 'failed' && entry.dismissKey ? (
      <Button size="sm" variant="ghost" onClick={() => { dismiss(entry.dismissKey!); onDone(); }}>
        Dismiss
      </Button>
    ) : stoppable && entry.live ? (
      <Button
        size="sm"
        variant="danger-ghost"
        icon="stop"
        loading={act.isPending && act.variables?.action === 'stop'}
        disabled={busy}
        aria-label={`${stopLabel(entry)} — ${entry.title}`}
        onClick={() => act.mutate({ item: entry.live!, action: 'stop' }, { onSuccess: onDone })}
      >
        {stopLabel(entry)}
      </Button>
    ) : null;

  return (
    <ActivityPopoverBody
      data-testid="activity-popover"
      titleId={titleId}
      kindIcon={kindIcon(entry)}
      kindLabel={kindLabel(entry)}
      context={entry.project?.name}
      title={entry.title}
      status={<StatusBadge state={entry.state} context={isChat ? 'chat' : 'run'} label={entry.outcome === 'cancelled' ? 'Stopped' : undefined} />}
      band={band}
      details={details}
      sections={sections}
      footerStart={
        <Button size="sm" shortcut={['↵']} onClick={open}>
          {entry.group === 'needs_you' && !answers.approve ? openLabel(entry) : entry.kind === 'workflow' ? 'Open run' : 'Open'}
        </Button>
      }
      footerEnd={footerEnd}
    />
  );
}
