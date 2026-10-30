// ────────────────────────────────────────────────────────────────
// WF-08 DecisionCard — a PARKED loop's operator decision (P05 §2.3), on the
// kit's GateCardFrame (tone warn, "Needs decision").
//
// Every button is a run command on the loop instance; each one resets the
// exit rules' streaks:
//   • Grant +1 / +2        → grant_iterations
//   • Raise budget         → raise_budget (the amounts are ADDED)
//   • Continue with input  → continue_with_input (an operator turn of the
//                            next iteration's first stages)
//   • Accept               → accept (the last iteration)
//   • Accept iteration k   → accept_iteration (a checkpointed one, or the
//                            last; its workspace checkpoint is restored)
//   • Fail                 → fail (confirmed first: it is final)
// A refused command is toasted by the page's command hook with the server's reason.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { RunCommand } from '@generatorai/workflow-spec';
import { cn } from '@/ui/lib/cn.js';
import { GateCardFrame } from '@/ui/patterns/GateCardFrame/GateCardFrame.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { ProgressBar } from '@/ui/primitives/ProgressBar/ProgressBar.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { loopRulesText } from '../model/loopView.js';
import type { LoopDecisionView, LoopView } from '../model/types.js';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';

export interface DecisionCardProps {
  loopId: string;
  loop: LoopView;
  decision: LoopDecisionView;
  /** The parked loop's version: every decision carries it, so a stale card never acts on a later park (LOOP-R14). */
  version?: number | undefined;
  /** Resolves once the command settled (applied or refused). */
  onCommand: (command: RunCommand) => Promise<void>;
}

function fmtNumber(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

interface UsageRow {
  label: string;
  used: string;
  limit?: string;
  over: boolean;
  /** Raw numbers for the meter (only when the budget sets a limit). */
  meter?: { value: number; max: number };
}

/** "Turns 12 / 20 · Cost $0.84 / $1.00 · …": usage against the loop's cumulative budget. */
function usageRows(d: LoopDecisionView): UsageRow[] {
  const rows: UsageRow[] = [];
  const { usage, budget } = d;
  const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (usage.turns !== undefined || budget.maxTurns !== undefined) {
    rows.push({
      label: 'Turns',
      used: fmtNumber(usage.turns ?? 0),
      ...(budget.maxTurns !== undefined ? { limit: fmtNumber(budget.maxTurns), meter: { value: usage.turns ?? 0, max: budget.maxTurns } } : {}),
      over: budget.maxTurns !== undefined && (usage.turns ?? 0) >= budget.maxTurns,
    });
  }
  if (usage.costUsd !== undefined || budget.maxCostUsd !== undefined) {
    rows.push({
      label: 'Cost',
      used: `$${(usage.costUsd ?? 0).toFixed(2)}`,
      ...(budget.maxCostUsd !== undefined
        ? { limit: `$${budget.maxCostUsd.toFixed(2)}`, meter: { value: usage.costUsd ?? 0, max: budget.maxCostUsd } }
        : {}),
      over: budget.maxCostUsd !== undefined && (usage.costUsd ?? 0) >= budget.maxCostUsd,
    });
  }
  if (tokens > 0 || budget.maxTokens !== undefined) {
    rows.push({
      label: 'Tokens',
      used: fmtNumber(tokens),
      ...(budget.maxTokens !== undefined ? { limit: fmtNumber(budget.maxTokens), meter: { value: tokens, max: budget.maxTokens } } : {}),
      over: budget.maxTokens !== undefined && tokens >= budget.maxTokens,
    });
  }
  if (budget.maxWallClockMs !== undefined) {
    rows.push({ label: 'Wall clock', used: '—', limit: fmtMs(budget.maxWallClockMs), over: false });
  }
  return rows;
}

function headline(d: LoopDecisionView): string {
  if (d.action === 'exhaust') {
    if (d.reason === 'max_iterations') return `The loop used all ${d.maxIterations} iterations without an exit rule firing.`;
    if (d.reason === 'budget') return 'The loop ran out of budget.';
    return `The loop is exhausted (${d.reason || 'limit reached'}).`;
  }
  return `A pause rule fired: ${d.reason || 'pause'}.`;
}

/** "Paused · max iterations" / "Exhausted · budget" for the header's meta. */
function metaText(d: LoopDecisionView): string {
  const state = d.action === 'exhaust' ? 'Exhausted' : 'Paused';
  return d.reason ? `${state} · ${d.reason.replace(/_/g, ' ')}` : state;
}

/** A positive number from a field, or undefined when empty/invalid. */
function positive(text: string): number | undefined {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
}

const EMPTY_BUDGET = { turns: '', cost: '', tokens: '', minutes: '' };

/** A parked loop's decision card: grant, raise budget, continue with input, accept, accept iteration, fail. */
export function DecisionCard({ loopId, loop, decision, version, onCommand }: DecisionCardProps) {
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'budget' | 'input'>('none');
  const [input, setInput] = useState('');
  const [budget, setBudget] = useState(EMPTY_BUDGET);
  const confirmer = useConfirm();

  const run = (command: RunCommand, after?: () => void) => {
    setBusy(true);
    void onCommand(version !== undefined && 'instanceId' in command ? ({ ...command, expectedVersion: version } as RunCommand) : command).finally(() => {
      setBusy(false);
      after?.();
    });
  };

  const last = decision.k;
  // accept_iteration needs a checkpoint unless it is the last iteration.
  const acceptable = [...new Set([...decision.checkpoints, ...(last >= 0 ? [last] : [])])].sort((a, b) => a - b);
  const scoreOf = (k: number) => decision.scores.find((s) => s.k === k)?.score ?? null;
  const rows = usageRows(decision);
  const rules = loopRulesText(loop);

  const budgetCommand = (): RunCommand | null => {
    const maxTurns = positive(budget.turns);
    const maxCostUsd = positive(budget.cost);
    const maxTokens = positive(budget.tokens);
    const minutes = positive(budget.minutes);
    if (maxTurns === undefined && maxCostUsd === undefined && maxTokens === undefined && minutes === undefined) return null;
    return {
      command: 'raise_budget',
      instanceId: loopId,
      ...(maxTurns !== undefined ? { maxTurns: Math.round(maxTurns) } : {}),
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      ...(maxTokens !== undefined ? { maxTokens: Math.round(maxTokens) } : {}),
      ...(minutes !== undefined ? { maxWallClockMs: Math.round(minutes * 60_000) } : {}),
    };
  };
  const raise = budgetCommand();

  const confirmFail = async () => {
    const ok = await confirmer.confirm({
      title: 'Fail the loop?',
      description: 'The loop fails; this cannot be undone. Routing decides what the run does next.',
      confirmLabel: 'Confirm fail',
      tone: 'danger',
    });
    if (ok) run({ command: 'fail', instanceId: loopId });
  };

  return (
    <GateCardFrame
      tone="warn"
      icon="hand"
      title="Needs decision"
      meta={
        <>
          <span className="font-mono tabular-nums">
            {decision.iterations}/{decision.maxIterations}
          </span>{' '}
          · {metaText(decision)}
        </>
      }
      aria-live="polite"
      actions={[]}
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-ui text-fg">{headline(decision)}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-small text-fg-3">
          <span>
            Iterations{' '}
            <span className="font-mono tabular-nums text-fg">
              {decision.iterations}/{decision.maxIterations}
            </span>
          </span>
          {rows.map((r) => (
            <span key={r.label} className="inline-flex items-center gap-1.5">
              {r.label}{' '}
              <span className={cn('font-mono tabular-nums', r.over ? 'text-err' : 'text-fg')}>
                {r.used}
                {r.limit ? ` / ${r.limit}` : ''}
              </span>
              {r.meter ? <ProgressBar kind="meter" size="inline" value={r.meter.value} max={r.meter.max} label={`${r.label} used of the loop budget`} /> : null}
            </span>
          ))}
        </div>
        {rules && (
          <p className="font-mono text-micro text-fg-3" title="Exit rules: streak / consecutive iterations needed">
            {rules}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="plus" disabled={busy} onClick={() => run({ command: 'grant_iterations', instanceId: loopId, n: 1 })}>
          Grant +1
        </Button>
        <Button size="sm" icon="plus" disabled={busy} onClick={() => run({ command: 'grant_iterations', instanceId: loopId, n: 2 })}>
          Grant +2
        </Button>
        <Button
          size="sm"
          icon="activity"
          disabled={busy}
          aria-expanded={panel === 'budget'}
          onClick={() => setPanel((p) => (p === 'budget' ? 'none' : 'budget'))}
        >
          Raise budget
        </Button>
        <Button
          size="sm"
          icon="message"
          disabled={busy}
          aria-expanded={panel === 'input'}
          onClick={() => setPanel((p) => (p === 'input' ? 'none' : 'input'))}
        >
          Continue with input
        </Button>
      </div>

      <Reveal open={panel === 'budget'} gap={2.5}>
        <div className="flex flex-col gap-2 rounded-card border border-line-soft bg-sunken p-2.5">
          <p className="text-small text-fg-3">Add to the loop’s cumulative budget (leave a field empty to keep it).</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(
              [
                ['turns', 'Turns', decision.budget.maxTurns !== undefined ? `now ${decision.budget.maxTurns}` : '+ turns'],
                ['cost', 'Cost (USD)', decision.budget.maxCostUsd !== undefined ? `now $${decision.budget.maxCostUsd}` : '+ USD'],
                ['tokens', 'Tokens', decision.budget.maxTokens !== undefined ? `now ${fmtNumber(decision.budget.maxTokens)}` : '+ tokens'],
                ['minutes', 'Wall clock (min)', decision.budget.maxWallClockMs !== undefined ? `now ${fmtMs(decision.budget.maxWallClockMs)}` : '+ minutes'],
              ] as const
            ).map(([key, label, placeholder]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-small font-medium text-fg-2">{label}</span>
                <Input
                  size="sm"
                  mono
                  type="number"
                  min={0}
                  step={key === 'cost' ? '0.01' : '1'}
                  inputMode="decimal"
                  value={budget[key]}
                  placeholder={placeholder}
                  onChange={(e) => setBudget((b) => ({ ...b, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !raise}
              onClick={() => {
                if (raise)
                  run(raise, () => {
                    setPanel('none');
                    setBudget(EMPTY_BUDGET);
                  });
              }}
            >
              Raise and continue
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel('none')}>
              Cancel
            </Button>
          </div>
        </div>
      </Reveal>

      <Reveal open={panel === 'input'} gap={2.5}>
        <div className="flex flex-col gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            aria-label="Operator input for the next iteration"
            placeholder="A message for the next iteration (sent as an operator turn to its first stages)…"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || input.trim().length === 0}
              onClick={() =>
                run({ command: 'continue_with_input', instanceId: loopId, text: input.trim() }, () => {
                  setPanel('none');
                  setInput('');
                })
              }
            >
              Send and continue
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel('none')}>
              Cancel
            </Button>
          </div>
        </div>
      </Reveal>

      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-2.5">
        <Button
          size="sm"
          variant="primary"
          icon="check"
          disabled={busy || last < 0}
          title={last >= 0 ? `Complete the loop with iteration ${last + 1}` : 'No iteration has finished'}
          onClick={() => run({ command: 'accept', instanceId: loopId })}
        >
          Accept{last >= 0 ? ` iteration ${last + 1}` : ''}
        </Button>
        {acceptable.length > 1 && (
          <Menu.Root>
            <Menu.Trigger
              disabled={busy}
              render={
                <Button size="sm" trailingIcon="chevron-down">
                  Accept iteration…
                </Button>
              }
            />
            <Menu.Popup align="start">
              {acceptable.map((k) => {
                const score = scoreOf(k);
                return (
                  <Menu.Item
                    key={k}
                    onClick={() => run({ command: 'accept_iteration', instanceId: loopId, k })}
                    {...(score !== null ? { trailing: <span className="tabular-nums">score {score}</span> } : {})}
                  >
                    Iteration {k + 1}
                    {k === last ? ' (last)' : ''}
                  </Menu.Item>
                );
              })}
            </Menu.Popup>
          </Menu.Root>
        )}
        <Button
          size="sm"
          variant="danger"
          icon="x"
          className="ml-auto"
          disabled={busy}
          title="Fail the loop; routing decides what the run does next"
          onClick={() => void confirmFail()}
        >
          Fail
        </Button>
      </div>
      {confirmer.dialog}
    </GateCardFrame>
  );
}
