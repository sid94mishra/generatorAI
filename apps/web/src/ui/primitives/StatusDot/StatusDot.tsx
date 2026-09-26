// ────────────────────────────────────────────────────────────────
// P-07 StatusDot — 8px status dot for dense rows (03 §2 P-07; Rosetta `.dot`).
//
// `size="sm"` 6px (inline, connection); `ring` = 7px with a 2px ground ring
// (rail notification). Colour from `state` (the shared D-18 map, 02 §7.1 "Dot")
// or a `tone`. Never the only carrier of meaning: pair it with text, or give it
// a `label` (then it is an image with that name).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import type { StatusState } from '@generatorai/shared';
import { cn } from '../../lib/cn.js';

export type DotTone = 'neutral' | 'muted' | 'run' | 'ok' | 'warn' | 'err';

const TONE_BG: Record<DotTone, string> = {
  neutral: 'bg-fg-2',
  muted: 'bg-fg-3',
  run: 'bg-run',
  ok: 'bg-ok',
  warn: 'bg-warn',
  err: 'bg-err',
};

/** Dot colour per state (02 §7.1 last column). */
export const STATE_DOT_TONE: Record<StatusState, DotTone> = {
  queued: 'muted',
  running: 'run',
  waiting: 'neutral',
  needs_you: 'warn',
  paused: 'neutral',
  succeeded: 'ok',
  failed: 'err',
  skipped: 'muted',
};

export interface StatusDotProps extends Omit<ComponentProps<'span'>, 'children'> {
  state?: StatusState;
  /** Used when there is no `state` (health dots: connected = ok). Default `muted`. */
  tone?: DotTone;
  size?: 'sm' | 'md';
  /** 7px dot with a 2px ground ring, for a notification on a rail icon. */
  ring?: boolean;
  /** Accessible name; without it the dot is decorative (the adjacent text carries the meaning). */
  label?: string;
}

/** A small status/health dot. Decorative unless `label` is given. */
export function StatusDot({ state, tone, size = 'md', ring = false, label, className, ...rest }: StatusDotProps) {
  const resolved = state ? STATE_DOT_TONE[state] : (tone ?? 'muted');
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <span
      className={cn(
        'inline-block shrink-0 rounded-full',
        TONE_BG[resolved],
        ring ? 'size-1.75 ring-2 ring-ground' : size === 'sm' ? 'size-1.5' : 'size-2',
        className,
      )}
      data-status={state}
      {...a11y}
      {...rest}
    />
  );
}
