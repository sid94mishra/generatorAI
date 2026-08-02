// ────────────────────────────────────────────────────────────────
// EntityCard — the one card anatomy for grid views (projects,
// scripts, templates…). Built on the canonical <Card> primitive:
//
//   ┌──────────────────────────────┐
//   │ [icon] Title       [actions] │  ← actions revealed on hover
//   │ description (2-line clamp)   │
//   │ …children (extra body)…      │
//   │ meta row (badges/dates)      │
//   └──────────────────────────────┘
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Card } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';

export interface EntityCardProps {
  /** Leading icon, shown before the title */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** Secondary text under the title (2-line clamp) */
  description?: React.ReactNode;
  /** Footer row of badges / dates / counts */
  meta?: React.ReactNode;
  /** Hover-revealed actions, top-right (also revealed on focus-within) */
  actions?: React.ReactNode;
  /** Primary-tinted border for "system" entities (see Card) */
  accent?: boolean;
  onClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
  className?: string;
  /** Extra body content rendered between description and meta */
  children?: React.ReactNode;
  'data-testid'?: string;
}

export function EntityCard({
  icon,
  title,
  description,
  meta,
  actions,
  accent = false,
  onClick,
  className,
  children,
  'data-testid': dataTestId,
}: EntityCardProps) {
  return (
    <Card
      interactive={!!onClick}
      accent={accent}
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
        'group relative flex h-full flex-col p-4',
        onClick && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && <span className="shrink-0 text-primary">{icon}</span>}
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {actions}
          </div>
        )}
      </div>

      {/* Description */}
      {description && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{description}</p>
      )}

      {/* Extra body */}
      {children}

      {/* Meta / footer row */}
      {meta && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {meta}
        </div>
      )}
    </Card>
  );
}
