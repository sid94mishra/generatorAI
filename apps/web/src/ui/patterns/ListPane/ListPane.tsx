// ────────────────────────────────────────────────────────────────
// C-34 ListPane (03 §3 C-34; T-05 MasterDetail's `list` slot). Replaces the
// list half of `pages/ScriptsListPage.tsx`.
//
// 320 wide aside, border-r line-soft: header block (pad 16 12 10 16) with an
// H1 (`text-heading`, rendered as an h2 — the page's own PageHeader already
// owns the h1) + a count + one sm action, then an optional search row; the
// row content (C-07 EntityRow `nav` rows, not built by this pattern — P5-01)
// scrolls in the middle (pad 0 8, gap 2); a spacer pushes an optional neutral
// Callout to the bottom (margin 12).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Count } from '../../primitives/Count/Count.js';

export interface ListPaneProps {
  title: ReactNode;
  /** Item count, right of the title. */
  count?: ReactNode;
  /** One sm action (a Button or IconButton), right of the count. */
  action?: ReactNode;
  /** A SearchInput (size sm), below the title row. */
  search?: ReactNode;
  /** The list rows (C-07 EntityRow `variant="nav"`). */
  children?: ReactNode;
  /** A neutral Callout pinned to the bottom, e.g. "Scripts run in the codebase's shell". */
  footer?: ReactNode;
  /** The title's heading level: 1 when the list pane's title is the page's title (Scripts). */
  headingLevel?: 1 | 2;
  className?: string;
  'data-testid'?: string;
}

/** The master list half of a master-detail screen: header, search, scrolling rows, footer note. */
export function ListPane({ title, count, action, search, children, footer, headingLevel = 2, className, 'data-testid': testId }: ListPaneProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <aside className={cn('flex h-full w-80 shrink-0 flex-col border-r border-line-soft', className)} data-testid={testId}>
      <div className="flex flex-col gap-2.5 pt-4 pr-3 pb-2.5 pl-4">
        <div className="flex min-h-6 items-center gap-2">
          <Heading className="min-w-0 flex-1 truncate text-heading text-fg">{title}</Heading>
          {count != null ? <Count align="end">{count}</Count> : null}
          {action != null ? <div className="shrink-0">{action}</div> : null}
        </div>
        {search}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">{children}</div>
      {footer != null ? <div className="m-3 shrink-0">{footer}</div> : null}
    </aside>
  );
}
