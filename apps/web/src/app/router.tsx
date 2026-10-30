// ────────────────────────────────────────────────────────────────
// Router — React Router 8 route configuration.
//
// docs/redesign/06-desktop-and-shell.md §2.1, §2.4. `<ShellRoute/>` (P3-04)
// is the app frame. One `'*'` data route (so `useBlocker` keeps working in
// WorkflowBuilderPage) whose element renders the pages with
// `useRoutes(PAGE_ROUTES, pageLocation)`: the main card can then show a
// location other than the URL — the page behind the Settings modal (D-26).
//
// Errors (04 R-6): a failing page is caught inside the main card by the
// shell's PageRoutesBoundary (the sidebar stays); only a failure of the shell
// itself takes the whole window (this errorElement).
// ────────────────────────────────────────────────────────────────

import { createBrowserRouter } from 'react-router';
import { ShellRoute } from './shell/ShellRoute.js';
import { ShellErrorPage } from './shell/RouteErrors.js';

export const router = createBrowserRouter([
  { path: '*', element: <ShellRoute />, errorElement: <ShellErrorPage /> },
]);
