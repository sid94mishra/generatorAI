// ────────────────────────────────────────────────────────────────
// B-17 StepRow / StepRail — a run of steps on the kit StepRail (28h rows, 1px
// rail at x = 9): status glyph · verb · mono target · coloured result ·
// duration · trailing actions.
//
// Normal mode folds runs of related steps into one group row ("Read 3 files",
// `MIN_GROUP` 2, `groupSteps`) and two or more delegations into a
// DelegationGroup (B-22); Verbose mode (G-06) shows every step ungrouped and
// expanded. A step's expand panel holds its diff (file ops), the raw tool I/O
// and its nested children (`parentCallId`); a failed call's error and a
// registered tool card (B-18) sit under the row, always visible.
//
// Memoised on step identity: `deriveTimeline` interns unchanged steps, so a
// streamed token (which only grows the answer) re-renders none of this.
// ────────────────────────────────────────────────────────────────

import { memo, useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  formatStepDuration,
  groupSteps,
  type StepGroup,
  type TimelineStep,
} from '@generatorai/client-core';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import { StepRail, type StepRailItem } from '@/ui/patterns/StepRail/StepRail.js';
import { Icon } from '@/ui/icons/Icon.js';
import { InlineError } from '../InlineError/InlineError.js';
import { DelegationGroup, delegationTasks } from '../DelegationGroup/DelegationGroup.js';
import { ToolCallCard } from '../ToolCallCard/ToolCallCard.js';
import { resolveToolCard } from '../ToolCallCard/toolCardRegistry.js';
import { browserArtifactUrl, useTranscriptActions, type TranscriptActions } from '../transcriptContext.js';
import { DiffSnippet } from './DiffSnippet.js';
import { StepGlyph, STEP_KIND_ICON } from './stepGlyph.js';

export interface StepListProps {
  steps: readonly TimelineStep[];
  /** `normal` groups related steps; `verbose` shows every step ungrouped and expanded. */
  mode?: 'normal' | 'verbose';
  /** The turn is streaming (registered cards receive it). */
  live?: boolean;
  /**
   * Fold related steps into group rows (default). A group's own children render with
   * `grouping={false}`: grouping them again would yield the same group inside itself, forever.
   */
  grouping?: boolean;
  /** Accessible name of the list. */
  label?: string;
  className?: string;
}

type Entry =
  | { type: 'step'; step: TimelineStep }
  | StepGroup
  | { type: 'delegation'; id: string; steps: TimelineStep[] };

/** Fold two or more consecutive delegations into one DelegationGroup entry. */
function foldDelegations(entries: Array<{ type: 'step'; step: TimelineStep } | StepGroup>): Entry[] {
  const out: Entry[] = [];
  let run: TimelineStep[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ type: 'delegation', id: `delegation-${run[0]!.id}`, steps: run });
    else for (const step of run) out.push({ type: 'step', step });
    run = [];
  };
  for (const entry of entries) {
    if (entry.type === 'step' && entry.step.kind === 'delegate') {
      run.push(entry.step);
      continue;
    }
    flush();
    out.push(entry);
  }
  flush();
  return out;
}

function targetNode(step: TimelineStep, target: string): ReactNode {
  if (!target) return undefined;
  // The rail draws targets mono; prose targets (task names, thinking) read as prose.
  return step.mono === false ? <span className="font-sans text-ui text-fg-2">{target}</span> : target;
}

function resultOf(step: TimelineStep): Pick<StepRailItem, 'result' | 'resultTone'> {
  if (step.status === 'waiting') return { result: TRANSCRIPT_COPY.waitingForYou, resultTone: 'warn' };
  if (step.status === 'failed' && step.kind !== 'error' && step.kind !== 'warning') {
    return { result: TRANSCRIPT_COPY.failed, resultTone: 'err' };
  }
  if (step.fileOp) return { result: <DiffStat added={step.fileOp.additions} removed={step.fileOp.deletions} /> };
  if (step.meta) return { result: step.meta, resultTone: 'muted' };
  return {};
}

/** Expand panel of a step: diff first, raw tool I/O one click away, nested children. */
function StepDetail({ step, mode, live }: { step: TimelineStep; mode: 'normal' | 'verbose'; live: boolean }) {
  const actions = useTranscriptActions();
  const rawId = useId();
  const [showRaw, setShowRaw] = useState(mode === 'verbose');
  // Once shown, the raw text stays built, so it can ease closed instead of vanishing.
  const [rawSeen, setRawSeen] = useState(showRaw);
  const diffOf = step.diff;
  const diff = useMemo(() => (diffOf ? diffOf() : null), [diffOf]);
  const wantRaw = !!step.detail && (!diff || rawSeen);
  const detailText = useMemo(() => {
    if (!wantRaw || !step.detail) return null;
    return typeof step.detail === 'function' ? step.detail() : step.detail;
  }, [wantRaw, step.detail]);
  const filePath = step.fileOp?.filePath;
  return (
    <div
      data-testid="step-detail-panel"
      className={cn('flex min-w-0 flex-col gap-1.5 overflow-auto', step.workerChatId ? 'max-h-90' : 'max-h-65')}
    >
      {diff ? (
        <DiffSnippet
          hunks={diff.hunks}
          truncated={diff.truncated}
          truncatedAction={
            filePath && actions.onOpenChanges ? (
              <Button size="sm" variant="ghost" onClick={() => actions.onOpenChanges?.(filePath)}>
                {TRANSCRIPT_COPY.openFullDiff}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {diff && step.detail ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          aria-expanded={showRaw}
          aria-controls={rawId}
          onClick={() => {
            setRawSeen(true);
            setShowRaw((v) => !v);
          }}
        >
          {showRaw ? TRANSCRIPT_COPY.hideRawToolCall : TRANSCRIPT_COPY.showRawToolCall}
        </Button>
      ) : null}
      {detailText && diff ? (
        <Reveal id={rawId} open={showRaw} gap={1.5}>
          <CodeBlock wrap>{detailText}</CodeBlock>
        </Reveal>
      ) : detailText ? (
        <CodeBlock wrap>{detailText}</CodeBlock>
      ) : null}
      {step.children && step.children.length > 0 ? (
        <StepList steps={step.children} mode={mode} live={live} />
      ) : null}
    </div>
  );
}

function stepActions(step: TimelineStep, actions: TranscriptActions, openIn: string | undefined): ReactNode {
  const out: ReactNode[] = [];
  const filePath = step.fileOp?.filePath;
  if (step.workerChatId) {
    out.push(
      <Link
        key="worker"
        variant="muted"
        className="inline-flex items-center gap-1 text-small"
        aria-label={TRANSCRIPT_COPY.openWorkerChat}
        data-testid="step-worker-chat-link"
        render={<RouterLink to={`/chats/${step.workerChatId}`} />}
      >
        <Icon concept="external-link" size={12} />
        {TRANSCRIPT_COPY.openWorkerChat}
      </Link>,
    );
  }
  if (step.image && actions.workspaceId) {
    const url = browserArtifactUrl(actions.workspaceId, step.image.relativePath);
    out.push(
      <Link
        key="image"
        variant="muted"
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={TRANSCRIPT_COPY.openScreenshot(step.image.label)}
        data-testid="step-image-link"
        className="inline-flex items-center"
      >
        <Icon concept="image" size={14} />
      </Link>,
    );
  }
  if (filePath && actions.onOpenChanges) {
    out.push(
      <IconButton
        key="changes"
        size="sm"
        icon="diff"
        label={TRANSCRIPT_COPY.showInChanges(filePath)}
        onClick={() => actions.onOpenChanges?.(filePath)}
      />,
    );
  }
  if (step.isShell && step.callId && actions.onOpenShell) {
    const callId = step.callId;
    out.push(
      <IconButton
        key="shell"
        size="sm"
        icon="terminal"
        label={TRANSCRIPT_COPY.openInTerminal}
        onClick={() => actions.onOpenShell?.(callId)}
      />,
    );
  }
  if (openIn === 'browser' && actions.onOpenBrowser) {
    out.push(
      <IconButton key="browser" size="sm" icon="browser" label="Open the browser tab" onClick={() => actions.onOpenBrowser?.()} />,
    );
  }
  return out.length > 0 ? out : undefined;
}

function stepItem(step: TimelineStep, mode: 'normal' | 'verbose', live: boolean, actions: TranscriptActions): StepRailItem {
  const entry = resolveToolCard(step.tool);
  const verb = entry?.verb?.(step) ?? step.verb;
  const target = entry?.target?.(step) ?? step.target;
  const custom = entry?.result?.(step);
  const expandable = !!(step.children?.length || step.detail || step.diff);
  const below: ReactNode[] = [];
  if (step.errorText) below.push(<InlineError key="err" message={step.errorText} />);
  if (entry?.Card) below.push(<ToolCallCard key="card" step={step} entry={entry} live={live} />);
  const glyph =
    step.status === 'pending' && entry?.icon ? (
      <Icon concept={entry.icon} size={14} className="text-fg-3" />
    ) : (
      <StepGlyph status={step.status} kind={step.kind} />
    );
  const actionNodes = stepActions(step, actions, entry?.openIn);
  const time = formatStepDuration(step.durationMs);
  return {
    id: step.id,
    glyph,
    verb,
    ...(target ? { target: targetNode(step, target) } : {}),
    ...(custom != null ? { result: custom } : resultOf(step)),
    ...(time ? { time } : {}),
    expandable,
    ...(expandable ? { detail: <StepDetail step={step} mode={mode} live={live} /> } : {}),
    ...(actionNodes ? { actions: actionNodes } : {}),
    ...(below.length > 0 ? { below } : {}),
    busy: step.status === 'running',
    testId: 'step-row',
  };
}

function groupItem(group: StepGroup, live: boolean): StepRailItem {
  const running = group.status === 'running';
  const last = group.steps[group.steps.length - 1]!;
  const subline = running ? last.target : group.summary;
  const time = formatStepDuration(group.durationMs);
  return {
    id: group.id,
    glyph: <StepGlyph status={group.status} kind={group.kind} />,
    verb: group.label,
    ...(subline ? { target: subline } : {}),
    result: (
      <span className="inline-flex items-center gap-2">
        {group.failed > 0 ? <span className="text-err">{group.failed} failed</span> : null}
        {group.fileOps ? <DiffStat added={group.fileOps.additions} removed={group.fileOps.deletions} /> : null}
        <span className="inline-flex items-center gap-1 font-mono text-micro text-fg-3" data-testid="step-group-count">
          <Icon concept={STEP_KIND_ICON[group.kind]} size={12} />
          {group.steps.length}
        </span>
      </span>
    ),
    ...(time ? { time } : {}),
    expandable: true,
    detail: (
      <div data-testid="step-group-children">
        <StepList steps={group.steps} live={live} grouping={false} />
      </div>
    ),
    busy: running,
    testId: 'step-group',
    toggleTestId: 'step-group-row',
  };
}

function sameSteps(a: readonly TimelineStep[], b: readonly TimelineStep[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function StepListImpl({ steps, mode = 'normal', live = false, grouping = true, label = 'Steps', className }: StepListProps) {
  const actions = useTranscriptActions();
  // Verbose (G-06) opens every step — including ones that arrive while the turn
  // streams and every step already on screen when the mode is switched — so the
  // rails are controlled: open unless the reader closed that one.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const onVerboseToggle = useCallback((id: string, open: boolean) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const entries = useMemo<Entry[]>(() => {
    if (mode === 'verbose' || !grouping) return steps.map((step) => ({ type: 'step' as const, step }));
    return foldDelegations(groupSteps(steps));
  }, [steps, mode, grouping]);

  // One rail per contiguous run; a DelegationGroup breaks the rail (it draws its own sub-rows).
  const blocks: ReactNode[] = [];
  let items: StepRailItem[] = [];
  const flush = (key: string) => {
    if (items.length === 0) return;
    const run = items;
    items = [];
    blocks.push(
      <StepRail
        // Keyed by mode: a rail's own (Normal) open rows do not leak into the other mode.
        key={`${key}-${mode}`}
        label={label}
        items={run}
        {...(mode === 'verbose'
          ? {
              expandedIds: run.filter((i) => i.expandable && !closed.has(i.id)).map((i) => i.id),
              onExpandedChange: onVerboseToggle,
            }
          : {})}
      />,
    );
  };
  for (const entry of entries) {
    if (entry.type === 'delegation') {
      flush(`rail-${entry.id}`);
      blocks.push(
        <DelegationGroup
          key={entry.id}
          tasks={delegationTasks(entry.steps)}
          {...(actions.onOpenTasks ? { onOpenInDock: actions.onOpenTasks } : {})}
        />,
      );
      continue;
    }
    items.push(entry.type === 'group' ? groupItem(entry, live) : stepItem(entry.step, mode, live, actions));
  }
  flush('rail-end');
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)} data-gai-block="steps">
      {blocks}
    </div>
  );
}

/** A run of steps; re-renders only when a step (by identity), the mode or liveness changes. */
export const StepList = memo(
  StepListImpl,
  (a, b) => sameSteps(a.steps, b.steps) && a.mode === b.mode && a.live === b.live && a.label === b.label && a.className === b.className,
);
