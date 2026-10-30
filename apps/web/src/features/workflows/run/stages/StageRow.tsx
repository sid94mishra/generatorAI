// ────────────────────────────────────────────────────────────────
// WF-04 StageTableRow — one stage of the run's stage table (board
// WorkflowRun): chevron · D-18 glyph · name · key · status word · attempt ·
// time · "…" menu. Expanded, the row is a compact chat (P03b): the stage
// prompt, the stage transcript (blocks/transcript TurnBody, its in-turn gates
// answered through the stage conversation API), the output chips, the WF-09
// review card when the stage parked on its completion review. The focused
// stage's composer is pinned under the run's stages (WorkflowRunPage), like the
// chat composer, so the growing output never pushes it along.
//
// Every row of the page renders through here (top-level stages, a loop's
// own row, loop/map body instances), so focus, gates, the menu and the
// inspector behave the same at any depth (model/renderStage.ts).
// ────────────────────────────────────────────────────────────────

import { memo, useEffect, useState, type ReactNode } from 'react';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';
import { resolveMapping, resolveStatus, stageSkipReasonLabel, STATUS_STATE_DEFS } from '@generatorai/shared';
import type { RunCommand } from '@generatorai/workflow-spec';
import type { IconConcept } from '@generatorai/design-tokens';
import { LiveTurn, TranscriptProvider, TurnBody, UsageChip, UserMessage } from '@/blocks/transcript/index.js';
import { ContextGauge } from '@/blocks/composer/parts/ContextGauge.js';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { STATUS_TONE_TEXT } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import type { StreamSegment } from '@generatorai/client-core';
import { CommandRun } from './CommandRun.js';
import { stageComposerClosedReason } from './StageComposer.js';
import { StageTranscript } from './StageTranscript.js';
import { useStageAgent } from './useStageAgent.js';
import { MenuButton, type MenuButtonItem } from '@/ui/patterns/MenuButton/MenuButton.js';
import { formatStageDuration } from '../model/format.js';
import { stageNeedsPerson } from '../model/deriveRunView.js';
import type { StageView } from '../model/types.js';
import { ReviewCard } from './ReviewCard.js';
import { formatWhen } from '@/lib/formatWhen.js';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';

/** An answer to one of a stage's in-turn gates, in the chat's shapes (the stage conversation API). */
export type StageGateResolution =
  | {
      kind: 'permission';
      interactionId: string;
      behavior: 'allow' | 'deny';
      message?: string;
      remember?: 'owner' | 'project';
    }
  | { kind: 'answer'; interactionId: string; answers: Record<string, string[]>; freeformResponse?: string }
  | {
      kind: 'plan';
      interactionId: string;
      approved: boolean;
      action?: 'implement_interactive' | 'implement_autopilot';
      feedback?: string;
    };

/**
 * The stage "…" menu (D-18). Every command goes through the commands API;
 * the page supplies stable callbacks so the memoised row does not re-render.
 */
export interface StageMenuActions {
  /** Whether the run still takes instance commands (not terminal). */
  runLive: boolean;
  onCommand: (id: string, command: RunCommand) => void;
  onCopyOutput: (id: string) => void;
  /** Fork the finished run from this instance (enabled once the run is terminal). */
  onRerunFrom: (id: string) => void;
}

export interface StageRowProps {
  stage: StageView;
  focused: boolean;
  /** Nesting depth (body rows of a loop or map indent under it). */
  depth?: number;
  /** Collapse the row by itself when it completes (off once the run finished). */
  autoCollapse?: boolean;
  /** Open the row once the run is over (the last stage holds the result). */
  openWhenFinished?: boolean;
  /** False for the last row of a list (no rule under it). */
  showConnector?: boolean;
  onFocus?: (id: string) => void;
  onApproveHitl?: (id: string) => void;
  onRejectHitl?: (id: string, feedback?: string) => void;
  /** Terminal rejection — fails the stage and blocks the rest of the run. */
  onTerminalRejectHitl?: (id: string, reason?: string) => void;
  /** Answer an in-turn gate (tool permission, question, plan review) through the stage conversation API. */
  onResolveGate?: (id: string, resolution: StageGateResolution) => void;
  /** A gate answer or approval of this stage is in flight (D-13). */
  gateBusy?: boolean;
  /** The run is in a project: permission cards also offer "Allow … for this project". */
  inProject?: boolean;
  menu?: StageMenuActions;
  onRetry?: (id: string) => void;
  /** Open the dock's Inspector on this stage. */
  onOpenInspector?: (id: string) => void;
  /** What approving the review starts (successor names). */
  approveStarts?: string | undefined;
  headerExtra?: ReactNode;
  body?: ReactNode;
  preamble?: ReactNode;
  hidePrompt?: boolean;
  /** The stage's composer (an agent stage only, D-175): opened inside the row by "Follow up". */
  renderComposer?: (stage: StageView, agentName: string) => ReactNode;
}

/**
 * The turn in flight of a stage conversation: what came after the person's last message. The history
 * already shows that message and every turn before it; drawing the whole stream too showed the
 * prompt twice and, on a provider that never resets the stream between turns, the last reply again.
 * Null when the person has not written in this stage (the whole stream is the turn).
 */
export function liveTurnSegments(segments: readonly StreamSegment[]): StreamSegment[] | null {
  for (let i = segments.length - 1; i >= 0; i -= 1) if (segments[i]!.type === 'operator') return segments.slice(i + 1);
  return null;
}

/** The interaction a plan card answers: the plan block's own. */
function planInteraction(stage: StageView, planId: string): string | undefined {
  for (const seg of stage.segments) {
    if (seg.type === 'plan' && seg.plan.planId === planId && seg.plan.interactionId) return seg.plan.interactionId;
  }
  return undefined;
}

const DEPTH_PAD = ['pl-2', 'pl-8', 'pl-14', 'pl-20', 'pl-26'] as const;
const BODY_PAD = ['pl-13', 'pl-19', 'pl-25', 'pl-31', 'pl-37'] as const;

const STAGE_PROMPT_LABEL = { text: 'Stage prompt', icon: 'user' } as const;

const SHARED_CONTEXT_NOTE =
  'This run shares one conversation across stages, so this is the run’s context window — not this stage alone.';

/** The "…" items of one stage: what the instance's engine state accepts. */
function stageMenuItems(
  stage: StageView,
  menu: StageMenuActions,
  onOpenInspector?: (id: string) => void,
): MenuButtonItem[] {
  const raw = stage.rawStatus;
  const live = menu.runLive;
  const inAttempt = raw === 'starting' || raw === 'running' || raw === 'validating';
  const canPause = live && (raw === 'ready' || raw === 'retry_wait' || inAttempt);
  const paused = live && raw === 'paused';
  const canSkip = live && (raw === 'paused' || raw === 'ready');
  const terminal = raw === 'completed' || raw === 'failed' || raw === 'skipped' || raw === 'cancelled';
  const canCancel = live && !terminal;
  const hasOutput = !!stage.outputText || !!stage.outputData;
  const cmd = (command: RunCommand) => () => menu.onCommand(stage.id, command);
  const items: MenuButtonItem[] = [
    {
      id: 'pause',
      label: 'Pause stage',
      icon: 'pause',
      disabled: !canPause,
      onSelect: cmd({ command: 'pause', instanceId: stage.id, mode: 'interrupt' }),
    },
    {
      id: 'resume',
      label: 'Resume',
      icon: 'play',
      disabled: !paused,
      onSelect: cmd({ command: 'resume', instanceId: stage.id }),
    },
    {
      id: 'retry-resume',
      label: 'Retry (continue the conversation)',
      icon: 'retry',
      disabled: !paused,
      onSelect: cmd({ command: 'retry', instanceId: stage.id, mode: 'resume' }),
    },
    {
      id: 'retry-restart',
      label: 'Retry (restart the stage)',
      icon: 'restart',
      disabled: !paused,
      onSelect: cmd({ command: 'retry', instanceId: stage.id, mode: 'restart' }),
    },
    {
      id: 'skip',
      label: 'Skip as completed',
      icon: 'forward',
      disabled: !canSkip,
      onSelect: cmd({ command: 'skip', instanceId: stage.id, as: 'completed' }),
    },
    {
      id: 'cancel',
      label: 'Cancel stage…',
      icon: 'x',
      danger: true,
      disabled: !canCancel,
      onSelect: cmd({ command: 'cancel', instanceId: stage.id }),
    },
    { type: 'separator', id: 'sep' },
    {
      id: 'copy',
      label: 'Copy output',
      icon: 'copy',
      disabled: !hasOutput,
      onSelect: () => menu.onCopyOutput(stage.id),
    },
  ];
  if (onOpenInspector)
    items.push({ id: 'inspect', label: 'Open in inspector', icon: 'dock', onSelect: () => onOpenInspector(stage.id) });
  items.push({
    id: 'rerun',
    label: live ? 'Re-run from here (once the run has finished)' : 'Re-run from here',
    icon: 'branch',
    disabled: live,
    onSelect: () => menu.onRerunFrom(stage.id),
  });
  return items;
}

/** "Command failed · exit 1" / "Command timed out" for a completed command stage whose output says it did not pass. */
export function checkFailureWord(output: Record<string, unknown> | undefined): string | null {
  if (!output || output['passed'] !== false) return null;
  if (output['timedOut'] === true) return 'Command timed out';
  return typeof output['exitCode'] === 'number' ? `Command failed · exit ${output['exitCode']}` : 'Command failed';
}

/**
 * The reply drawn above a review card holds the output under review. The streamed reply joins every turn of the
 * stage (a revision follows the first answer), so it contains the output rather than equalling it.
 */
function replyHolds(reply: string, output: string | undefined): boolean {
  const flat = (t: string) => t.replace(/\s+/g, ' ').trim();
  const out = output ? flat(output) : '';
  return out.length > 0 && flat(reply).includes(out);
}

export const StageRow = memo(function StageRow({
  stage,
  focused,
  depth = 0,
  autoCollapse = true,
  openWhenFinished = false,
  showConnector = true,
  onFocus,
  onApproveHitl,
  onRejectHitl,
  onTerminalRejectHitl,
  onResolveGate,
  gateBusy = false,
  inProject = false,
  menu,
  onRetry,
  onOpenInspector,
  approveStarts,
  headerExtra,
  body,
  preamble,
  hidePrompt,
  renderComposer,
}: StageRowProps) {
  const needsPerson = stageNeedsPerson(stage);
  const isActive = stage.status === 'running' || needsPerson || stage.streaming === true;
  const isTerminal =
    stage.status === 'completed' ||
    stage.status === 'failed' ||
    stage.status === 'cancelled' ||
    stage.status === 'skipped';
  const isAwaiting = stage.status === 'awaiting_input';
  const isFailed = stage.status === 'failed';
  const isSkippedOrCancelled = stage.status === 'skipped' || stage.status === 'cancelled';

  // Streaming / awaiting / failed rows open; pending and completed rows stay closed.
  const [open, setOpen] = useState(isActive || isFailed);
  const [userToggled, setUserToggled] = useState(false);
  // Only an agent stage is a conversation (a command has no agent to answer); its composer opens on demand (D-175).
  const conversable = !!renderComposer && stage.kind === 'agent' && stageComposerClosedReason(stage) === null;
  const [composerOpen, setComposerOpen] = useState(false);
  const openComposer = () => {
    onFocus?.(stage.id);
    setUserToggled(true);
    setOpen(true);
    setComposerOpen(true);
  };

  // Open the moment a row becomes active; close it when it completes (room for
  // the next stage) — unless the user toggled it. When the run is over the
  // last row re-opens: it holds the result the user came for.
  useEffect(() => {
    if (userToggled) return;
    if (isActive) setOpen(true);
    else if (stage.status === 'completed' && autoCollapse) setOpen(false);
    else if (openWhenFinished && !autoCollapse) setOpen(true);
  }, [isActive, stage.status, userToggled, autoCollapse, openWhenFinished]);

  const toggle = () => {
    onFocus?.(stage.id);
    setUserToggled(true);
    setOpen((o) => !o);
  };

  // An open approval wait reads like a review: the person has the ball, not the clock.
  const status =
    (needsPerson && stage.status === 'waiting' ? resolveStatus('stageRun', 'awaiting_input') : resolveStatus('stageRun', stage.rawStatus)) ??
    resolveMapping({ state: 'queued' }, 'stageRun');
  // U-18: a check that ran to the end but did not pass completes (it never fails the run on its own),
  // yet it must not read "Succeeded".
  const checkFailure =
    stage.kind === 'check' && stage.status === 'completed' ? checkFailureWord(stage.outputData) : null;
  const def = STATUS_STATE_DEFS[checkFailure ? 'failed' : status.state];
  const word = stage.admission
    ? `Waiting for ${stage.admission.label} (${stage.admission.limit !== null ? `${stage.admission.running}/${stage.admission.limit}` : `${stage.admission.running} running`})`
    : (checkFailure ?? status.label);
  const dur = formatStageDuration(stage.durationMs);
  const fileCount = stage.files?.length ?? 0;
  const parallel = stage.parallelWith?.length ?? 0;
  const d = Math.min(depth, DEPTH_PAD.length - 1);

  const gauge =
    stage.contextUsage || stage.usage ? (
      <span {...(stage.sharedContext ? { title: SHARED_CONTEXT_NOTE } : {})}>
        <ContextGauge snapshot={stage.contextUsage ?? null} usage={stage.usage ?? null} showLabel={false} />
      </span>
    ) : null;

  const agent = useStageAgent(stage);
  const liveTurn = liveTurnSegments(stage.segments);
  const turnProps = {
    segments: stage.segments,
    steps: stage.steps,
    answer: stage.answer,
    streamKey: `stageRun:${stage.id}`,
    active: stage.status === 'running' || stage.streaming === true,
    answerStreaming: isActive && !isAwaiting,
    error: isFailed ? stage.error : undefined,
  };
  // An agent stage streams through the same live panel as a chat turn (D-172): agent header, body, thinking
  // placeholder; the stage row's header, result, output chips and review card are the workflow's own parts around
  // it. A check (a command) is no agent: no avatar and no "is thinking" — its command and output as it prints (D-173).
  const turnBody =
    stage.kind === 'check' ? (
      <>
        <CommandRun
          stage={stage}
          running={stage.status === 'running'}
          error={turnProps.error}
          onOpenOutput={onOpenInspector ? () => onOpenInspector(stage.id) : undefined}
        />
      </>
    ) : stage.kind !== undefined && stage.kind !== 'agent' ? (
      <TurnBody {...turnProps} loading={isActive && !isAwaiting && stage.steps.length === 0 && !stage.answer} />
    ) : (
      <LiveTurn
        {...turnProps}
        {...(liveTurn ? { segments: liveTurn, steps: undefined, answer: undefined } : {})}
        agentName={agent.name}
        avatarProvider={agent.harnessProvider}
        thinking={isActive && !isAwaiting}
        thinkingLabel={TRANSCRIPT_COPY.agentThinking(agent.name)}
      />
    );

  return (
    <div data-stage-id={stage.id} data-testid="stage-row" className={cn(showConnector && 'border-b border-line-soft')}>
      {/* Only the header marks focus: tinting the open transcript too sank its cards into the background. */}
      <div
        className={cn(
          'group flex h-row min-w-0 items-center gap-1 pr-2',
          DEPTH_PAD[d],
          focused ? 'bg-sunken' : 'hover:bg-hover',
        )}
      >
        <Button
          variant="ghost"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${stage.name}, ${word}`}
          className="h-full min-w-0 flex-1 justify-start border-0 bg-transparent px-1 text-left font-normal text-fg hover:not-disabled:bg-transparent"
        >
          <span className="inline-flex max-w-full min-w-0 items-center gap-2 align-middle">
            <Icon concept={open ? 'chevron-down' : 'chevron-right'} size={14} className="shrink-0 text-fg-3" />
            <Icon
              concept={def.glyph as IconConcept}
              size={16}
              className={cn('shrink-0', STATUS_TONE_TEXT[def.tone], def.spin && 'animate-spin reduced:animate-none')}
            />
            <span
              className={cn(
                'min-w-0 truncate text-ui',
                needsPerson ? 'font-semibold text-fg' : isSkippedOrCancelled ? 'text-fg-3' : 'font-medium text-fg',
              )}
            >
              {stage.name}
            </span>
            <span
              className={cn('shrink-0 text-small', STATUS_TONE_TEXT[def.tone])}
              {...(stage.admission
                ? {
                    title: `${stage.admission.queued} launch${stage.admission.queued === 1 ? '' : 'es'} queued on ${stage.admission.flowKey}`,
                  }
                : {})}
            >
              {word}
            </span>
          </span>
        </Button>
        {/* Variable badges sit before the fixed Key and Time columns, so those line up down the table. */}
        {stage.attempt && stage.attempt > 1 ? (
          <span className="hidden shrink-0 text-small text-fg-3 md:inline">attempt {stage.attempt}</span>
        ) : null}
        {headerExtra}
        {parallel > 0 ? (
          <Badge tone="run" icon="zap" className="hidden md:inline-flex">
            parallel({parallel + 1})
          </Badge>
        ) : null}
        <span className="flex shrink-0 items-center gap-2 text-micro text-fg-3">
          {isActive && stage.stepsTotal > 0 ? (
            <span className="font-mono text-run tabular-nums">
              {stage.stepsDone}/{stage.stepsTotal}
            </span>
          ) : null}
          {fileCount > 0 ? (
            <span
              className="hidden items-center gap-1 md:inline-flex"
              title={`${fileCount} changed file${fileCount === 1 ? '' : 's'}`}
            >
              <Icon concept="file" size={12} />
              {fileCount}
            </span>
          ) : null}
          {isActive ? gauge : null}
          {stage.amendedAt ? (
            <Badge
              tone="run"
              icon="edit"
              title={`Output amended ${formatWhen(stage.amendedAt)}. Later stages kept the output they already used; re-run from here to update them.`}
            >
              Amended
            </Badge>
          ) : null}
        </span>
        <span className="hidden w-32 shrink-0 truncate font-mono text-micro text-fg-3 md:inline" title={stage.stageKey}>
          {stage.stageKey}
        </span>
        <span className="w-16 shrink-0 text-right font-mono text-micro text-fg-2 tabular-nums">{dur ?? '—'}</span>
        {isFailed && onRetry ? (
          <IconButton icon="retry" label="Re-run from this stage" size="sm" onClick={() => onRetry(stage.id)} />
        ) : null}
        {conversable ? (
          <IconButton icon="message" label={`Follow up with ${stage.name}`} size="sm" onClick={openComposer} />
        ) : null}
        {menu ? (
          <MenuButton
            label={`Actions for ${stage.name}`}
            icon="more"
            iconOnly
            size="sm"
            align="end"
            items={stageMenuItems(stage, menu, onOpenInspector)}
          />
        ) : null}
      </div>

      <Reveal open={open && !isSkippedOrCancelled}>
        <div className={cn('flex flex-col gap-2.5 pt-1 pr-4 pb-3', BODY_PAD[d])}>
          {body}

          {!body ? (
            <TranscriptProvider
              value={{
                gateBusy,
                ...(onResolveGate
                  ? {
                      // U-16: "Allow for this run" remembers the gate's rules for every stage of the run.
                      permissionScope: 'run' as const,
                      permissionProjectScope: inProject,
                      onAnswerPermission: (
                        interactionId: string,
                        behavior: 'allow' | 'deny',
                        message?: string,
                        options?: { remember?: 'owner' | 'project' },
                      ) =>
                        onResolveGate(stage.id, {
                          kind: 'permission',
                          interactionId,
                          behavior,
                          ...(message ? { message } : {}),
                          ...(options?.remember ? { remember: options.remember } : {}),
                        }),
                      onAnswerQuestion: (
                        interactionId: string,
                        answers: Record<string, string[]>,
                        freeformResponse?: string,
                      ) =>
                        onResolveGate(stage.id, {
                          kind: 'answer',
                          interactionId,
                          answers,
                          ...(freeformResponse ? { freeformResponse } : {}),
                        }),
                      onApprovePlan: (planId: string, action: 'implement_interactive' | 'implement_autopilot') => {
                        const interactionId = planInteraction(stage, planId);
                        if (interactionId)
                          onResolveGate(stage.id, { kind: 'plan', interactionId, approved: true, action });
                      },
                      onRequestPlanChanges: (planId: string, feedback: string) => {
                        const interactionId = planInteraction(stage, planId);
                        if (interactionId)
                          onResolveGate(stage.id, { kind: 'plan', interactionId, approved: false, feedback });
                      },
                    }
                  : {}),
              }}
            >
              <StageTranscript
                stage={stage}
                agent={agent}
                live={stage.status === 'running' || stage.streaming === true || (isAwaiting && !stage.interrupt)}
                liveBody={turnBody}
                fallback={
                  <>
                    {!hidePrompt && stage.prompt ? (
                      <UserMessage content={stage.prompt} label={STAGE_PROMPT_LABEL} />
                    ) : null}
                    {preamble}
                    {turnBody}
                  </>
                }
              />
            </TranscriptProvider>
          ) : null}

          {stage.result ? (
            <section
              aria-label={`${stage.name} result`}
              className="rounded-card border border-line-soft bg-sunken px-3 py-2"
              data-testid="stage-result"
            >
              <div className="mb-1 text-micro font-medium text-fg-3">Result</div>
              <Markdown>{stage.result}</Markdown>
            </section>
          ) : null}

          {isTerminal && (fileCount > 0 || stage.outputData || stage.usage || stage.contextUsage || onOpenInspector) ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {fileCount > 0 && onOpenInspector ? (
                <Button size="sm" icon="file" onClick={() => onOpenInspector(stage.id)}>
                  {fileCount} file{fileCount === 1 ? '' : 's'}
                </Button>
              ) : null}
              {stage.outputData && onOpenInspector ? (
                <Button size="sm" icon="database" onClick={() => onOpenInspector(stage.id)}>
                  Structured output
                </Button>
              ) : null}
              {onOpenInspector ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="dock"
                  onClick={() => onOpenInspector(stage.id)}
                  title="Open the inspector for this stage"
                >
                  Details
                </Button>
              ) : null}
              {stage.usage ? <UsageChip usage={stage.usage} scopeId={`stageRun:${stage.id}`} /> : null}
              {stage.contextUsage ? (
                <span {...(stage.sharedContext ? { title: SHARED_CONTEXT_NOTE } : {})}>
                  <ContextGauge snapshot={stage.contextUsage} usage={stage.usage ?? null} />
                </span>
              ) : null}
            </div>
          ) : null}

          {!body && isAwaiting && stage.interrupt ? (
            <ReviewCard
              stageName={stage.name}
              reason={stage.interrupt.reason}
              tool={stage.interrupt.tool}
              args={stage.interrupt.args}
              output={stage.interrupt.output}
              outputShownAbove={replyHolds(stage.answer, stage.interrupt.output)}
              afterRun={stage.interrupt.afterRun}
              approveStarts={approveStarts}
              busy={gateBusy}
              onApprove={() => onApproveHitl?.(stage.id)}
              onRequestChanges={(feedback) => onRejectHitl?.(stage.id, feedback)}
              {...(onTerminalRejectHitl
                ? { onReject: (reason?: string) => onTerminalRejectHitl(stage.id, reason) }
                : {})}
            />
          ) : null}

          {conversable && renderComposer ? (
            composerOpen ? (
              <div className="flex flex-col gap-1" data-testid="stage-followup">
                {renderComposer(stage, agent.name)}
                <div>
                  <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setComposerOpen(false)}>
                    Hide composer
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button size="sm" variant="ghost" icon="message" className="-ml-2" onClick={openComposer}>
                  Follow up
                </Button>
              </div>
            )
          ) : null}
        </div>
      </Reveal>

      {isSkippedOrCancelled ? (
        <p className={cn('pr-4 pb-2 text-small text-fg-3', BODY_PAD[d])}>
          {stage.status === 'skipped' ? (stage.error ?? stageSkipReasonLabel(stage.skipReason)) : 'Cancelled'}
        </p>
      ) : null}
    </div>
  );
});
