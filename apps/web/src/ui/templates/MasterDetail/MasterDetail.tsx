// ────────────────────────────────────────────────────────────────
// T-05 MasterDetail (03 §5 T-05). Slots `list` (usually a C-34 ListPane,
// 320 default) and `detail` (scroll, pad 24 28, gap 20). S-11
// SettingsModalFrame renders its own left nav + content through this same
// component with `listWidth={220}` and `bareDetail` (its content column has
// a fixed close button and footer around the scrolling body, not the plain
// padded slot below).
//
// Responsive: at container widths below `@4xl` (896px — the board's "a 900
// card") the columns stack, list first; between `@4xl` and `@5xl` (1024px —
// the 1100 reference window, where the main card is ≈1036) the default
// 320-wide list narrows to 260. Boards give no named breakpoints for this
// (only "1100: list 260 below a 900 card"), so these two container-query
// steps are this task's implementation choice, noted here rather than as a
// new D-xx (a layout tuning, not a lasting product decision). The
// `listWidth={220}` Settings variant skips the step (the modal is a fixed
// 960×640 box, never narrow enough to trigger it).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export type MasterDetailListWidth = 220 | 320;

const LIST_WIDTH: Record<MasterDetailListWidth, string> = {
  220: 'w-55',
  320: 'w-80 @4xl/master-detail:w-65 @5xl/master-detail:w-80',
};

export interface MasterDetailProps {
  /** The master list, usually a ListPane. */
  list: ReactNode;
  /** The detail content for the selected item. */
  detail: ReactNode;
  /** 320 (T-05 default) or 220 (S-11 Settings modal). Default 320. */
  listWidth?: MasterDetailListWidth;
  /** Skip the default padded/scrolling detail wrapper; the caller builds its own (S-11). */
  bareDetail?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** A list + detail split screen: Scripts today, the Settings modal (S-11) with `listWidth={220}`. */
export function MasterDetail({
  list,
  detail,
  listWidth = 320,
  bareDetail = false,
  className,
  'data-testid': testId,
}: MasterDetailProps) {
  // The container and the row/column switch are two elements: a container
  // query never styles its own container, only descendants.
  return (
    <div className={cn('@container/master-detail flex min-h-0 min-w-0 flex-1', className)} data-testid={testId}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @4xl/master-detail:flex-row">
        <div className={cn('flex min-h-0 shrink-0 flex-col', LIST_WIDTH[listWidth])}>{list}</div>
        {bareDetail ? (
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{detail}</div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-7 py-6">{detail}</div>
        )}
      </div>
    </div>
  );
}
