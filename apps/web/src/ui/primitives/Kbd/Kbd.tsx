// ────────────────────────────────────────────────────────────────
// P-04 Kbd — a keyboard hint box (03 §2 P-04).
//
// One box holds a whole chord (`Ctrl K`, `Ctrl ↵`, `⌘K`): an array is joined
// into ONE box; render several <Kbd> for keys pressed one after another (arrow
// keys, `G H` sequences). Display strings come from the caller (blocks resolve
// the D-24 SHORTCUTS per host); the kit never detects the platform.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

export const kbdVariants = cva(
  'inline-flex h-kbd min-w-4.5 shrink-0 items-center justify-center rounded-badge border px-1 font-mono text-micro font-normal whitespace-nowrap',
  {
    variants: {
      onAccent: {
        false: 'border-line bg-sunken text-fg-3',
        // Inside a primary button: transparent, currentColor border, 70 % (P-02).
        true: 'border-current bg-transparent text-current opacity-70',
      },
    },
    defaultVariants: { onAccent: false },
  },
);

export interface KbdProps extends Omit<ComponentProps<'kbd'>, 'children'> {
  /** One chord. An array is joined with spaces into a single box (`['Ctrl', 'K']` → `Ctrl K`). */
  keys: string | readonly string[];
  /** Render on an accent fill (primary button). */
  onAccent?: boolean;
}

/** A keyboard shortcut hint. Purely visual; the owning control keeps the accessible name. */
export function Kbd({ keys, onAccent = false, className, ...rest }: KbdProps) {
  const text = typeof keys === 'string' ? keys : keys.join(' ');
  return (
    <kbd className={cn(kbdVariants({ onAccent }), className)} {...rest}>
      {text}
    </kbd>
  );
}
