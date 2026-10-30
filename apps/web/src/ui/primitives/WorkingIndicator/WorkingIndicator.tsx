// ────────────────────────────────────────────────────────────────
// WorkingIndicator — an agent is working and has nothing to show yet (D-152):
// three dots in a soft wave and an optional label with a light sweep. It is
// the transcript's busy cue at the end of a live turn; the Spinner stays the
// Running glyph of a step. Both stop under "Reduce motion" (the global rule
// and `text-shimmer`'s own fallback), leaving still dots and a muted label.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.js';

export interface WorkingIndicatorProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Visible words beside the dots ("Working · 3 steps"); without it the dots stand alone. */
  label?: string;
}

const DOT = 'size-1.5 rounded-full bg-run wave-dot';

/** Busy cue: a three-dot wave plus an optional shimmering label. Announced as a status. */
export function WorkingIndicator({ label, className, ...rest }: WorkingIndicatorProps) {
  return (
    <div role="status" className={cn('flex h-step items-center gap-2 pl-0.5', className)} {...rest}>
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className={DOT} />
        <span className={cn(DOT, 'wave-delay-1')} />
        <span className={cn(DOT, 'wave-delay-2')} />
      </span>
      {label ? <span className="text-small text-shimmer">{label}</span> : null}
    </div>
  );
}
