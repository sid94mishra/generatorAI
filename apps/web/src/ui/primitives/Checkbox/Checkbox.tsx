// ────────────────────────────────────────────────────────────────
// P-21 Checkbox (03 §2 P-21; Base UI Checkbox; Rosetta `.cb`, `.cb.on`,
// `aria-checked="mixed"`).
//
// 14×14 (sm 12×12), badge radius, 1px `line-strong` (D-12: 3:1 on every
// surface); checked `bg-accent border-accent` with a 12px check in
// `text-on-accent`; `indeterminate` shows a minus (ChatsList select-all).
// The box keeps a 24×24 hit area (`hitSlop`). With `label` it renders inside
// a <label> row (ui text, gap 8). "Checkboxes wait for Save; switches apply now."
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { cn } from '../../lib/cn.js';
import { focusRing, hitSlop, HIT_ATTRS } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';

export interface CheckboxProps
  extends Omit<ComponentProps<typeof BaseCheckbox.Root>, 'className' | 'onCheckedChange' | 'children'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  indeterminate?: boolean;
  size?: 'sm' | 'md';
  /** Visible label; without it pass `aria-label`. */
  label?: ReactNode;
  className?: string;
}

/** A two-state (or mixed) choice that waits for Save. */
export function Checkbox({
  checked,
  onCheckedChange,
  indeterminate = false,
  size = 'md',
  label,
  className,
  disabled,
  ...rest
}: CheckboxProps) {
  const box = (
    <BaseCheckbox.Root
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      onCheckedChange={(next) => onCheckedChange?.(next)}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-badge border border-line-strong bg-transparent text-on-accent transition-control',
        'data-checked:border-accent data-checked:bg-accent data-indeterminate:border-accent data-indeterminate:bg-accent',
        'data-disabled:cursor-not-allowed data-disabled:opacity-45',
        size === 'sm' ? 'size-3' : 'size-3.5',
        hitSlop,
        focusRing,
        !label && className,
      )}
      {...HIT_ATTRS}
      {...rest}
    >
      <BaseCheckbox.Indicator className="flex data-unchecked:hidden">
        <Icon concept={indeterminate ? 'minus' : 'check'} size={12} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
  if (!label) return box;
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-ui text-fg select-none',
        disabled && 'cursor-not-allowed text-fg-3',
        className,
      )}
    >
      {box}
      {label}
    </label>
  );
}
