// ────────────────────────────────────────────────────────────────
// P-23 RadioGroup / Radio (03 §2 P-23; Base UI RadioGroup + Radio; Rosetta
// `role=radio` / `radiogroup`).
//
// Radio: 14px circle, 1px `border-line-strong`; checked widens the border to
// 4px `border-accent` (the Components board version — AutomationCreate's
// ring+dot draws the same idea two ways, this is the one to use). Label 13px,
// gap 8. `variant="swatch"` (Settings › Accent, P6): a 20px circle filled
// with the caller's colour (`swatchClassName`, e.g. `bg-run`); unchecked a
// 1px inset `line` ring, checked a 2px `fg` ring with a 2px `overlay` offset
// (the halo the board draws as two nested box-shadows).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { Radio as BaseRadio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { cn } from '../../lib/cn.js';
import { focusRing, hitSlop, HIT_ATTRS } from '../../lib/focus.js';

export interface RadioGroupProps extends Omit<ComponentProps<typeof BaseRadioGroup>, 'className'> {
  orientation?: 'vertical' | 'horizontal';
  className?: string;
  children?: ReactNode;
}

/** Groups Radio items; `value` / `onValueChange` hold the choice. */
export function RadioGroup({ orientation = 'vertical', className, children, ...rest }: RadioGroupProps) {
  return (
    <BaseRadioGroup
      className={cn('flex gap-2', orientation === 'horizontal' ? 'flex-row items-center gap-4' : 'flex-col', className)}
      {...rest}
    >
      {children}
    </BaseRadioGroup>
  );
}

export interface RadioProps extends Omit<ComponentProps<typeof BaseRadio.Root>, 'className'> {
  label?: ReactNode;
  variant?: 'default' | 'swatch';
  /** Fill colour for `variant="swatch"` (a `bg-*` design class, e.g. `bg-run`). */
  swatchClassName?: string;
  className?: string;
}

/** One choice in a RadioGroup. */
export function Radio({ label, variant = 'default', swatchClassName, className, disabled, ...rest }: RadioProps) {
  const control =
    variant === 'swatch' ? (
      <BaseRadio.Root
        disabled={disabled}
        className={cn(
          'inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full ring-1 ring-line transition-control',
          'data-checked:ring-2 data-checked:ring-fg data-checked:ring-offset-2 data-checked:ring-offset-overlay',
          'data-disabled:cursor-not-allowed data-disabled:opacity-45',
          swatchClassName,
          hitSlop,
          focusRing,
          className,
        )}
        {...HIT_ATTRS}
        {...rest}
      />
    ) : (
      <BaseRadio.Root
        disabled={disabled}
        className={cn(
          'box-border inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface transition-control',
          'data-checked:border-4 data-checked:border-accent',
          'data-disabled:cursor-not-allowed data-disabled:opacity-45',
          hitSlop,
          focusRing,
          className,
        )}
        {...HIT_ATTRS}
        {...rest}
      />
    );
  if (!label) return control;
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-ui text-fg select-none',
        disabled && 'cursor-not-allowed text-fg-3',
      )}
    >
      {control}
      {label}
    </label>
  );
}
