// ────────────────────────────────────────────────────────────────
// 404 and route errors on the L-03 Gate (D-32; 04 R-6; replaces the P1-S3
// placeholders components/NotFoundPage.tsx and RouteErrorFallback.tsx).
//
//   NotFoundPage     the `*` route, inside the main card (sidebar kept)
//   RouteErrorPage   errorElement of the page routes, inside the main card
//   ShellErrorPage   errorElement of the shell itself, the full window
// The real error message is shown verbatim (plain mono text until the C-23
// CodeBlock lands in P4); actions are Reload and Go home.
// ────────────────────────────────────────────────────────────────

import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Gate } from '@/ui/templates/Gate/Gate.js';

export function NotFoundPage() {
  return (
    <Gate
      data-testid="not-found"
      icon="info"
      title="Page not found"
      description="There is nothing at this address. It may have moved, or the link is wrong."
      actions={
        <Button variant="primary" render={<Link to="/" />}>
          Go home
        </Button>
      }
    />
  );
}

/** What went wrong, in one line, from whatever the router caught. */
function errorText(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim();
  if (error instanceof Error) return error.message || error.name;
  return typeof error === 'string' ? error : 'Unknown error';
}

function ErrorGate({ placement }: { placement: 'card' | 'window' }) {
  const error = useRouteError();
  return (
    <Gate
      placement={placement}
      data-testid="route-error"
      icon="status-failed"
      tone="err"
      title="Something went wrong"
      description="This page failed to load. Reloading usually fixes it; the error is below."
      detail={errorText(error)}
      actions={
        <>
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="primary" render={<Link to="/" />}>
            Go home
          </Button>
        </>
      }
    />
  );
}

/** A page route failed: the sidebar stays, the card shows the error. */
export function RouteErrorPage() {
  return <ErrorGate placement="card" />;
}

/** The shell itself failed: the whole window shows the error. */
export function ShellErrorPage() {
  return <ErrorGate placement="window" />;
}
