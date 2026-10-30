// ────────────────────────────────────────────────────────────────
// P-44 InlineCode (03 §2 P-44) — a code span inside running text: paths,
// flags, identifiers ("`pnpm test` failed").
//
// `font-mono text-small` (`dense`: `text-micro`, the 11px dense-text size),
// pad 1 4, badge radius, `bg-selected`. The colour inherits from the
// surrounding text on purpose (an err line keeps its err colour).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.js';

export interface InlineCodeProps extends ComponentProps<'code'> {
  /** Dense text (11px): table cells, meta lines, micro captions. */
  dense?: boolean;
}

/** Monospace inline code. Renders a <code>. */
export function InlineCode({ dense = false, className, ...rest }: InlineCodeProps) {
  return (
    <code
      className={cn(
        'rounded-badge bg-selected px-1 py-px font-mono break-words',
        dense ? 'text-micro' : 'text-small',
        className,
      )}
      {...rest}
    />
  );
}
