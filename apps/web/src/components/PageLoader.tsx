// ────────────────────────────────────────────────────────────────
// PageLoader — Suspense fallback for lazy-loaded route pages
//
// Extracted from the old router.tsx (P1-S3, docs/redesign/07-phases.md).
// Kept in the legacy `components/` layer (not `app/`) so `app/routes/*`
// stay free of Tailwind classes, per the router-split rules.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Spinner } from '@/components/ui/index.js';

export function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size="lg" className="h-6 w-6 text-[var(--color-muted-foreground)]" />
    </div>
  );
}
