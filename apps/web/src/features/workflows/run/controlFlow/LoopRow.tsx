// ────────────────────────────────────────────────────────────────
// LoopRow — a loop instance (P05) in the run's stage table (board
// WorkflowRunLoop).
//
//   ⌄ ◌ Fix and review  3/5  fix_review   Loop · max 5   iteration 3 of 5
//       [DecisionCard — a parked loop only]
//       Exit rules    when … → action · reason   streak   value after #k
//       Carry  openComments  from #1
//       [All] [#0 completed] [#1 completed] [#2 running] [Wrap-up]
//       iteration details (outcome, score, workspace changed, exit values
//       with their streaks, carried values) — or, on All, the iterations table
//       ⌄ Fix  (the body rows of the selected iteration, one depth deeper)
//         [Iteration input card] above its transcript
//
// The row itself is the page's StageRow (through `renderStage`, so focus,
// the "…" menu and the inspector behave like any stage's) whose transcript
// is replaced by the iterations. Body instances render through the same
// renderer, with their iteration-input, operator, digest and wrap-up turns
// above their transcript. "All" is the continuing transcript: every
// iteration in order, with a divider between them.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import type { LoopIteration } from '@generatorai/shared';
import { useLoopIterations } from '@/hooks/workflowQueries.js';
import { useStageChatHistory } from '@/hooks/queries.js';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge, type BadgeTone } from '@/ui/primitives/Badge/Badge.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Table, TableBody, TableCell, TableHeadCell, TableHeader, TableRow } from '@/ui/primitives/Table/Table.js';
import { DecisionCard } from './DecisionCard.js';
import { BodyRows, type ControlFlowNodeProps } from './ControlFlowNode.js';
import { LoopIterationsTable, outcomeStatus } from './LoopIterationsTable.js';
import { formatUsd } from '../model/format.js';
import { loopBadge, loopExitText, loopRulesText } from '../model/loopView.js';
import type { RenderStage } from '../model/renderStage.js';
import type { LoopView, StageView } from '../model/types.js';

type IterTab = number | 'all' | 'wrapup';

/** The loop row's header badges: `n/max`, the rule streaks, "Needs decision", the exit. */
export function LoopHeaderBadges({ stage, loop }: { stage: StageView; loop: LoopView }) {
  const rules = loopRulesText(loop);
  const done = stage.status === 'completed' || stage.status === 'failed' || stage.status === 'cancelled';
  const exit = loopExitText(loop);
  return (
    <>
      <Badge tone="run" icon="refresh" className="font-mono tabular-nums" title={`Iteration ${Math.max(0, loop.k + 1)} of ${loop.max}`}>
        {loopBadge(loop)}
      </Badge>
      {rules && !done && (
        <Badge className="hidden max-w-full font-mono md:inline-flex" title={`Exit rules (streak / consecutive): ${rules}`}>
          <span className="truncate">{rules}</span>
        </Badge>
      )}
      {loop.decision && (
        <Badge tone="warn" icon="hand">
          Needs decision
        </Badge>
      )}
      {done && exit && (
        <Badge
          tone={stage.status === 'completed' ? 'ok' : 'err'}
          icon={stage.status === 'completed' ? 'status-succeeded' : 'status-failed'}
          className="hidden max-w-full md:inline-flex"
          title={exit}
        >
          <span className="truncate">{exit}</span>
        </Badge>
      )}
    </>
  );
}

/** The exit rules with their current streaks and, once an iteration finished, its value. */
function ExitRulesTable({ loop, last }: { loop: LoopView; last: LoopIteration | undefined }) {
  if (loop.rules.length === 0) return null;
  const columns = ['minmax(0,2fr)', 'minmax(0,1fr)', 'auto', ...(last ? ['auto'] : [])];
  return (
    <Table columns={columns} size="dense" inset="card" label="Exit rules" bare>
      <TableHeader>
        <TableHeadCell>Exit rules</TableHeadCell>
        <TableHeadCell>Action · reason</TableHeadCell>
        <TableHeadCell align="end">Streak</TableHeadCell>
        {last && <TableHeadCell align="end">Value after #{last.k}</TableHeadCell>}
      </TableHeader>
      <TableBody>
        {loop.rules.map((r) => {
          const value = last?.exitValues?.[r.reason];
          return (
            <TableRow key={r.reason}>
              <TableCell mono className="text-fg-2" title={r.when ?? r.reason}>
                <span className="truncate">{r.when ?? r.reason}</span>
              </TableCell>
              <TableCell className="gap-1 text-small text-fg-2">
                <Icon concept="forward" size={12} className="shrink-0 text-fg-3" />
                <span className="truncate">
                  {r.action} · {r.reason}
                </span>
              </TableCell>
              <TableCell mono align="end">
                {r.streak}/{r.consecutive}
              </TableCell>
              {last && (
                <TableCell mono align="end" className={value === true ? 'text-ok' : undefined}>
                  {value === true ? 'true' : value === false ? 'false' : value === null ? 'null' : '—'}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function LoopRow({ runId, stage, bodies, focusedId, showConnector, renderStage, onCommand, depth = 0 }: ControlFlowNodeProps) {
  const loop = stage.loop!;
  const body = useMemo(() => bodies[stage.id] ?? [], [bodies, stage.id]);

  const { byIteration, wrapUps, lastIndex } = useMemo(() => {
    const map = new Map<number, StageView[]>();
    const wraps: StageView[] = [];
    let max = -1;
    for (const s of body) {
      if (s.wrapUp) {
        wraps.push(s);
        continue;
      }
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
  const settled = stage.status === 'completed' || stage.status === 'failed';

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
  const lastRow = useMemo(() => (rows ?? []).reduce<LoopIteration | undefined>((a, r) => (!a || r.k > a.k ? r : a), undefined), [rows]);
  const liveK = !settled && !wrapUpLive && !loop.decision && loop.k >= 0 && !rowByK.has(loop.k) ? loop.k : null;

  const parent = { runId, bodies, focusedId, renderStage, onCommand, depth };
  const carryNames = Object.keys(lastRow?.carry ?? {});

  const tabItems: SegmentedItem[] = [
    ...(iterations.length > 1 ? [{ value: 'all', label: 'All' }] : []),
    ...iterations.map((k): SegmentedItem => {
      const row = rowByK.get(k);
      // An iteration with a recorded row has finished — also while the loop waits for a decision after it.
      const live = current === k && !settled && !row && !loop.decision;
      const glyph = row ? outcomeStatus(row.outcome)?.def.glyph : undefined;
      return {
        value: String(k),
        label: `#${k}`,
        icon: (live ? 'status-running' : (glyph ?? 'status-queued')) as IconConcept,
        ...(live ? { count: 'running' } : row ? { count: row.outcome } : {}),
      };
    }),
    ...(wrapUps.length > 0 ? [{ value: 'wrapup', label: 'Wrap-up', ...(wrapUpLive ? { count: 'running' } : {}) }] : []),
  ];

  const loopBody = (
    <div className="flex flex-col gap-3">
      {loop.decision && <DecisionCard loopId={stage.id} loop={loop} decision={loop.decision} version={stage.version} onCommand={onCommand} />}

      <ExitRulesTable loop={loop} last={lastRow} />

      {(carryNames.length > 0 || loop.operatorInput) && (
        <div className="flex flex-col gap-1 text-small text-fg-3">
          {carryNames.length > 0 && lastRow && (
            <p className="flex flex-wrap items-center gap-1.5">
              <span>Carry</span>
              {carryNames.map((n) => (
                <InlineCode key={n} dense className="text-fg">
                  {n}
                </InlineCode>
              ))}
              <span>from #{lastRow.k}</span>
            </p>
          )}
          {loop.operatorInput && (
            <p className="flex items-center gap-1.5">
              <Icon concept="message" size={12} />
              Operator input queued for iteration {loop.operatorInput.forIteration + 1}.
            </p>
          )}
        </div>
      )}

      {iterations.length === 0 && wrapUps.length === 0 ? (
        <p className="text-small text-fg-3">The first iteration has not started yet.</p>
      ) : (
        <>
          <SegmentedControl
            semantics="tabs"
            label={`Iterations of ${stage.name}`}
            value={String(tab)}
            onValueChange={(v) => setPicked(v === 'all' || v === 'wrapup' ? v : Number(v))}
            items={tabItems}
            className="max-w-full self-start overflow-x-auto"
          />

          {tab === 'all' && (
            <>
              <LoopIterationsTable rows={rows ?? []} liveK={liveK} />
              {iterations.map((k) => (
                <div key={k} className="flex flex-col gap-2">
                  <IterationDivider k={k} row={rowByK.get(k)} />
                  <BodyRows list={byIteration.get(k) ?? []} parent={parent} />
                </div>
              ))}
              {wrapUps.length > 0 && (
                <div className="flex flex-col gap-2">
                  <IterationDivider label="Wrap-up" />
                  <BodyRows list={wrapUps} parent={parent} />
                </div>
              )}
            </>
          )}

          {typeof tab === 'number' && (
            <div className="flex flex-col gap-2">
              <IterationDetails k={tab} row={rowByK.get(tab)} loop={loop} running={tab === loop.k && !rowByK.has(tab)} />
              {(byIteration.get(tab) ?? []).length > 0 ? (
                <BodyRows list={byIteration.get(tab) ?? []} parent={parent} />
              ) : (
                <p className="text-small text-fg-3">No stage of this iteration has started yet.</p>
              )}
            </div>
          )}

          {tab === 'wrapup' && <BodyRows list={wrapUps} parent={parent} />}
        </>
      )}
    </div>
  );

  return (
    <>
      {renderStage(stage, {
        showConnector,
        depth,
        headerExtra: <LoopHeaderBadges stage={stage} loop={loop} />,
        body: loopBody,
      })}
    </>
  );
}

// ── A plain body instance: its loop turns above its transcript ──

/** Turn roles of a loop body's conversation that the transcript labels (P05). */
const TURN_LABELS: Record<string, { label: string; icon: IconConcept }> = {
  iteration_input: { label: 'Iteration input', icon: 'download' },
  operator: { label: 'Your follow-up', icon: 'message' },
  digest: { label: 'Conversation digest', icon: 'layers' },
  wrap_up: { label: 'Wrap-up prompt', icon: 'archive' },
};

/** A plain body instance of a container (ControlFlowNode renders the containers and waits): its loop turns above its transcript. */
export function LoopBodyStage({ stage, showConnector, renderStage, depth = 0 }: { stage: StageView; showConnector: boolean; renderStage: RenderStage; depth?: number }) {
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
  const where = stage.wrapUp ? 'wrap-up' : stage.iterationIndex !== undefined ? `#${stage.iterationIndex}` : null;
  const preamble =
    turns.length > 0 ? (
      <div className="flex flex-col gap-2">
        {turns.map((m) => {
          const meta = TURN_LABELS[m.turnRole!]!;
          return (
            <section key={m.id} aria-label={meta.label} className="flex flex-col gap-1.5 rounded-card border border-line-soft bg-raised px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-1.5 text-small text-fg-3">
                <Icon concept={meta.icon} size={14} className="shrink-0" />
                <span className="font-semibold text-fg">{meta.label}</span>
                {where && (
                  <span className="truncate">
                    {where} · to <span className="font-mono text-fg-2">{stage.stageKey}</span>
                  </span>
                )}
              </div>
              <p className={cn('text-ui whitespace-pre-wrap text-fg', m.turnRole === 'digest' && 'max-h-48 overflow-y-auto')}>{m.content}</p>
            </section>
          );
        })}
      </div>
    ) : undefined;
  return <>{renderStage(stage, { showConnector, depth, ...(preamble ? { preamble } : {}), hidePrompt })}</>;
}

// ── Iteration parts ─────────────────────────────────────────────

function IterationDivider({ k, row, label }: { k?: number; row?: LoopIteration | undefined; label?: string }) {
  return (
    <div className="flex items-center gap-2 pt-1" role="separator" aria-label={label ?? `Iteration ${(k ?? 0) + 1}`}>
      <span className="flex-1 border-t border-line-soft" />
      <span className="text-small font-medium text-fg-2">
        {label ?? `#${k ?? 0}`}
        {row && (
          <span className="ml-1.5 font-normal text-fg-3">
            · {row.outcome}
            {row.score !== null ? ` · score ${row.score}` : ''}
          </span>
        )}
      </span>
      <span className="flex-1 border-t border-line-soft" />
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

function exitTone(value: boolean | null | undefined): BadgeTone {
  return value === true ? 'ok' : value === false ? 'neutral' : 'warn';
}

/** A finished iteration's carry, exit values, score and signals (`loop_iterations`). */
function IterationDetails({ k, row, loop, running }: { k: number; row: LoopIteration | undefined; loop: LoopView; running: boolean }) {
  if (!row) {
    return (
      <p className="text-small text-fg-3">
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
  const fact = (label: string, value: string) => (
    <span>
      {label} <span className="font-mono tabular-nums text-fg">{value}</span>
    </span>
  );
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line-soft bg-sunken p-3 text-small text-fg-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {fact('Outcome', row.outcome)}
        {fact('Score', row.score !== null ? String(row.score) : '—')}
        {fact('Workspace changed', changed === true ? 'yes' : changed === false ? 'no' : '—')}
        {row.signals?.toolCalls !== null && row.signals?.toolCalls !== undefined && fact('Tool calls', String(row.signals.toolCalls))}
        {cost !== undefined && fact('Cost', formatUsd(cost))}
        {row.checkpointTurnId && <span className="text-ok">checkpointed</span>}
      </div>

      {exits.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-fg-2">Exit rules</span>
          {exits.map(([reason, value]) => {
            const i = loop.rules.findIndex((r) => r.reason === reason);
            const rule = i >= 0 ? loop.rules[i] : undefined;
            const streak = i >= 0 ? row.streaks?.[i] : undefined;
            return (
              <Badge
                key={reason}
                tone={exitTone(value)}
                className="font-mono"
                title={rule?.when ? `${rule.action} when ${rule.when}` : undefined}
                {...(streak !== undefined && rule ? { suffix: `${streak}/${rule.consecutive}` } : {})}
              >
                {reason} {value === true ? 'true' : value === false ? 'false' : 'null'}
              </Badge>
            );
          })}
        </div>
      )}

      {carry.length > 0 && (
        <Table columns={['minmax(0,1fr)', 'minmax(0,2fr)']} size="dense" inset="card" label={`Carry after iteration ${k + 1}`}>
          <TableHeader>
            <TableHeadCell>Carry</TableHeadCell>
            <TableHeadCell>Value</TableHeadCell>
          </TableHeader>
          <TableBody>
            {carry.map(([name, value]) => (
              <TableRow key={name} className="items-start py-1">
                <TableCell mono className="text-fg-2">
                  {name}
                </TableCell>
                <TableCell>
                  <pre className="max-h-32 w-full overflow-auto font-mono text-micro break-all whitespace-pre-wrap text-fg-2">{renderValue(value)}</pre>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
