// ────────────────────────────────────────────────────────────────
// P-24 RadioCard (03 §2 P-24). Lives inside a P-23 RadioGroup; renders a
// Radio as a card (`render={<div/>}` — D-05, Base UI's `render` in place of
// Radix `asChild`).
//
// `variant="card"` (default; ChatCreate "Who works", AutomationCreate
// trigger, WorkflowNew start): pad 10, card radius, 1px `border-line`,
// `bg-raised`; top row: 16px icon · a decorative radio dot `ml-auto` (mirrors
// P-23's own look via `group-data-checked:`); title `text-ui` 600;
// description `text-micro text-fg-3` lh 1.3. Checked: `border-accent
// bg-selected`.
// `variant="tile"` (SettingsAppearance theme picker, P6): `h-tile` (96,
// added for this component — no 96px step existed), pad 4, a `preview` slot
// (`flex-1`, `rounded-control-sm`) and an `h-step` (28) caption row with a
// check indicator; checked: a 2px `fg` ring, transparent border.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { Radio as BaseRadio } from '@base-ui/react/radio';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';

export interface RadioCardProps {
  value: string;
  icon?: IconConcept;
  title: ReactNode;
  description?: ReactNode;
  variant?: 'card' | 'tile';
  /** `variant="tile"`: the 58h preview slot (a theme swatch). */
  preview?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** A radio choice rendered as a selectable card. */
export function RadioCard({ value, icon, title, description, variant = 'card', preview, disabled, className }: RadioCardProps) {
  if (variant === 'tile') {
    return (
      <BaseRadio.Root
        value={value}
        disabled={disabled}
        render={<div />}
        className={cn(
          'flex h-tile w-full cursor-pointer flex-col overflow-hidden rounded-card border border-transparent p-1 transition-control',
          'data-checked:ring-2 data-checked:ring-fg',
          'data-disabled:cursor-not-allowed data-disabled:opacity-45',
          focusRing,
          className,
        )}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-control-sm bg-sunken">{preview}</div>
        <div className="flex h-step shrink-0 items-center justify-between gap-1 px-1 text-small font-medium text-fg">
          <span className="min-w-0 truncate">{title}</span>
          <BaseRadio.Indicator className="flex shrink-0 text-fg">
            <Icon concept="check" size={14} />
          </BaseRadio.Indicator>
        </div>
      </BaseRadio.Root>
    );
  }
  return (
    <BaseRadio.Root
      value={value}
      disabled={disabled}
      render={<div />}
      className={cn(
        'group flex w-full cursor-pointer flex-col gap-2 rounded-card border border-line bg-raised p-2.5 text-left text-fg transition-control',
        'data-checked:border-accent data-checked:bg-selected',
        'data-disabled:cursor-not-allowed data-disabled:opacity-45',
        focusRing,
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon ? <Icon concept={icon} size={16} className="text-fg-2" /> : null}
        <span
          aria-hidden
          className={cn(
            'ml-auto box-border inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface transition-control',
            'group-data-checked:border-4 group-data-checked:border-accent',
          )}
        />
      </div>
      <div className="text-ui font-semibold">{title}</div>
      {description != null ? <div className="text-micro/tight text-fg-3">{description}</div> : null}
    </BaseRadio.Root>
  );
}
