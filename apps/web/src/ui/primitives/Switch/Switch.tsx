// ────────────────────────────────────────────────────────────────
// P-22 Switch (03 §2 P-22; Base UI Switch; Rosetta `.sw`, `.sw.on`).
//
// 28×16 pill track, 12px circle thumb inset 2px. Off: track `bg-line-strong`
// (≥ 3:1 on every surface, D-12), thumb `bg-surface`; on: track `bg-accent`,
// thumb `bg-on-accent` moved 12px right (left 14). `role="switch"` comes from
// Base UI. The 16px-high track keeps a 24×24 hit area (`hitSlop`). With
// `label` it renders inside a <label> row (ui text, gap 8), like Checkbox.
// A switch applies immediately — no Save, no dirty state ("Checkboxes wait
// for Save; switches apply now").
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { cn } from '../../lib/cn.js';
import { focusRing, hitSlop, HIT_ATTRS } from '../../lib/focus.js';

export interface SwitchProps
  extends Omit<ComponentProps<typeof BaseSwitch.Root>, 'className' | 'onCheckedChange' | 'children'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Visible label; without it pass `aria-label`. */
  label?: ReactNode;
  className?: string;
}

/** An on/off setting that applies immediately. */
export function Switch({ checked, onCheckedChange, label, className, disabled, ...rest }: SwitchProps) {
  const control = (
    <BaseSwitch.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onCheckedChange?.(next)}
      className={cn(
        'inline-flex w-7 shrink-0 cursor-pointer items-center rounded-full bg-line-strong p-0.5 transition-control',
        'data-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-45',
        hitSlop,
        focusRing,
        !label && className,
      )}
      {...HIT_ATTRS}
      {...rest}
    >
      <BaseSwitch.Thumb className="size-3 rounded-full bg-surface data-checked:translate-x-3 data-checked:bg-on-accent" />
    </BaseSwitch.Root>
  );
  if (!label) return control;
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-ui text-fg select-none',
        disabled && 'cursor-not-allowed text-fg-3',
        className,
      )}
    >
      {control}
      {label}
    </label>
  );
}
