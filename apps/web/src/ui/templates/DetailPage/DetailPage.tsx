// ────────────────────────────────────────────────────────────────
// T-02 DetailPage (03 §5 T-02): slots only, no logic (same discipline as
// T-01 ListPage, T-04 Workspace) — ProjectDetail, ProjectCustomization,
// CodebaseDetail, PullRequestPage.
//
//   header      C-01 PageHeader (breadcrumb + actions)
//   title       C-03 PageTitle (`variant="detail"`)
//   banner?     C-29 Banner
//   tabs?       P-26 Tabs (margin-top 4)
//   content     the tab's body
//   rail?       a 360px column of P-48 cards (`w-side-rail`, gap 10)
//   inspector?  C-18 Inspector (400, brings its own border/background)
//
// Body pad 24 28, gap 16. At most one of `rail` / `inspector` is given. Below
// ~1150px card width the caller stacks the rail under the content
// (`railStacked`) and collapses the inspector (simply omitting it) — this
// template does not watch its own width (same reasoning as T-04 Workspace):
// whoever owns the container-query breakpoint passes the already-decided
// flag, so this component stays a pure slot layout.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface DetailPageProps extends Omit<ComponentProps<'div'>, 'title' | 'content'> {
  header: ReactNode;
  title: ReactNode;
  banner?: ReactNode;
  tabs?: ReactNode;
  content: ReactNode;
  /** A 360px column of cards; mutually exclusive with `inspector`. */
  rail?: ReactNode;
  /** A C-18 Inspector; mutually exclusive with `rail`. */
  inspector?: ReactNode;
  /** Set by the caller under the ~1150px breakpoint: stacks `rail` under `content`. */
  railStacked?: boolean;
}

/** Page layout for an entity's detail view: title, optional tabs, content beside an optional rail/inspector. */
export function DetailPage({
  header,
  title,
  banner,
  tabs,
  content,
  rail,
  inspector,
  railStacked = false,
  className,
  ...rest
}: DetailPageProps) {
  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-surface text-fg', className)} {...rest}>
      {header}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col gap-4 px-7 py-6">
            {title}
            {banner}
            {tabs != null ? <div className="mt-1">{tabs}</div> : null}
          </div>
          <div className={cn('flex min-h-0 flex-1 gap-4 px-7 pb-6', railStacked ? 'flex-col' : 'flex-row')}>
            <div className="min-w-0 flex-1">{content}</div>
            {rail != null ? <div className={cn('flex shrink-0 flex-col gap-2.5', !railStacked && 'w-side-rail')}>{rail}</div> : null}
          </div>
        </div>
        {inspector}
      </div>
    </div>
  );
}
