// ────────────────────────────────────────────────────────────────
// Toolbar — standard sub-header row for search / filters / actions.
// Children flow left-to-right; the optional `end` slot is pushed to
// the right edge.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Right-aligned slot (view toggles, secondary actions). */
  end?: React.ReactNode;
}

export function Toolbar({ end, className, children, ...props }: ToolbarProps) {
  return (
    <div className={cn('flex items-center gap-3', className)} {...props}>
      {children}
      {end && <div className="ml-auto flex shrink-0 items-center gap-2">{end}</div>}
    </div>
  );
}
