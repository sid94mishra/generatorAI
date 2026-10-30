// ────────────────────────────────────────────────────────────────
// C-27 KbdHintRow (03 §3 C-27; Rosetta `<span><span class="kbd">↵</span>Send</span>`
// row, 11px fg-3). The composer's hint row and dialog-footer hints.
//
// `text-micro text-fg-3`; hints 14 apart (`row`) or 12 inside a box (`box`);
// each hint = Kbd (P-04) + label, 4 apart. `end` sits right-aligned — usually
// a `KbdHintStatus` (6px StatusDot + text). Key strings come from the caller
// (blocks resolve the D-24 SHORTCUTS per host); the kit never detects the OS.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Kbd } from '../../primitives/Kbd/Kbd.js';
import { StatusDot, type DotTone } from '../../primitives/StatusDot/StatusDot.js';

export interface KbdHint {
  /** One chord (`['Ctrl', '↵']`) — joined into a single box. */
  keys: string | readonly string[];
  label: string;
}

export interface KbdHintRowProps extends ComponentProps<'div'> {
  hints: readonly KbdHint[];
  /** Right-aligned content, e.g. `<KbdHintStatus>`. */
  end?: ReactNode;
  /** `row` (default): 14px between hints. `box`: 12px, inside a bordered box (dialog footers). */
  variant?: 'row' | 'box';
}

/** A row of keyboard hints ("↵ Send · Shift ↵ New line") with an optional status at the end. */
export function KbdHintRow({ hints, end, variant = 'row', className, ...rest }: KbdHintRowProps) {
  return (
    <div
      className={cn('flex min-w-0 items-center text-micro text-fg-3', variant === 'box' ? 'gap-3' : 'gap-3.5', className)}
      {...rest}
    >
      {hints.map((hint) => (
        <span key={hint.label} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
          <Kbd keys={hint.keys} />
          {hint.label}
        </span>
      ))}
      {end != null ? <span className="ml-auto flex min-w-0 items-center gap-1.5">{end}</span> : null}
    </div>
  );
}

export interface KbdHintStatusProps extends ComponentProps<'span'> {
  /** Dot colour. The text carries the meaning; the dot is decorative. */
  tone?: DotTone;
  children: ReactNode;
}

/** The hint row's right-aligned status: 6px dot + text. */
export function KbdHintStatus({ tone = 'muted', className, children, ...rest }: KbdHintStatusProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)} {...rest}>
      <StatusDot tone={tone} size="sm" />
      <span className="truncate">{children}</span>
    </span>
  );
}
