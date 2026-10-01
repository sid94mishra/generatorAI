// ────────────────────────────────────────────────────────────────
// T-01 ListPage (03 §5 T-01): the list-page layout — slots only, no logic.
//
//   header   C-01 PageHeader (usually a plain title + a "More" icon button)
//   title    C-03 PageTitle (list variant)
//   stats?   C-10 StatStrip
//   filters  C-04 FilterBar
//   content  C-05 DataTable or a C-09 card grid
//   footer?  a note under the content
//   overlay? C-06 BulkActionBar (floats over the bottom of the page)
//
// Body pad 24 28, gap 16. Header, title, stats and filters stay put; the
// content region takes the rest and scrolls inside itself (a DataTable keeps
// its header sticky; anything else scrolls in the region). Fills its parent
// (the main card) — give the parent a height. Responsive rules follow the
// main card through container queries and DataTable `hideBelow`, never the
// window: at 1100 the table drops its `hideBelow` columns and the FilterBar
// collapses its chips (03 §5).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface ListPageProps extends Omit<ComponentProps<'div'>, 'title' | 'content'> {
  header: ReactNode;
  title: ReactNode;
  stats?: ReactNode;
  filters?: ReactNode;
  content: ReactNode;
  footer?: ReactNode;
  overlay?: ReactNode;
}

/** Page layout for entity lists (Chats, Projects, Agents …). */
export function ListPage({ header, title, stats, filters, content, footer, overlay, className, ...rest }: ListPageProps) {
  return (
    <div className={cn('relative flex h-full min-h-0 min-w-0 flex-col bg-surface text-fg', className)} {...rest}>
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-7 py-6">
        {title}
        {stats}
        {filters}
        {/* With a footer note the content takes its own height (shrinking and scrolling when long), so the note
            sits under the rows rather than at the bottom of the page. */}
        <div className={cn('flex min-h-0 flex-col overflow-auto', footer == null && 'flex-1')}>{content}</div>
        {footer != null ? <div className="shrink-0 text-small text-fg-3">{footer}</div> : null}
      </div>
      {overlay}
    </div>
  );
}
