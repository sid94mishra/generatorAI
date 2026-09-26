// ────────────────────────────────────────────────────────────────
// P-46 Slider (03 §2 P-46; Base UI Slider; Rosetta `role="slider"` scrubbers).
//
// A single-value scrubber: the Changes checkpoint scrubber (turn `ticks`,
// `getAriaValueText={(v) => \`Turn ${v} of 4\`}`) and the Computer replay
// scrubber. Control 20h (`h-badge`, the board's replay height; with `ticks`
// a 16px label row below brings it to ≈ 34–36, the checkpoint height), 4px
// track `bg-line`, filled part `bg-fg-2`, thumb a 12px `bg-fg` circle with a
// 2px `surface` ring. The thumb's box is 24×24 (the visible circle is
// centred inside it) so the focusable range input Base UI renders at the
// thumb's size meets the 24×24 target. Base UI's range input is visually
// hidden, so keyboard focus shows on the circle through `has-focus-visible`
// with the focus-ring recipe (2px `focus` outline, offset 2).
// `label` names the thumb (the role="slider" input); `className` styles the
// root, `trackClassName` the control row (e.g. a different height).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { cn } from '../../lib/cn.js';

export interface SliderTick {
  value: number;
  /** Short label under the track ("T1", "0:30"). */
  label: ReactNode;
}

/** Position of `value` along [min, max] in percent, clamped to 0…100. */
export function sliderPercent(value: number, min: number, max: number): number {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export interface SliderProps
  extends Omit<BaseSlider.Root.Props<number>, 'className' | 'children' | 'render' | 'onValueChange' | 'onValueCommitted'> {
  onValueChange?: (value: number) => void;
  /** Fires when a drag or key press ends. */
  onValueCommitted?: (value: number) => void;
  /** Accessible name of the thumb; or pass `aria-labelledby`. */
  label?: string;
  /** aria-valuetext for a value ("Turn 3 of 4"). */
  getAriaValueText?: (value: number) => string;
  /** Marks + labels under the track. */
  ticks?: readonly SliderTick[];
  className?: string;
  trackClassName?: string;
}

/** A horizontal single-thumb slider with optional tick labels. */
export function Slider({
  onValueChange,
  onValueCommitted,
  label,
  getAriaValueText,
  ticks,
  min = 0,
  max = 100,
  className,
  trackClassName,
  'aria-labelledby': ariaLabelledBy,
  ...rest
}: SliderProps) {
  return (
    <BaseSlider.Root<number>
      min={min}
      max={max}
      onValueChange={onValueChange ? (value) => onValueChange(value) : undefined}
      onValueCommitted={onValueCommitted ? (value) => onValueCommitted(value) : undefined}
      className={cn('flex w-full min-w-0 flex-col', className)}
      {...rest}
    >
      <BaseSlider.Control
        className={cn('flex h-badge w-full cursor-pointer touch-none items-center data-disabled:cursor-not-allowed data-disabled:opacity-45', trackClassName)}
      >
        <BaseSlider.Track className="relative min-h-1 w-full rounded-full bg-line">
          {ticks?.map((tick) => (
            <span
              key={tick.value}
              aria-hidden
              className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong"
              style={{ insetInlineStart: `${sliderPercent(tick.value, min, max)}%` }}
            />
          ))}
          <BaseSlider.Indicator className="min-h-1 rounded-full bg-fg-2" />
          <BaseSlider.Thumb
            aria-label={label}
            aria-labelledby={ariaLabelledBy}
            getAriaValueText={getAriaValueText ? (_formatted, value) => getAriaValueText(value) : undefined}
            className="group flex size-6 items-center justify-center outline-none"
          >
            <span
              className={cn(
                'size-3 rounded-full bg-fg ring-2 ring-surface',
                'group-has-focus-visible:outline-2 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-focus',
              )}
            />
          </BaseSlider.Thumb>
        </BaseSlider.Track>
      </BaseSlider.Control>
      {ticks && ticks.length > 0 ? (
        <div aria-hidden className="relative min-h-4 w-full font-mono text-micro text-fg-3">
          {ticks.map((tick) => (
            <span
              key={tick.value}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
              style={{ insetInlineStart: `${sliderPercent(tick.value, min, max)}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      ) : null}
    </BaseSlider.Root>
  );
}
