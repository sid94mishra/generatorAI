// ────────────────────────────────────────────────────────────────
// LoopDecisionCard — a PARKED loop's operator decision (P05 §2.3).
//
// Same card chrome as the completion review (InlineHitlControls). Every
// button is a run command on the loop instance; each one resets the exit
// rules' streaks:
//   • Grant +1 / +2        → grant_iterations
//   • Raise budget         → raise_budget (the amounts are ADDED)
//   • Continue with input  → continue_with_input (an operator turn of the
//                            next iteration's first stages)
//   • Accept               → accept (the last iteration)
//   • Accept iteration k   → accept_iteration (a checkpointed one, or the
//                            last; its workspace checkpoint is restored)
//   • Fail                 → fail (confirmed first: it is final)
// A refused command is toasted by `useRunCommand` with the server's reason.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Hand, Plus, Wallet, MessageSquarePlus, Check, ChevronDown, Ban } from 'lucide-react';
import type { RunCommand } from '@generatorai/workflow-spec';
import { cn } from '@/lib/utils.js';
import { Button, Input, Textarea } from '@/components/ui/index.js';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/primitives/dropdown-menu.js';
import type { LoopDecisionView, LoopView } from './types.js';
import { loopRulesText } from './loopView.js';

interface LoopDecisionCardProps {
  loopId: string;
  loop: LoopView;
  decision: LoopDecisionView;
  /** Resolves once the command settled (applied or refused). */
  onCommand: (command: RunCommand) => Promise<void>;
}

const SECONDARY_BTN =
  'h-auto flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-subtle)] disabled:cursor-not-allowed disabled:opacity-50';

function fmtNumber(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** "Turns 12 / 20 · Cost $0.84 / $1.00 · …": usage against the loop's cumulative budget. */
function usageRows(d: LoopDecisionView): Array<{ label: string; used: string; limit?: string; over: boolean }> {
  const rows: Array<{ label: string; used: string; limit?: string; over: boolean }> = [];
  const { usage, budget } = d;
  const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (usage.turns !== undefined || budget.maxTurns !== undefined) {
    rows.push({
      label: 'Turns',
      used: fmtNumber(usage.turns ?? 0),
      ...(budget.maxTurns !== undefined ? { limit: fmtNumber(budget.maxTurns) } : {}),
      over: budget.maxTurns !== undefined && (usage.turns ?? 0) >= budget.maxTurns,
    });
  }
  if (usage.costUsd !== undefined || budget.maxCostUsd !== undefined) {
    rows.push({
      label: 'Cost',
      used: `$${(usage.costUsd ?? 0).toFixed(2)}`,
      ...(budget.maxCostUsd !== undefined ? { limit: `$${budget.maxCostUsd.toFixed(2)}` } : {}),
      over: budget.maxCostUsd !== undefined && (usage.costUsd ?? 0) >= budget.maxCostUsd,
    });
  }
  if (tokens > 0 || budget.maxTokens !== undefined) {
    rows.push({
      label: 'Tokens',
      used: fmtNumber(tokens),
      ...(budget.maxTokens !== undefined ? { limit: fmtNumber(budget.maxTokens) } : {}),
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

/** A positive number from a field, or undefined when empty/invalid. */
function positive(text: string): number | undefined {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
}

export function LoopDecisionCard({ loopId, loop, decision, onCommand }: LoopDecisionCardProps) {
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'budget' | 'input'>('none');
  const [input, setInput] = useState('');
  const [budget, setBudget] = useState({ turns: '', cost: '', tokens: '', minutes: '' });
  const [confirmingFail, setConfirmingFail] = useState(false);

  const run = (command: RunCommand, after?: () => void) => {
    setBusy(true);
    void onCommand(command).finally(() => {
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

  return (
    <section
      className="rounded-lg border-l-2 border-[var(--color-warning)] bg-[var(--color-warning)]/[0.06] p-3 space-y-2.5"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <Hand className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)] animate-status-breathe" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-[var(--color-warning)]">Loop needs a decision</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-foreground)]/85">{headline(decision)}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted-foreground)]">
            <span>
              Iterations <span className="tabular-nums text-[var(--color-foreground)]">{decision.iterations}/{decision.maxIterations}</span>
            </span>
            {rows.map((r) => (
              <span key={r.label}>
                {r.label}{' '}
                <span className={cn('tabular-nums', r.over ? 'text-[var(--color-danger)]' : 'text-[var(--color-foreground)]')}>
                  {r.used}{r.limit ? ` / ${r.limit}` : ''}
                </span>
              </span>
            ))}
          </div>
          {rules && (
            <p className="mt-1 font-mono text-[10.5px] text-[var(--color-muted-foreground)]" title="Exit rules: streak / consecutive iterations needed">
              {rules}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} className={SECONDARY_BTN}
          onClick={() => run({ command: 'grant_iterations', instanceId: loopId, n: 1 })}>
          <Plus className="h-3.5 w-3.5" />
          Grant +1
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} className={SECONDARY_BTN}
          onClick={() => run({ command: 'grant_iterations', instanceId: loopId, n: 2 })}>
          <Plus className="h-3.5 w-3.5" />
          Grant +2
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy}
          aria-expanded={panel === 'budget'}
          className={cn(SECONDARY_BTN, panel === 'budget' && 'border-[var(--color-primary)]/50')}
          onClick={() => setPanel((p) => (p === 'budget' ? 'none' : 'budget'))}>
          <Wallet className="h-3.5 w-3.5" />
          Raise budget
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy}
          aria-expanded={panel === 'input'}
          className={cn(SECONDARY_BTN, panel === 'input' && 'border-[var(--color-primary)]/50')}
          onClick={() => setPanel((p) => (p === 'input' ? 'none' : 'input'))}>
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Continue with input
        </Button>
      </div>

      {panel === 'budget' && (
        <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)]/70 p-2.5">
          <p className="text-[11px] text-[var(--color-muted-foreground)]">Add to the loop’s cumulative budget (leave a field empty to keep it).</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {([
              ['turns', 'Turns', decision.budget.maxTurns !== undefined ? `now ${decision.budget.maxTurns}` : '+ turns'],
              ['cost', 'Cost (USD)', decision.budget.maxCostUsd !== undefined ? `now $${decision.budget.maxCostUsd}` : '+ USD'],
              ['tokens', 'Tokens', decision.budget.maxTokens !== undefined ? `now ${fmtNumber(decision.budget.maxTokens)}` : '+ tokens'],
              ['minutes', 'Wall clock (min)', decision.budget.maxWallClockMs !== undefined ? `now ${fmtMs(decision.budget.maxWallClockMs)}` : '+ minutes'],
            ] as const).map(([key, label, placeholder]) => (
              <label key={key} className="space-y-0.5">
                <span className="text-[10.5px] font-medium text-[var(--color-muted-foreground)]">{label}</span>
                <Input
                  type="number"
                  min={0}
                  step={key === 'cost' ? '0.01' : '1'}
                  inputMode="decimal"
                  value={budget[key]}
                  placeholder={placeholder}
                  onChange={(e) => setBudget((b) => ({ ...b, [key]: e.target.value }))}
                  className="h-7 px-2 text-[12px]"
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={busy || !raise}
              className="h-auto rounded-md bg-[var(--color-primary)] px-3 py-1 text-[11.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
              onClick={() => { if (raise) run(raise, () => { setPanel('none'); setBudget({ turns: '', cost: '', tokens: '', minutes: '' }); }); }}>
              Raise and continue
            </Button>
            <Button type="button" variant="ghost" size="sm"
              className="h-auto rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--color-muted-foreground)] hover:bg-transparent hover:text-[var(--color-foreground)]"
              onClick={() => setPanel('none')}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {panel === 'input' && (
        <div className="space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="A message for the next iteration (sent as an operator turn to its first stages)…"
            className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-[12px] text-[var(--color-foreground)] focus:border-[var(--color-primary)]/50 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={busy || input.trim().length === 0}
              className="h-auto rounded-md bg-[var(--color-primary)] px-3 py-1 text-[11.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
              onClick={() => run({ command: 'continue_with_input', instanceId: loopId, text: input.trim() }, () => { setPanel('none'); setInput(''); })}>
              Send and continue
            </Button>
            <Button type="button" variant="ghost" size="sm"
              className="h-auto rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--color-muted-foreground)] hover:bg-transparent hover:text-[var(--color-foreground)]"
              onClick={() => setPanel('none')}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-warning)]/20 pt-2.5">
        <Button type="button" variant="ghost" size="sm" disabled={busy || last < 0}
          title={last >= 0 ? `Complete the loop with iteration ${last + 1}` : 'No iteration has finished'}
          className="h-auto flex items-center gap-1.5 rounded-md bg-[var(--color-success)] px-3 py-1 text-[11.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
          onClick={() => run({ command: 'accept', instanceId: loopId })}>
          <Check className="h-3.5 w-3.5" />
          Accept{last >= 0 ? ` iteration ${last + 1}` : ''}
        </Button>
        {acceptable.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={busy} className={SECONDARY_BTN}>
                Accept iteration…
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[200px]">
              {acceptable.map((k) => {
                const score = scoreOf(k);
                return (
                  <DropdownMenuItem key={k} onSelect={() => run({ command: 'accept_iteration', instanceId: loopId, k })}>
                    Iteration {k + 1}
                    {k === last ? ' (last)' : ''}
                    {score !== null && <span className="ml-auto pl-3 tabular-nums text-[var(--color-muted-foreground)]">score {score}</span>}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {!confirmingFail ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy}
            title="Fail the loop; routing decides what the run does next"
            className="h-auto ml-auto flex items-center gap-1.5 rounded-md border border-[var(--color-danger)]/40 px-3 py-1 text-[11.5px] font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
            onClick={() => setConfirmingFail(true)}>
            <Ban className="h-3.5 w-3.5" />
            Fail
          </Button>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-danger)]">The loop fails; this cannot be undone.</span>
            <Button type="button" variant="ghost" size="sm" disabled={busy}
              className="h-auto rounded-md bg-[var(--color-danger)] px-3 py-1 text-[11.5px] font-semibold text-white hover:brightness-110"
              onClick={() => { setConfirmingFail(false); run({ command: 'fail', instanceId: loopId }); }}>
              Confirm fail
            </Button>
            <Button type="button" variant="ghost" size="sm"
              className="h-auto rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--color-muted-foreground)] hover:bg-transparent hover:text-[var(--color-foreground)]"
              onClick={() => setConfirmingFail(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
