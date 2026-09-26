// ────────────────────────────────────────────────────────────────
// Router — React Router 8 route configuration.
//
// docs/redesign/06-desktop-and-shell.md §2.1, §2.4. `<ShellRoute/>` (P3-04)
// is the app frame; the pages render into its main card through <Outlet/>.
// A data route with nested children (rather than a bare `'*'` wrapping
// `useRoutes`) keeps `useBlocker` working in WorkflowBuilderPage (06 §2.4).
//
// Errors (04 R-6): a failing page route is caught by the pathless layer's
// errorElement and shown inside the main card (the sidebar stays); only a
// failure of the shell itself takes the whole window.
// ────────────────────────────────────────────────────────────────

import { createBrowserRouter } from 'react-router';
import { ShellRoute } from './shell/ShellRoute.js';
import { RouteErrorPage, ShellErrorPage } from './shell/RouteErrors.js';
import { PAGE_ROUTES } from './routes/index.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <ShellRoute />,
    errorElement: <ShellErrorPage />,
    children: [{ errorElement: <RouteErrorPage />, children: PAGE_ROUTES }],
  },
]);
