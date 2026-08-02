// ────────────────────────────────────────────────────────────────
// PageContainer — standard page shell. Pairs with <PageHeader> and
// <Toolbar> to normalize page layout across list/detail pages.
//
//   default → centered, max-w-6xl, padded, scrolls its own content
//   narrow  → same but max-w-4xl (forms, detail pages)
//   full    → full-bleed flex column (pages that manage their own
//             sub-header / scroll regions)
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';

export type PageContainerVariant = 'default' | 'narrow' | 'full';

const VARIANT_CLASSES: Record<PageContainerVariant, string> = {
  default: 'mx-auto max-w-6xl px-6 py-8 h-full overflow-y-auto',
  narrow: 'mx-auto max-w-4xl px-6 py-8 h-full overflow-y-auto',
  full: 'h-full flex flex-col min-h-0',
};

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: PageContainerVariant;
}

export function PageContainer({
  variant = 'default',
  className,
  children,
  ...props
}: PageContainerProps) {
  return (
    <div className={cn(VARIANT_CLASSES[variant], className)} {...props}>
      {children}
    </div>
  );
}
