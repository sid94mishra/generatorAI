// ────────────────────────────────────────────────────────────────
// C-14 FormSection (03 §3 C-14): ChatCreate*, AgentEditor, AutomationCreate.
//
// pad 16 0, border-t `line-soft` (not on the `first` section), gap 12:
// header (`text-title` 600 + a baseline `hint`), body — a 1–4 column grid of
// fields (`columns`, gap 12/16).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface FormSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode;
  hint?: ReactNode;
  /** Field grid columns. Default 1 (a single stacked column). */
  columns?: 1 | 2 | 3 | 4;
  /** No top border/padding (the section is first in its form). */
  first?: boolean;
}

const COLUMNS: Record<NonNullable<FormSectionProps['columns']>, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

/** A titled group of fields laid out in a 1–4 column grid. */
export function FormSection({ title, hint, columns = 1, first = false, className, children, ...rest }: FormSectionProps) {
  return (
    <section className={cn('flex flex-col gap-3 py-4', !first && 'border-t border-line-soft', className)} {...rest}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-title font-semibold text-fg">{title}</h2>
        {hint != null ? <span className="text-small text-fg-3">{hint}</span> : null}
      </div>
      <div className={cn('grid gap-4', COLUMNS[columns])}>{children}</div>
    </section>
  );
}
