// ────────────────────────────────────────────────────────────────
// C-26 ChoiceCardGrid (03 §3 C-26): ChatCreate "Who works", AutomationCreate
// trigger, WorkflowNew start.
//
// A P-23 RadioGroup laid out as a grid of P-24 RadioCards: `grid-cols-<n>`
// gap 12 when `columns` is given, else an even flex row (`flex-1 1 0` gap 10)
// that wraps.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { RadioGroup } from '../../primitives/RadioGroup/RadioGroup.js';
import { RadioCard } from '../../primitives/RadioCard/RadioCard.js';

export interface ChoiceCardOption {
  value: string;
  icon?: IconConcept;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface ChoiceCardGridProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly ChoiceCardOption[];
  columns?: number;
  /** Accessible name of the group. */
  label: string;
  className?: string;
}

/** A RadioGroup of RadioCards, in a fixed grid or an even wrapping row. */
export function ChoiceCardGrid({ value, onValueChange, options, columns, label, className }: ChoiceCardGridProps) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => onValueChange(next as string)}
      className={cn(columns != null ? 'grid gap-3' : 'flex flex-wrap gap-2.5', className)}
      style={columns != null ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option) => (
        <RadioCard
          key={option.value}
          value={option.value}
          icon={option.icon}
          title={option.title}
          description={option.description}
          disabled={option.disabled}
          className={columns == null ? 'min-w-0 flex-1 basis-0' : undefined}
        />
      ))}
    </RadioGroup>
  );
}
