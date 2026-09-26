// ────────────────────────────────────────────────────────────────
// WF-06 BudgetMeter — the run's usage against its budget (P07 WP-7.3), in
// the run header's second row: a ghost trigger "118 turns · 1.4M tokens ·
// $3.12 of $10" with an inline meter for the tightest limit, and a popover
// with one meter per dimension (turns, tokens, wall clock, cost).
//
// Dollars appear only when a provider reported cost (`usage.costUsd`, D-81);
// otherwise tokens are the spend (tokens-only, D-35). No pricing table, so
// nothing is an estimate.
// ────────────────────────────────────────────────────────────────

import type { RunUsage } from '@generatorai/shared';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { ProgressBar } from '@/ui/primitives/ProgressBar/ProgressBar.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { compactCount, formatDuration, formatUsd, limitOf } from '../model/format.js';

export interface BudgetItem {
  key: 'turns' | 'tokens' | 'wall' | 'cost';
  label: string;
  /** The number the meter compares (turns, tokens, ms, dollars). */
  used: number;
  limit?: number;
  usedText: string;
  limitText?: string;
  over: boolean;
}

/**
 * The dimensions a run's usage is shown in: turns and tokens always, wall
 * clock only when the budget limits it, cost only when a provider reported it.
 */
export function budgetItems(usage: RunUsage | undefined, budget: Record<string, unknown> | undefined, elapsedMs: number): BudgetItem[] {
  const item = (
    key: BudgetItem['key'],
    label: string,
    used: number,
    limit: number | undefined,
    fmt: (n: number) => string,
  ): BudgetItem => ({
    key,
    label,
    used,
    usedText: fmt(used),
    ...(limit !== undefined ? { limit, limitText: fmt(limit) } : {}),
    over: limit !== undefined && used >= limit,
  });
  const items = [
    item('turns', 'turns', usage?.turns ?? 0, limitOf(budget, 'maxTurns'), (n) => String(Math.round(n))),
    item('tokens', 'tokens', (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0), limitOf(budget, 'maxTokens'), compactCount),
  ];
  const maxWall = limitOf(budget, 'maxWallClockMs');
  if (maxWall !== undefined) items.push(item('wall', 'wall clock', elapsedMs, maxWall, formatDuration));
  if (typeof usage?.costUsd === 'number') items.push(item('cost', 'reported cost', usage.costUsd, limitOf(budget, 'maxCostUsd'), formatUsd));
  return items;
}

/** The limited dimension closest to its limit (drives the trigger's inline meter), if any. */
export function tightestItem(items: readonly BudgetItem[]): BudgetItem | undefined {
  let best: BudgetItem | undefined;
  for (const i of items) {
    if (i.limit === undefined || i.limit <= 0) continue;
    if (!best || i.used / i.limit > best.used / (best.limit ?? 1)) best = i;
  }
  return best;
}

function triggerText(i: BudgetItem): string {
  if (i.key === 'cost') return i.limitText ? `${i.usedText} of ${i.limitText}` : i.usedText;
  if (i.key === 'wall') return i.limitText ? `${i.usedText} of ${i.limitText}` : i.usedText;
  return i.limitText ? `${i.usedText}/${i.limitText} ${i.label}` : `${i.usedText} ${i.label}`;
}

export interface BudgetMeterProps {
  usage?: RunUsage | undefined;
  budget?: Record<string, unknown> | undefined;
  elapsedMs: number;
}

export function BudgetMeter({ usage, budget, elapsedMs }: BudgetMeterProps) {
  const items = budgetItems(usage, budget, elapsedMs);
  const tight = tightestItem(items);
  const summary = items.map(triggerText).join(' · ');
  return (
    <PopoverRoot>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            icon="activity"
            aria-label={`Run usage: ${summary}`}
            data-testid="run-budget"
            className="min-w-0 gap-1.5 font-mono text-micro text-fg-2 data-popup-open:bg-selected"
          />
        }
      >
        <span className="truncate tabular-nums">{summary}</span>
        {tight ? (
          <ProgressBar kind="meter" size="inline" value={tight.used} max={tight.limit ?? 1} label={`Budget: ${tight.label}`} />
        ) : null}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" className="flex w-72 flex-col gap-2.5 p-3" data-testid="run-budget-popover">
        <PopoverTitle className="text-ui font-semibold text-fg">Run budget</PopoverTitle>
        {items.map((i) =>
          i.limit !== undefined ? (
            <ProgressBar
              key={i.key}
              kind="meter"
              value={i.used}
              max={i.limit}
              label={`${i.label[0]?.toUpperCase()}${i.label.slice(1)}: ${i.usedText} of ${i.limitText}`}
            />
          ) : (
            <div key={i.key} className="flex items-center justify-between gap-2 text-small">
              <span className="text-fg-2">{`${i.label[0]?.toUpperCase()}${i.label.slice(1)}`}</span>
              <span className={cn('font-mono text-micro tabular-nums', i.over ? 'text-err' : 'text-fg')}>{i.usedText}</span>
            </div>
          ),
        )}
        {typeof usage?.costUsd !== 'number' ? (
          <p className="text-small text-fg-3">No provider reported a cost for this run, so tokens are the spend.</p>
        ) : null}
      </PopoverPopup>
    </PopoverRoot>
  );
}
