// ────────────────────────────────────────────────────────────────
// A labelled inspector row that leaves the control's own accessible name
// alone. `InspectorRow` wraps its control in a Base UI Field, which labels
// every wrapped control by the visible label (aria-labelledby wins over
// aria-label), so a control whose name specs rely on ("stage provider",
// "Context mode", "Retry jitter") sits in this row instead: the same 100px
// label column, the label is plain text and the control keeps its
// `aria-label`.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '@/ui/lib/cn.js';

export interface RowProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Stack the label over the control (wide editors). */
  stacked?: boolean;
  optional?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Label column (100px, or above) + control + muted hint. */
export function Row({ label, hint, stacked = false, optional = false, className, children }: RowProps) {
  return (
    <div className={cn('flex', stacked ? 'flex-col gap-1.5' : 'flex-row items-start gap-3', className)}>
      <span className={cn('text-small font-medium text-fg-2', !stacked && 'w-25 shrink-0 pt-1.5')}>
        {label}
        {optional ? <span className="ml-1 font-normal text-fg-3">(optional)</span> : null}
      </span>
      <div className={cn('flex flex-col gap-1.5', !stacked && 'min-w-0 flex-1')}>
        {children}
        {hint != null ? <p className="text-small text-fg-3">{hint}</p> : null}
      </div>
    </div>
  );
}
