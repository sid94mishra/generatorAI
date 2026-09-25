// ────────────────────────────────────────────────────────────────
// NotFoundPage — the `*` catch-all route's element
//
// Extracted verbatim from the old router.tsx (P1-S3). Kept in the legacy
// `components/` layer so `app/routes/notFound.routes.tsx` stays free of
// Tailwind classes, per the router-split rules. Restyled in P3 (D-32).
// ────────────────────────────────────────────────────────────────

import React from 'react';

export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <h2 className="text-lg font-semibold text-[var(--color-foreground)]">404</h2>
      <p className="text-sm text-[var(--color-muted-foreground)]">Page not found</p>
    </div>
  );
}
