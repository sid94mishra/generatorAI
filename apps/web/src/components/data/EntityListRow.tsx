// ────────────────────────────────────────────────────────────────
// EntityListRow — the one row anatomy for list views (chats,
// automations, recent runs…):
//
//   [leading] Title / description  [trailing] [actions]
//
// `leading` is an icon chip or status dot; `trailing` holds badges
// or timestamps (always visible); `actions` are hover-revealed.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';

export type EntityListRowSize = 'sm' | 'md';

export interface EntityListRowProps {
  /** Leading icon chip or status dot */
  leading?: React.ReactNode;
  title: React.ReactNode;
  /** Secondary line under the title */
  description?: React.ReactNode;
  /** Always-visible right-side content (badges / timestamps) */
  trailing?: React.ReactNode;
  /** Hover-revealed action buttons (also revealed on focus-within) */
  actions?: React.ReactNode;
  /** Density: `md` (default) for list pages, `sm` for compact sidebars */
  size?: EntityListRowSize;
  onClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
  className?: string;
  'data-testid'?: string;
}

export function EntityListRow({
  leading,
  title,
  description,
  trailing,
  actions,
  size = 'md',
  onClick,
  className,
  'data-testid': dataTestId,
}: EntityListRowProps) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e);
              }
            }
          : undefined
      }
      data-testid={dataTestId}
      className={cn(
        'group flex items-center rounded-lg border border-border bg-card transition-colors',
        size === 'sm' ? 'gap-3 p-3' : 'gap-4 p-4',
        onClick &&
          'cursor-pointer hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {leading && <div className="shrink-0">{leading}</div>}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {title}
        </div>
        {description && (
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        )}
      </div>

      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}

      {actions && (
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}
