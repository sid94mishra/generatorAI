// ────────────────────────────────────────────────────────────────
// P-03 IconButton (03 §2 P-03; Rosetta `.ib`, `.ib.ib-sm`, `.ib.on`, 32px rail
// `.ib`, accent Send button).
//
// A square button with one Icon (16; 14 in sm) and a REQUIRED `label`, which
// becomes the accessible name. Sizes sm 24 / md 28 / lg 32 (compact −4; sm
// then draws at 20 and keeps a 24px hit area through `hitSlop`). `pressed` is
// the `.ib.on` selected look (dock toggle). `badge` sits in the top-right
// corner (a StatusDot or a Count bubble for rail counters). By default a
// Tooltip (P-28) repeats the label (+ `shortcut`); `tooltip={false}` turns it
// off, a string replaces the text. `loading` swaps the glyph for the Spinner
// inside a `role="status"` span (a per-row busy state, e.g. the Changes
// dock's Keep while its request runs); it does not disable the button.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing, hitSlop, HIT_ATTRS } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';
import { Spinner } from '../Spinner/Spinner.js';
import { Tooltip } from '../Tooltip/Tooltip.js';

export const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 cursor-pointer items-center justify-center border border-transparent select-none',
    'transition-control disabled:cursor-not-allowed disabled:text-fg-3',
    'aria-pressed:bg-selected aria-pressed:text-fg aria-pressed:hover:not-disabled:bg-selected',
    focusRing,
  ],
  {
    variants: {
      variant: {
        ghost: 'bg-transparent text-fg-2 hover:not-disabled:bg-hover hover:not-disabled:text-fg',
        // The Send / Start button: accent fill, card radius (overrides the size radius).
        primary: 'bg-accent text-on-accent hover:not-disabled:bg-accent/90 disabled:text-on-accent disabled:opacity-45',
      },
      tone: {
        neutral: '',
        // Rail counters (Needs you / Running).
        warn: 'text-warn hover:not-disabled:text-warn',
        run: 'text-run hover:not-disabled:text-run',
      },
      size: {
        sm: cn('size-control-sm rounded-control-sm', hitSlop),
        md: 'relative size-control rounded-control',
        lg: 'relative size-control-lg rounded-control',
      },
    },
    compoundVariants: [{ variant: 'primary', className: 'rounded-card' }],
    defaultVariants: { variant: 'ghost', tone: 'neutral', size: 'md' },
  },
);

export type IconButtonSize = NonNullable<VariantProps<typeof iconButtonVariants>['size']>;

export interface IconButtonProps extends Omit<useRender.ComponentProps<'button'>, 'children'> {
  icon: IconConcept;
  /** Accessible name and tooltip text. Required: the button has no visible text. */
  label: string;
  size?: IconButtonSize;
  variant?: 'ghost' | 'primary';
  tone?: 'neutral' | 'warn' | 'run';
  /** Toggle state (`.ib.on`): sets `aria-pressed` and the selected look. */
  pressed?: boolean;
  /** Corner badge: a StatusDot (`ring`) or a Count bubble. */
  badge?: ReactNode;
  /** Tooltip: `true` (default) shows `label`, a string replaces it, `false` hides it. */
  tooltip?: boolean | string;
  /** Shortcut chord shown in the tooltip. */
  shortcut?: readonly string[];
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  /** Busy: the Spinner (in a `role="status"` span) replaces the glyph. */
  loading?: boolean;
}

/** A square icon-only button with a required accessible `label`. */
export function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  tone = 'neutral',
  pressed,
  badge,
  tooltip = true,
  shortcut,
  tooltipSide = 'top',
  loading = false,
  render,
  ref,
  className,
  type,
  ...rest
}: IconButtonProps) {
  const ownProps = {
    className: cn(iconButtonVariants({ variant, tone, size }), className),
    'aria-label': label,
    ...(size === 'sm' ? HIT_ATTRS : {}),
    ...(render ? {} : { type: type ?? 'button' }),
    ...(pressed !== undefined ? { 'aria-pressed': pressed } : {}),
    ...(loading ? { 'aria-busy': true } : {}),
    children: (
      <>
        {loading ? (
          <span role="status" aria-label="Working" className="flex">
            <Spinner size={size === 'sm' ? 14 : 16} />
          </span>
        ) : (
          <Icon concept={icon} size={size === 'sm' ? 14 : 16} />
        )}
        {badge != null ? (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 flex">{badge}</span>
        ) : null}
      </>
    ),
  };
  const element = useRender({ defaultTagName: 'button', render, ref, props: mergeProps<'button'>(rest, ownProps) });
  if (tooltip === false) return element;
  return (
    <Tooltip content={typeof tooltip === 'string' ? tooltip : label} shortcut={shortcut} side={tooltipSide}>
      {element}
    </Tooltip>
  );
}
