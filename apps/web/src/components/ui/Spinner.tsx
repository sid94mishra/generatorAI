// ────────────────────────────────────────────────────────────────
// Spinner — the single loading-spinner primitive.
// Replaces ad-hoc `<Loader2 className="animate-spin" />` usage.
// For content areas with predictable shape, prefer <Skeleton>.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZES: Record<SpinnerSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
};

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  /** Visually-hidden label for screen readers (default "Loading") */
  label?: string;
}

export function Spinner({ size = 'md', label = 'Loading', className, ...props }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex', className)} {...props}>
      <Loader2 className={cn('animate-spin', SIZES[size])} aria-hidden />
    </span>
  );
}
