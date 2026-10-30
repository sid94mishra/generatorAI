// ────────────────────────────────────────────────────────────────
// P-35 Separator (03 §2 P-35; Rosetta `height:1px; background: var(--line-soft)`
// and `width:1px; height:16–20px`).
//
// Horizontal: a 1px `line-soft` rule across the container. Vertical: 1px × 16
// (`size="md"`) or × 20 (`size="lg"`), margin 0 6 — `line` in page headers
// (`tone="default"`), `line-soft` in bars. Drawn as a border so the height
// never needs a literal `h-px` (D-15 lint).
// ────────────────────────────────────────────────────────────────

import { Separator as BaseSeparator } from '@base-ui/react/separator';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

export const separatorVariants = cva('shrink-0 border-0', {
  variants: {
    orientation: {
      horizontal: 'w-full border-t',
      vertical: 'mx-1.5 self-center border-l',
    },
    tone: { soft: 'border-line-soft', default: 'border-line' },
    size: { md: '', lg: '' },
  },
  compoundVariants: [
    { orientation: 'vertical', size: 'md', className: 'min-h-4' },
    { orientation: 'vertical', size: 'lg', className: 'min-h-5' },
  ],
  defaultVariants: { orientation: 'horizontal', tone: 'soft', size: 'md' },
});

export interface SeparatorProps extends Omit<BaseSeparator.Props, 'className'> {
  orientation?: 'horizontal' | 'vertical';
  /** `soft` (default, bars and menus) or `default` (`line`, page headers). */
  tone?: 'soft' | 'default';
  /** Vertical length: md 16, lg 20. */
  size?: 'md' | 'lg';
  className?: string;
}

/** A 1px divider between groups of content or actions. */
export function Separator({ orientation = 'horizontal', tone = 'soft', size = 'md', className, ...rest }: SeparatorProps) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={cn(separatorVariants({ orientation, tone, size }), className)}
      {...rest}
    />
  );
}
