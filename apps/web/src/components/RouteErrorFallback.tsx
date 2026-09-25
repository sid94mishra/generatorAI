// ────────────────────────────────────────────────────────────────
// RouteErrorFallback — the data router's top-level `errorElement` content
//
// Extracted verbatim from the old router.tsx (P1-S3). Kept in the legacy
// `components/` layer so `app/router.tsx` stays free of Tailwind classes,
// per the router-split rules. Replaced by the L-03 Gate layout in P3
// (docs/redesign/04-screen-map.md R-6).
// ────────────────────────────────────────────────────────────────

import React from 'react';

export function RouteErrorFallback() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <a href="/" className="text-sm text-blue-500 underline">Go Home</a>
    </div>
  );
}
