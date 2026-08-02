// ────────────────────────────────────────────────────────────────
// PageHeader — canonical page title bar (title + subtitle + actions).
// Replaces the hand-rolled headers across ~14 pages.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned action buttons. */
  actions?: React.ReactNode;
  /** Optional leading element (back button, icon). */
  leading?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions, leading, className, children }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {leading}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[var(--color-foreground)]">{title}</h1>
            {subtitle && (
              <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
