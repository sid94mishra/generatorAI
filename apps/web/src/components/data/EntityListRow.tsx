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
import { Link } from 'react-router-dom';

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
  /**
   * Destination when the row IS a navigation, which for a list of entities it
   * almost always is.
   *
   * Rows used to be a `div role="button"` with an `onClick` that called
   * `navigate()`. That looks identical and behaves like a dead end: no
   * middle-click to open in a new tab, no ctrl/cmd-click, no "copy link
   * address", no status-bar preview of where the row goes, and nothing for a
   * screen reader to announce as a link. Passing `href` renders a real
   * anchor stretched over the row, so all of that works and the browser does
   * the navigating.
   *
   * `actions` and `trailing` stay above the overlay, so their buttons keep
   * receiving their own clicks. Prefer `href` over `onClick` whenever the row
   * leads somewhere.
   */
  href?: string;
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
  href,
  className,
  'data-testid': dataTestId,
}: EntityListRowProps) {
  // A row that navigates is a link; one that only acts stays a button.
  const interactive = Boolean(href) || Boolean(onClick);

  return (
    <div
      role={!href && onClick ? 'button' : undefined}
      tabIndex={!href && onClick ? 0 : undefined}
      onClick={href ? undefined : onClick}
      onKeyDown={
        !href && onClick
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
        // `relative` anchors the stretched link overlay when `href` is set.
        href && 'relative',
        size === 'sm' ? 'gap-3 p-3' : 'gap-4 p-4',
        interactive &&
          'cursor-pointer hover:border-primary focus-within:border-primary',
        !href && onClick &&
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {leading && <div className="shrink-0">{leading}</div>}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {href ? (
            // `after:absolute after:inset-0` stretches this anchor's hit area
            // over the whole row, so the row is clickable exactly as before
            // while still being a real link. The anchor itself stays inline so
            // the title's layout is unchanged.
            <Link
              to={href}
              className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring flex min-w-0 items-center gap-2"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </div>
        {description && (
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        )}
      </div>

      {/* `relative` keeps these above the stretched link overlay, so their
          own buttons still receive clicks rather than navigating the row. */}
      {trailing && <div className="relative flex shrink-0 items-center gap-2">{trailing}</div>}

      {actions && (
        <div className="relative flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}
