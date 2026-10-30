// ────────────────────────────────────────────────────────────────
// C-11 KeyValueList (03 §3 C-11): WorkflowRunDialog, DesktopWindows, Home,
// WorkflowDetail.
//
// Rows 28–32h (`dense` 28, default 32), gap 8 label/value, 12 between rows:
// a fixed-width label column (`labelWidth`, e.g. 92/100/108/110) in
// `text-small text-fg-3`, the value in `text-ui` (or `mono`), and an optional
// trailing mono `meta`. A row's `value` may be any node (a Meter row).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  mono?: boolean;
}

export interface KeyValueListProps {
  items: readonly KeyValueItem[];
  /** Fixed label-column width in px. Default 100. */
  labelWidth?: number;
  dense?: boolean;
  className?: string;
}

/** Rows of label/value pairs with a fixed label column. */
export function KeyValueList({ items, labelWidth = 100, dense = false, className }: KeyValueListProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {items.map((item, index) => (
        <div key={index} className={cn('flex min-w-0 items-center gap-2', dense ? 'min-h-6' : 'min-h-7')}>
          <span className="shrink-0 text-small text-fg-3" style={{ width: labelWidth }}>
            {item.label}
          </span>
          <span className={cn('min-w-0 flex-1 truncate text-fg', item.mono ? 'font-mono text-small' : 'text-ui')}>{item.value}</span>
          {item.meta != null ? <span className="shrink-0 truncate font-mono text-micro text-fg-3">{item.meta}</span> : null}
        </div>
      ))}
    </div>
  );
}
