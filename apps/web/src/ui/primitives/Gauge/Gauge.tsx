// ────────────────────────────────────────────────────────────────
// P-39 Gauge — the context ring (03 §2 P-39; Base UI Meter; Rosetta
// "14px SVG circle r6 + arc + '42%'").
//
// 14×14 SVG (16×16 at `size={16}`), r 6 (7), stroke 2: track
// `stroke-line-strong`, arc `stroke-fg-2`, or `stroke-warn` / `stroke-err`
// when the caller passes a threshold `tone`. The arc is a dash on the
// circle's circumference, starting at 12 o'clock. `showLabel` adds the
// percentage in `font-mono text-micro` NEXT TO the ring (the board draws
// "42%" beside it; 14px is too small to hold text inside). The Meter carries
// `role="meter"`, the value and `label` as its accessible name; the visible
// percentage is hidden from assistive tech (it repeats aria-valuetext).
// Usually composed inside a ghost sm Button that opens a Popover — that
// composition lives in the consumer, not here.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { Meter as BaseMeter } from '@base-ui/react/meter';
import { cn } from '../../lib/cn.js';

export type GaugeSize = 14 | 16;
export type GaugeTone = 'warn' | 'err';

const STROKE = 2;

/** Ring geometry for a gauge of `size` px: centre, radius and circumference. */
export function gaugeGeometry(size: GaugeSize): { center: number; radius: number; circumference: number } {
  const radius = size / 2 - STROKE / 2;
  return { center: size / 2, radius, circumference: 2 * Math.PI * radius };
}

/** Filled fraction of the ring, clamped to 0…1 (NaN, negative and `max ≤ 0` → 0). */
export function gaugeFraction(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/** `stroke-dashoffset` that leaves `fraction` of `circumference` drawn. */
export function gaugeOffset(value: number, max: number, circumference: number): number {
  return circumference * (1 - gaugeFraction(value, max));
}

const ARC_TONE: Record<GaugeTone | 'default', string> = {
  default: 'stroke-fg-2',
  warn: 'stroke-warn',
  err: 'stroke-err',
};

const LABEL_TONE: Record<GaugeTone | 'default', string> = {
  default: '',
  warn: 'text-warn',
  err: 'text-err',
};

export interface GaugeProps
  extends Omit<ComponentProps<typeof BaseMeter.Root>, 'className' | 'value' | 'max' | 'min' | 'children' | 'render'> {
  value: number;
  /** Upper bound; 100 by default. */
  max?: number;
  size?: GaugeSize;
  /** Show the percentage beside the ring. */
  showLabel?: boolean;
  /** Accessible name, e.g. "Context window". */
  label: string;
  /** Threshold colouring decided by the caller. */
  tone?: GaugeTone;
  className?: string;
}

/** A small ring meter (context usage). Inline: renders a <span>, safe inside a Button. */
export function Gauge({
  value,
  max = 100,
  size = 14,
  showLabel = false,
  label,
  tone,
  className,
  ...rest
}: GaugeProps) {
  const { center, radius, circumference } = gaugeGeometry(size);
  const key = tone ?? 'default';
  return (
    <BaseMeter.Root
      value={value}
      max={max}
      aria-label={label}
      render={<span />}
      className={cn('inline-flex shrink-0 items-center gap-1', className)}
      {...rest}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        aria-hidden
        className="shrink-0 -rotate-90"
      >
        <circle cx={center} cy={center} r={radius} strokeWidth={STROKE} className="stroke-line-strong" />
        <circle
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={STROKE}
          strokeDasharray={circumference}
          strokeDashoffset={gaugeOffset(value, max, circumference)}
          className={ARC_TONE[key]}
        />
      </svg>
      {showLabel ? (
        <BaseMeter.Value className={cn('font-mono text-micro tabular-nums', LABEL_TONE[key])} />
      ) : null}
    </BaseMeter.Root>
  );
}
