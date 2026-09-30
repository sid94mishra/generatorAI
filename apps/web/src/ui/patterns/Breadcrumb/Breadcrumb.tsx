// ────────────────────────────────────────────────────────────────
// C-02 Breadcrumb (03 §3 C-02; Rosetta `<a>` fg-3 + `/` + 600 span).
//
// ui text; ancestors are muted Links, separators "/" fg-3, gap 6; the last
// item is the current page (600 fg, `aria-current="page"`) and truncates
// first; `mono` renders a segment like `Run 248` in mono. Router links come
// in through each item's `render`: `{ label: 'Automations', render: <RouterLink to="/automations" /> }`.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Link } from '../../primitives/Link/Link.js';

export interface BreadcrumbItem {
  label: ReactNode;
  /** Plain href for an ancestor (or use `render`). */
  href?: string;
  /** Router link element for an ancestor: `<RouterLink to="…" />`. */
  render?: ReactElement;
  /** Mono segment (`Run 248`). */
  mono?: boolean;
}

export interface BreadcrumbProps extends Omit<ComponentProps<'nav'>, 'children'> {
  /** Ancestors first; the last item is the current page. */
  items: readonly BreadcrumbItem[];
  /**
   * Render the current item as the page's h1 (same look). For pages whose
   * header is only a breadcrumb — a form page, an editor — so the page still
   * has one level-1 heading.
   */
  currentIsHeading?: boolean;
}

/** Where the page sits: ancestors as links, the current page last. */
export function Breadcrumb({ items, currentIsHeading = false, className, ...rest }: BreadcrumbProps) {
  const last = items.length - 1;
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)} {...rest}>
      <ol className="flex min-w-0 items-center gap-1.5 text-ui">
        {items.map((item, i) => {
          const current = i === last;
          return (
            <li key={i} className={cn('flex min-w-0 items-center gap-1.5', !current && 'shrink-0')}>
              {current ? (
                currentIsHeading ? (
                  <h1 aria-current="page" className={cn('truncate text-ui font-semibold text-fg', item.mono && 'font-mono text-small')}>
                    {item.label}
                  </h1>
                ) : (
                  <span aria-current="page" className={cn('truncate font-semibold text-fg', item.mono && 'font-mono text-small')}>
                    {item.label}
                  </span>
                )
              ) : (
                <>
                  <Link
                    variant="muted"
                    href={item.href}
                    render={item.render}
                    className={cn('max-w-60 truncate', item.mono && 'font-mono text-small')}
                  >
                    {item.label}
                  </Link>
                  <span aria-hidden className="text-fg-3">
                    /
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
