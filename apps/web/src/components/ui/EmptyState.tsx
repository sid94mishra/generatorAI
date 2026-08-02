// ────────────────────────────────────────────────────────────────
// EmptyState — canonical empty/zero-data state (icon + title + hint +
// optional action). Replaces the bespoke empty blocks across ~10 pages.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {icon && <div className="mb-3 text-[var(--color-muted-foreground)]">{icon}</div>}
      <h3 className="text-sm font-medium text-[var(--color-foreground)]">{title}</h3>
      {hint && <p className="mt-1 max-w-sm text-xs text-[var(--color-muted-foreground)]">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
