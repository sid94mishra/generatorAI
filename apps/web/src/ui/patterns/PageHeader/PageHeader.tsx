// ────────────────────────────────────────────────────────────────
// C-01 PageHeader — the 44px header every page renders as the first row of
// the main card (03 §3 C-01, D-21; Rosetta `<header>` 44h, border-b
// line-soft, breadcrumb/title + actions).
//
// 44h (h-bar, never density-shrunk), pad 0 10 0 16, gap 10, border-b
// line-soft. Slots in order: `breadcrumb` (C-02) or a plain `title` (ui 600),
// `status` (a StatusBadge), `meta` (chips, "Unsaved changes", mono times),
// spacer, `actions` (buttons, icon buttons, separators), `dockToggle` (an
// IconButton `pressed` while the dock is open). `subbar` adds a 38px second
// row (run header: permission menu, budget meter, gauge, trigger text).
// The shell (S-05, P3-04) applies the macOS drag region and title-bar
// insets around it; the header itself only lays out.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface PageHeaderProps extends Omit<ComponentProps<'header'>, 'title'> {
  breadcrumb?: ReactNode;
  /** Plain title when there is no breadcrumb. */
  title?: ReactNode;
  /**
   * Render `title` as the page's h1. Off by default: list and detail pages
   * put their h1 in PageTitle below; a page without one (the chat workspace)
   * turns this on.
   */
  titleIsHeading?: boolean;
  status?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  dockToggle?: ReactNode;
  /** Optional second row (38h). */
  subbar?: ReactNode;
}

/** The page's own 44px header (title or breadcrumb, status, meta, actions). */
export function PageHeader({
  breadcrumb,
  title,
  titleIsHeading = false,
  status,
  meta,
  actions,
  dockToggle,
  subbar,
  className,
  ...rest
}: PageHeaderProps) {
  return (
    <header className={cn('flex shrink-0 flex-col border-b border-line-soft', className)} {...rest}>
      <div className="flex h-bar min-w-0 items-center gap-2.5 pr-2.5 pl-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {breadcrumb ??
            (title != null ? (
              titleIsHeading ? (
                <h1 className="truncate text-ui font-semibold text-fg">{title}</h1>
              ) : (
                <span className="truncate text-ui font-semibold text-fg">{title}</span>
              )
            ) : null)}
          {status}
          {meta != null ? <div className="flex min-w-0 items-center gap-2 text-small text-fg-3">{meta}</div> : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          {dockToggle}
        </div>
      </div>
      {subbar != null ? (
        <div className="flex min-h-9.5 min-w-0 items-center gap-2.5 border-t border-line-soft pr-2.5 pl-4">{subbar}</div>
      ) : null}
    </header>
  );
}
