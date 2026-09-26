// ────────────────────────────────────────────────────────────────
// LoopTimelineItem — a loop instance (P05) on the run timeline.
//
//   ● Review loop  Running  ↻ 3/5  tests_pass 0/1 · same_blocker 1/2  …
//   │  [decision card — a parked loop only]
//   │  All · Iter 1 · Iter 2 · Iter 3• · Wrap-up
//   │  iteration details: outcome, score, workspace changed, exit
//   │  values with their streaks, carried values
//   │  ● fix (the body instances of the selected iteration)
//   │  ● test
//
// The row itself is a StageTimelineItem (the page's renderer, so the
// focus, the "…" menu and the inspector behave like any stage's) whose
// transcript is replaced by the iterations. Body instances render through
// the same renderer, with their iteration-input, operator, digest and
// wrap-up turns above their transcript. "All" is the continuing
// transcript: every iteration in order, with a divider between them.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { Repeat, Hand, Flag, ArrowDownToLine, MessageSquare, FileStack, Gift } from 'lucide-react';
import type { LoopIteration } from '@generatorai/shared';
import type { RunCommand } from '@generatorai/workflow-spec';
import { cn } from '@/lib/utils.js';
import { TabsRoot, TabsList, TabsTrigger } from '@/components/ui/index.js';
import { useLoopIterations } from '@/hooks/workflowQueries.js';
import { useStageChatHistory } from '@/hooks/queries.js';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import { LoopDecisionCard } from './LoopDecisionCard.js';
import { ControlFlowNode } from './ControlFlowNode.js';
import { loopBadge, loopExitText, loopRulesText } from './loopView.js';
import type { LoopView, StageView } from './types.js';

/** How the page renders one stage row (a loop's own row, or a body instance). */
export interface StageRenderOptions {
  showConnector: boolean;
  /** Open the row once the run is over (the last top-level stage). */
  openWhenFinished?: boolean;
  headerExtra?: React.ReactNode;
  body?: React.ReactNode;
  preamble?: React.ReactNode;
  hidePrompt?: boolean;
}
export type RenderStage = (stage: StageView, opts: StageRenderOptions) => React.ReactNode;

interface LoopTimelineItemProps {
  runId: string;
  stage: StageView;
  /** Every loop's body instances, by loop id (nested loops render recursively). */
  bodies: Record<string, StageView[]>;
  focusedId: string | null;
  showConnector: boolean;
  renderStage: RenderStage;
  /** A loop decision command; resolves once it settled (a refusal is toasted). */
  onCommand: (command: RunCommand) => Promise<void>;
}

type IterTab = number | 'all' | 'wrapup';

const CHIP = 'hidden shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium md:inline-flex';

/** The loop row's header badges: `n/max`, the rule streaks, "Needs decision", the exit. */
export function LoopHeaderBadges({ stage, loop }: { stage: StageView; loop: LoopView }) {
  const rules = loopRulesText(loop);
  const done = stage.status === 'completed' || stage.status === 'failed' || stage.status === 'cancelled';
  const exit = loopExitText(loop);
  return (
    <>
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--color-primary)]"
        title={`Iteration ${Math.max(0, loop.k + 1)} of ${loop.max}`}
      >
        <Repeat className="h-2.5 w-2.5" />
        {loopBadge(loop)}
      </span>
      {rules && !done && (
        <span className={cn(CHIP, 'max-w-[280px] truncate bg-[var(--color-muted-foreground)]/10 font-mono text-[var(--color-muted-foreground)]')} title={`Exit rules (streak / consecutive): ${rules}`}>
          {rules}
        </span>
      )}
      {loop.decision && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
          <Hand className="h-2.5 w-2.5" />
          Needs decision
        </span>
      )}
      {done && exit && (
        <span
          className={cn(
            CHIP,
            'max-w-[240px] truncate',
            stage.status === 'completed'
              ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
              : 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
          )}
          title={exit}
        >
          <Flag className="h-2.5 w-2.5" />
          {exit}
        </span>
      )}
    </>
  );
}

export function LoopTimelineItem({ runId, stage, bodies, focusedId, showConnector, renderStage, onCommand }: LoopTimelineItemProps) {
  const loop = stage.loop!;
  const body = bodies[stage.id] ?? [];

  const { byIteration, wrapUps, lastIndex } = useMemo(() => {
    const map = new Map<number, StageView[]>();
    const wraps: StageView[] = [];
    let max = -1;
    for (const s of body) {
      if (s.wrapUp) { wraps.push(s); continue; }
      const k = s.iterationIndex ?? 0;
      max = Math.max(max, k);
      const list = map.get(k) ?? [];
      list.push(s);
      map.set(k, list);
    }
    return { byIteration: map, wrapUps: wraps, lastIndex: max };
  }, [body]);

  const count = Math.max(lastIndex, loop.k) + 1;
  const iterations = useMemo(() => Array.from({ length: Math.max(0, count) }, (_, i) => i), [count]);
  const wrapUpLive = wrapUps.some((s) => s.status === 'running' || s.status === 'awaiting_input' || s.status === 'ready');
  const current: IterTab = wrapUpLive ? 'wrapup' : Math.max(0, loop.k);

  // Follow the running iteration until the user picks a tab.
  const [picked, setPicked] = useState<IterTab | null>(null);
  const tab: IterTab = picked ?? current;

  // Focus landing on one of this loop's body instances (the event timeline,
  // the store's auto-focus) opens its iteration so the row is on screen.
  const focusedTab = useMemo(() => {
    const hit = focusedId ? body.find((s) => s.id === focusedId) : undefined;
    return hit ? String(hit.wrapUp ? 'wrapup' : (hit.iterationIndex ?? 0)) : null;
  }, [focusedId, body]);
  useEffect(() => {
    if (focusedTab === null) return;
    setPicked(focusedTab === 'wrapup' ? 'wrapup' : Number(focusedTab));
  }, [focusedId, focusedTab]);

  const { data: rows } = useLoopIterations(runId, stage.id, { enabled: loop.k >= 0 });
  const rowByK = useMemo(() => new Map((rows ?? []).map((r) => [r.k, r])), [rows]);

  const renderInstances = (list: StageView[]) =>
    list.map((s, i) => (
      <ControlFlowNode
        key={s.id}
        runId={runId}
        stage={s}
        bodies={bodies}
        focusedId={focusedId}
        showConnector={i < list.length - 1}
        renderStage={renderStage}
        onCommand={onCommand}
        inContainer
      />
    ));

  const loopBody = (
    <div className="space-y-2.5">
      {loop.decision && (
        <LoopDecisionCard loopId={stage.id} loop={loop} decision={loop.decision} version={stage.version} onCommand={onCommand} />
      )}

      {loop.operatorInput && (
        <p className="text-[11px] text-[var(--color-muted-foreground)]">
          <MessageSquare className="mr-1 inline h-3 w-3" />
          Operator input queued for iteration {loop.operatorInput.forIteration + 1}.
        </p>
      )}

      {iterations.length === 0 && wrapUps.length === 0 ? (
        <p className="text-[11.5px] text-[var(--color-muted-foreground)]">The first iteration has not started yet.</p>
      ) : (
        <>
          <TabsRoot value={String(tab)} onValueChange={(v) => setPicked(v === 'all' || v === 'wrapup' ? v : Number(v))}>
            <TabsList className="overflow-x-auto" aria-label={`Iterations of ${stage.name}`}>
              {iterations.length > 1 && (
                <TabsTrigger value="all" className="px-2 py-1 text-[11.5px]" title="Every iteration in order: the continuing transcript">
                  All
                </TabsTrigger>
              )}
              {iterations.map((k) => (
                <TabsTrigger key={k} value={String(k)} className="px-2 py-1 text-[11.5px] tabular-nums">
                  Iter {k + 1}
                  {current === k && stage.status !== 'completed' && stage.status !== 'failed' && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] animate-status-breathe" aria-label="current" />
                  )}
                </TabsTrigger>
              ))}
              {wrapUps.length > 0 && (
                <TabsTrigger value="wrapup" className="px-2 py-1 text-[11.5px]">
                  Wrap-up
                </TabsTrigger>
              )}
            </TabsList>
          </TabsRoot>

          {tab === 'all' && iterations.map((k) => (
            <div key={k} className="space-y-2">
              <IterationDivider k={k} row={rowByK.get(k)} />
              {renderInstances(byIteration.get(k) ?? [])}
            </div>
          ))}
          {tab === 'all' && wrapUps.length > 0 && (
            <div className="space-y-2">
              <IterationDivider label="Wrap-up" />
              {renderInstances(wrapUps)}
            </div>
          )}

          {typeof tab === 'number' && (
            <div className="space-y-2">
              <IterationDetails k={tab} row={rowByK.get(tab)} loop={loop} running={tab === loop.k && !rowByK.has(tab)} />
              {(byIteration.get(tab) ?? []).length > 0
                ? renderInstances(byIteration.get(tab) ?? [])
                : <p className="text-[11.5px] text-[var(--color-muted-foreground)]">No stage of this iteration has started yet.</p>}
            </div>
          )}

          {tab === 'wrapup' && renderInstances(wrapUps)}
        </>
      )}
    </div>
  );

  return (
    <>
      {renderStage(stage, {
        showConnector,
        headerExtra: <LoopHeaderBadges stage={stage} loop={loop} />,
        body: loopBody,
      })}
    </>
  );
}

/** A plain body instance of a container (ControlFlowNode renders the containers and waits): its loop turns above its transcript. */
export function LoopBodyStage(props: { stage: StageView; showConnector: boolean; renderStage: RenderStage }) {
  return <LoopTurnsStage stage={props.stage} showConnector={props.showConnector} renderStage={props.renderStage} />;
}

/** Turn roles of a loop body's conversation that the transcript labels (P05). */
const TURN_LABELS: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  iteration_input: { label: 'Iteration input', Icon: ArrowDownToLine },
  operator: { label: 'Operator message', Icon: MessageSquare },
  digest: { label: 'Conversation digest', Icon: FileStack },
  wrap_up: { label: 'Wrap-up prompt', Icon: Gift },
};

function LoopTurnsStage({ stage, showConnector, renderStage }: { stage: StageView; showConnector: boolean; renderStage: RenderStage }) {
  // The instance's own turns (the history API filters by the stage run id).
  const sessionId = useWorkflowRunStore((s) => s.stageSessionMap[stage.id]);
  const started = stage.rawStatus !== 'pending' && stage.rawStatus !== 'ready';
  const { data: messages } = useStageChatHistory(started ? sessionId : undefined, stage.id);
  const turns = useMemo(
    () => (messages ?? []).filter((m) => m.role === 'user' && !!m.turnRole && m.turnRole in TURN_LABELS),
    [messages],
  );
  // A later iteration's first turn is its follow-up prompt, and a wrap-up's
  // is the wrap-up prompt: the definition's first prompt was not sent.
  const hidePrompt = stage.wrapUp === true || turns.some((m) => m.turnRole === 'iteration_input' || m.turnRole === 'wrap_up');
  const preamble = turns.length > 0 ? (
    <div className="space-y-2">
      {turns.map((m) => {
        const meta = TURN_LABELS[m.turnRole!]!;
        return (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/[0.08] px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary)]/80">
                <meta.Icon className="h-2.5 w-2.5" />
                {meta.label}
              </div>
              <p className={cn(
                'whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--color-foreground)]/90',
                m.turnRole === 'digest' && 'max-h-48 overflow-y-auto',
              )}>
                {m.content}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  ) : undefined;
  return <>{renderStage(stage, { showConnector, ...(preamble ? { preamble } : {}), hidePrompt })}</>;
}

function IterationDivider({ k, row, label }: { k?: number; row?: LoopIteration; label?: string }) {
  return (
    <div className="flex items-center gap-2 pt-1" role="separator">
      <span className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        {label ?? `Iteration ${(k ?? 0) + 1}`}
        {row && <span className="ml-1.5 font-normal normal-case tracking-normal">· {row.outcome}{row.score !== null ? ` · score ${row.score}` : ''}</span>}
      </span>
      <span className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v === undefined) return '—';
  try {
    return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** A finished iteration's carry, exit values, score and signals (`loop_iterations`). */
function IterationDetails({ k, row, loop, running }: { k: number; row?: LoopIteration; loop: LoopView; running: boolean }) {
  if (!row) {
    return (
      <p className="text-[11px] text-[var(--color-muted-foreground)]">
        {running
          ? `Iteration ${k + 1} is in progress: its rule values and carried state appear when it finishes.`
          : `No record of iteration ${k + 1} yet.`}
      </p>
    );
  }
  const carry = Object.entries(row.carry ?? {});
  const exits = Object.entries(row.exitValues ?? {});
  const cost = typeof row.usage?.['costUsd'] === 'number' ? (row.usage['costUsd'] as number) : undefined;
  const changed = row.signals?.workspaceChanged;
  return (
    <div className="space-y-2 rounded-md border border-[var(--color-border)]/60 bg-[var(--color-subtle)]/30 p-2.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--color-muted-foreground)]">
        <span>Outcome <span className="text-[var(--color-foreground)]">{row.outcome}</span></span>
        <span>Score <span className="tabular-nums text-[var(--color-foreground)]">{row.score ?? '—'}</span></span>
        <span>
          Workspace changed{' '}
          <span className="text-[var(--color-foreground)]">{changed === true ? 'yes' : changed === false ? 'no' : '—'}</span>
        </span>
        {row.signals?.toolCalls !== null && row.signals?.toolCalls !== undefined && (
          <span>Tool calls <span className="tabular-nums text-[var(--color-foreground)]">{row.signals.toolCalls}</span></span>
        )}
        {cost !== undefined && <span>Cost <span className="tabular-nums text-[var(--color-foreground)]">${cost.toFixed(2)}</span></span>}
        {row.checkpointTurnId && <span className="text-[var(--color-success)]">checkpointed</span>}
      </div>

      {exits.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Exit rules</span>
          {exits.map(([reason, value]) => {
            const i = loop.rules.findIndex((r) => r.reason === reason);
            const rule = i >= 0 ? loop.rules[i] : undefined;
            const streak = i >= 0 ? row.streaks?.[i] : undefined;
            return (
              <span
                key={reason}
                title={rule?.when ? `${rule.action} when ${rule.when}` : undefined}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px]',
                  value === true
                    ? 'bg-[var(--color-success)]/12 text-[var(--color-success)]'
                    : value === false
                      ? 'bg-[var(--color-muted-foreground)]/10 text-[var(--color-muted-foreground)]'
                      : 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]',
                )}
              >
                {reason} {value === true ? 'true' : value === false ? 'false' : 'null'}
                {streak !== undefined && rule && <span className="opacity-70">{streak}/{rule.consecutive}</span>}
              </span>
            );
          })}
        </div>
      )}

      {carry.length > 0 && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
              <th className="w-1/3 py-0.5 pr-2 font-semibold">Carry</th>
              <th className="py-0.5 font-semibold">Value</th>
            </tr>
          </thead>
          <tbody>
            {carry.map(([name, value]) => (
              <tr key={name} className="border-t border-[var(--color-border)]/50 align-top">
                <td className="py-1 pr-2 font-mono text-[10.5px] text-[var(--color-foreground)]/85">{name}</td>
                <td className="py-1">
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] text-[var(--color-foreground)]/80">
                    {renderValue(value)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
