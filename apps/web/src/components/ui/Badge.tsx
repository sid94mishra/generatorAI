// ────────────────────────────────────────────────────────────────
// Badge — canonical pill/label primitive
// `tone` maps to the semantic status tokens in globals.css.
// Use for statuses, tags, counts, model chips, etc.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'done';

export type BadgeSize = 'sm' | 'md';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-subtle text-muted-foreground border-border',
  primary: 'bg-info-muted text-primary border-transparent',
  success: 'bg-success-muted text-success border-transparent',
  warning: 'bg-warning-muted text-warning border-transparent',
  danger: 'bg-danger-muted text-danger border-transparent',
  info: 'bg-info-muted text-info border-transparent',
  done: 'bg-done/15 text-done border-transparent',
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-[10px] gap-1',
  md: 'px-2 py-0.5 text-xs gap-1.5',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Show a leading status dot in the tone color */
  dot?: boolean;
}

export function Badge({ tone = 'neutral', size = 'md', dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
