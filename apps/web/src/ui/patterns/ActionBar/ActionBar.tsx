// ────────────────────────────────────────────────────────────────
// C-16 ActionBar (03 §3 C-16): the sticky footer of a long form (T-03
// FormWithAside, wizards).
//
// 56h (`h-footer`), pad 0 16 0 20, gap 8, border-t `line-soft`, `bg-surface`:
// a left `hint` (a KbdHintRow or draft status), a spacer, `secondary`
// actions, then `primary` (usually a Button with a `Ctrl ↵` shortcut).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface ActionBarProps {
  hint?: ReactNode;
  secondary?: ReactNode;
  primary: ReactNode;
  className?: string;
}

/** A sticky footer: hint, secondary actions, one primary action. */
export function ActionBar({ hint, secondary, primary, className }: ActionBarProps) {
  return (
    <div className={cn('flex h-footer shrink-0 items-center gap-2 border-t border-line-soft bg-surface pr-4 pl-5', className)}>
      {hint != null ? <div className="min-w-0 flex-1 truncate text-small text-fg-3">{hint}</div> : <div className="flex-1" />}
      {secondary != null ? <div className="flex shrink-0 items-center gap-2">{secondary}</div> : null}
      {primary}
    </div>
  );
}
