// ────────────────────────────────────────────────────────────────
// C-03 PageTitle (03 §3 C-03; Rosetta "H1 20/600 + mono count + primary
// button, 32h row").
//
// `list`: a 32h row, gap 10 — H1 (heading step), mono small fg-3 count,
// optional small fg-3 description, spacer, actions (secondary + one primary
// with its shortcut). `detail`: H1 (lh 1.3) over a ui fg-2 description and a
// mono micro fg-3 meta line whose parts are joined with "·".
// ────────────────────────────────────────────────────────────────

import { Fragment, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface PageTitleProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  /** Total next to the title (mono). */
  count?: ReactNode;
  description?: ReactNode;
  /** Detail meta parts, joined with "·". */
  meta?: readonly ReactNode[];
  actions?: ReactNode;
  variant?: 'list' | 'detail';
}

/** The page's H1 with its count, description and primary actions. */
export function PageTitle({ title, count, description, meta, actions, variant = 'list', className, ...rest }: PageTitleProps) {
  if (variant === 'detail') {
    return (
      <div className={cn('flex min-w-0 items-start gap-2.5', className)} {...rest}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="truncate text-heading text-fg">{title}</h1>
          {description != null ? <p className="text-ui text-fg-2">{description}</p> : null}
          {meta && meta.length > 0 ? (
            // One line: a long part (a root path) truncates instead of pushing the rest onto a second line.
            <p className="flex min-w-0 items-center gap-1.5 font-mono text-micro text-fg-3">
              {meta.map((part, i) => (
                <Fragment key={i}>
                  {i > 0 ? (
                    <span aria-hidden className="shrink-0">
                      ·
                    </span>
                  ) : null}
                  <span className={i === 0 ? 'min-w-0 truncate' : 'shrink-0'} title={typeof part === 'string' ? part : undefined}>
                    {part}
                  </span>
                </Fragment>
              ))}
            </p>
          ) : null}
        </div>
        {actions != null ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    );
  }
  return (
    <div className={cn('flex min-h-8 min-w-0 items-center gap-2.5', className)} {...rest}>
      <h1 className="truncate text-heading text-fg">{title}</h1>
      {count != null ? <span className="shrink-0 font-mono text-small text-fg-3">{count}</span> : null}
      {description != null ? <span className="min-w-0 truncate text-small text-fg-3">{description}</span> : null}
      {actions != null ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
