// ────────────────────────────────────────────────────────────────
// Router — React Router 8 route configuration (P1-S3 router split)
//
// docs/redesign/07-phases.md §P1-S3, docs/redesign/06-desktop-and-shell.md
// §2.4. Replaces the old apps/web/src/router.tsx. `<AppLayout/>` stays the
// shell element until P3-04 replaces it with `<ShellRoute/>` — this task is
// a mechanical split with no behaviour change. A `'*'` data route plus
// nested children (rather than a bare `'*'` wrapping `useRoutes`) keeps
// `useBlocker` working in WorkflowBuilderPage (06 §2.4).
// ────────────────────────────────────────────────────────────────

import { createBrowserRouter } from 'react-router';
import { AppLayout } from '@/components/layout/AppLayout.js';
import { ErrorBoundary } from '@/components/ErrorBoundary.js';
import { RouteErrorFallback } from '@/components/RouteErrorFallback.js';
import { PAGE_ROUTES } from './routes/index.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: (
      <ErrorBoundary>
        <RouteErrorFallback />
      </ErrorBoundary>
    ),
    children: PAGE_ROUTES,
  },
]);
