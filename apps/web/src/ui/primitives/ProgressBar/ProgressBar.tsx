// ────────────────────────────────────────────────────────────────
// P-38 ProgressBar / Meter (03 §2 P-38; Base UI Progress, Meter).
//
// `h-meter` (4px, both densities — a bar has no hit target to shrink; the
// token was added for this component, D-15/D-08 had no 4px height), `rounded-full`
// (radius 2 at that height — no named step is that small). Track `bg-selected`; fill `bg-run` (`kind="progress"`, task/run
// completion) or, for `kind="meter"` (a bounded resource: disk, budget),
// `bg-fg-3` neutral or an auto tone from the percentage (`warn` ≥ 80%, `err`
// ≥ 95%) unless `tone` overrides it. `size="inline"`: 40×4, no label row (the
// run-budget mini meter) — `label` still names the control via `aria-label`
// on the root. `size="block"` (default): a label row above the bar —
// `label` (`text-small text-fg-2`) and the formatted value
// (`font-mono text-micro text-fg-3`).
// ────────────────────────────────────────────────────────────────

import { Meter as BaseMeter } from '@base-ui/react/meter';
import { Progress as BaseProgress } from '@base-ui/react/progress';
import { cn } from '../../lib/cn.js';

export type ProgressTone = 'run' | 'neutral' | 'warn' | 'err';

const FILL: Record<ProgressTone, string> = { run: 'bg-run', neutral: 'bg-fg-3', warn: 'bg-warn', err: 'bg-err' };

function autoTone(kind: 'progress' | 'meter', tone: ProgressTone | undefined, percentage: number | null): ProgressTone {
  if (tone) return tone;
  if (kind === 'progress') return 'run';
  if (percentage == null) return 'neutral';
  if (percentage >= 95) return 'err';
  if (percentage >= 80) return 'warn';
  return 'neutral';
}

export interface ProgressBarProps {
  /** `null` renders an indeterminate `kind="progress"` bar. */
  value: number | null;
  max?: number;
  tone?: ProgressTone;
  /** Accessible name; shown as the visible label in `size="block"`. */
  label: string;
  kind?: 'progress' | 'meter';
  size?: 'inline' | 'block';
  className?: string;
}

/** A bounded-progress or fixed-resource bar with an accessible label. */
export function ProgressBar({ value, max = 100, tone, label, kind = 'progress', size = 'block', className }: ProgressBarProps) {
  const percentage = value == null ? null : Math.min(100, Math.max(0, (value / max) * 100));
  const resolvedTone = autoTone(kind, tone, percentage);

  if (kind === 'meter') {
    return (
      <BaseMeter.Root value={value ?? 0} max={max} aria-label={label} className={cn('flex flex-col gap-1', className)}>
        {size === 'block' ? (
          <div className="flex items-center justify-between gap-2">
            <BaseMeter.Label className="text-small text-fg-2">{label}</BaseMeter.Label>
            <BaseMeter.Value className="font-mono text-micro text-fg-3" />
          </div>
        ) : null}
        <BaseMeter.Track className={cn('relative h-meter overflow-hidden rounded-full bg-selected', size === 'inline' ? 'w-10' : 'w-full')}>
          <BaseMeter.Indicator className={cn('absolute inset-y-0 rounded-full', FILL[resolvedTone])} />
        </BaseMeter.Track>
      </BaseMeter.Root>
    );
  }

  return (
    <BaseProgress.Root value={value} max={max} aria-label={label} className={cn('flex flex-col gap-1', className)}>
      {size === 'block' ? (
        <div className="flex items-center justify-between gap-2">
          <BaseProgress.Label className="text-small text-fg-2">{label}</BaseProgress.Label>
          <BaseProgress.Value className="font-mono text-micro text-fg-3" />
        </div>
      ) : null}
      <BaseProgress.Track className={cn('relative h-meter overflow-hidden rounded-full bg-selected', size === 'inline' ? 'w-10' : 'w-full')}>
        <BaseProgress.Indicator className={cn('absolute inset-y-0 rounded-full data-indeterminate:animate-pulse', FILL[resolvedTone])} />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
