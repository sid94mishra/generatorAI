// ────────────────────────────────────────────────────────────────
// C-10 StatStrip / StatTile (03 §3 C-10): StatValue20 (Workflows), Home "This
// week".
//
// Built on P-48 Card. `layout="strip"` (default): a row of tiles, `flex-1`,
// pad 12 20, divided by a `border-l line-soft`; value `text-heading` 600
// (`font-mono` when numeric; `tone` colours it for "Needs you"/"Running"),
// label `text-small text-fg-3`. `layout="grid"` (Home "This week"): 2×2
// tiles, pad 12 14, value `font-mono` 20 lh 1.2. A tile with `href` renders
// as a plain link (the caller's router intercepts real anchors); it has no
// dependency on `react-router` (D-04, `ui/**` may not import it).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Card } from '../../primitives/Card/Card.js';

export interface StatTileItem {
  value: ReactNode;
  label: ReactNode;
  /** Colours the value (warn = Needs you, run = Running). */
  tone?: 'warn' | 'run' | 'ok' | 'err';
  /** The value is numeric (renders `font-mono`); default true. */
  numeric?: boolean;
  href?: string;
}

export interface StatStripProps {
  items: readonly StatTileItem[];
  layout?: 'strip' | 'grid';
  className?: string;
}

const TONE_TEXT: Record<NonNullable<StatTileItem['tone']>, string> = {
  warn: 'text-warn',
  run: 'text-run',
  ok: 'text-ok',
  err: 'text-err',
};

/** A card of small value/label tiles: a horizontal strip or a 2×2 grid. */
export function StatStrip({ items, layout = 'strip', className }: StatStripProps) {
  const grid = layout === 'grid';
  return (
    <Card className={cn(grid ? 'grid grid-cols-2' : 'flex', className)}>
      {items.map((item, index) => {
        const numeric = item.numeric ?? true;
        const Tile = item.href ? 'a' : 'div';
        return (
          <Tile
            key={index}
            {...(item.href ? { href: item.href } : {})}
            className={cn(
              'flex min-w-0 flex-col gap-0.5',
              grid ? 'py-3 pr-3 pl-3.5' : 'flex-1 border-l border-line-soft px-5 py-3 first:border-l-0',
              item.href && 'transition-control hover:bg-hover',
            )}
          >
            <span
              className={cn('text-heading font-semibold', grid && 'leading-tight', numeric && 'font-mono', item.tone && TONE_TEXT[item.tone])}
            >
              {item.value}
            </span>
            <span className="truncate text-small text-fg-3">{item.label}</span>
          </Tile>
        );
      })}
    </Card>
  );
}
