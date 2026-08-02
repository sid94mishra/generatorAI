// ────────────────────────────────────────────────────────────────
// Breadcrumb — Context-aware breadcrumb navigation
// Supports Chat, Workflow, and Run contexts
// ────────────────────────────────────────────────────────────────

import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export interface BreadcrumbItem {
  /** Display label */
  label: string;
  /** Navigation href — if omitted, renders as plain text (current page) */
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  showHome?: boolean;
  className?: string;
}

function BreadcrumbComponent({ items, showHome = true, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-xs', className)}>
      {showHome && (
        <>
          <Link
            to="/"
            className="flex items-center gap-1 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
          >
            <Home className="h-3 w-3" />
            <span>Home</span>
          </Link>
          {items.length > 0 && (
            <ChevronRight className="h-3 w-3 text-[var(--color-muted-foreground)]" />
          )}
        </>
      )}

      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${index}`}>
            {item.href && !isLast ? (
              <Link
                to={item.href}
                className="text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cn(
                  isLast
                    ? 'font-medium text-[var(--color-foreground)]'
                    : 'text-[var(--color-muted-foreground)]',
                )}
              >
                {item.label}
              </span>
            )}
            {!isLast && (
              <ChevronRight className="h-3 w-3 text-[var(--color-muted-foreground)]" />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export const Breadcrumb = memo(BreadcrumbComponent);
