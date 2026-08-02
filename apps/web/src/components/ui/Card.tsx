// ────────────────────────────────────────────────────────────────
// Card — canonical surface primitive (replaces ad-hoc `.glass-card`)
// `interactive` adds hover affordance for clickable cards.
// ────────────────────────────────────────────────────────────────

import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils.js';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds hover background + pointer affordance for clickable cards */
  interactive?: boolean;
  /** Adds a subtle primary-tinted border (used for "system" entities) */
  accent?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, accent = false, className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border bg-card',
        accent
          ? 'border-[color-mix(in_srgb,var(--primary)_20%,var(--border))]'
          : 'border-border',
        'transition-colors duration-150',
        interactive &&
          'cursor-pointer hover:bg-subtle hover:border-[color-mix(in_srgb,var(--primary)_30%,var(--border))]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
