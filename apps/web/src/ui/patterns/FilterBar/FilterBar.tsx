// ────────────────────────────────────────────────────────────────
// C-04 FilterBar (03 §3 C-04; Rosetta "search inp + `.seg` counts + `.chip`
// filters + sort").
//
// One row, gap 8: SearchInput (sm, 240–264 wide) · scope SegmentedControl
// with counts · filter chips (dropdown Chips) · spacer · sort (ghost chip or
// ghost sm button) · view toggle (icon-only SegmentedControl). The slots are
// ReactNodes; the bar only lays them out.
// When the bar is narrower than 1024px (container query `@5xl` on the bar
// itself), `filters` hide and `filtersCollapsed` — one "Filters" dropdown chip
// the caller builds — shows instead. 03 C-04 says "< 900", but T-01 wants the
// chips collapsed at a 1100 window, where the bar is ≈ 980 wide and the full
// row (search 264 + scope + 4 chips + sort) no longer fits.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface FilterBarProps extends ComponentProps<'div'> {
  search?: ReactNode;
  scope?: ReactNode;
  /** Filter chips shown when the bar is wide enough. */
  filters?: ReactNode;
  /** The single "Filters" chip shown instead of `filters` below ~900px. */
  filtersCollapsed?: ReactNode;
  sort?: ReactNode;
  view?: ReactNode;
}

/** The list toolbar above a DataTable or card grid. */
export function FilterBar({ search, scope, filters, filtersCollapsed, sort, view, className, ...rest }: FilterBarProps) {
  return (
    <div className={cn('@container/filters w-full min-w-0', className)} {...rest}>
      <div className="flex min-w-0 items-center gap-2">
        {search != null ? <div className="w-66 shrink-0">{search}</div> : null}
        {scope}
        {filters != null ? (
          <div
            className={cn('min-w-0 items-center gap-2', filtersCollapsed != null ? 'hidden @5xl/filters:flex' : 'flex')}
          >
            {filters}
          </div>
        ) : null}
        {filtersCollapsed != null ? <div className="flex @5xl/filters:hidden">{filtersCollapsed}</div> : null}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {sort}
          {view}
        </div>
      </div>
    </div>
  );
}
