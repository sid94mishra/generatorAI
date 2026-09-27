// ────────────────────────────────────────────────────────────────
// What a route shows while its lazy page loads, and when that page throws
// (P7-01; replaces components/PageLoader.tsx and PageErrorBoundary.tsx).
//
//   PageLoader         the Suspense fallback: the kit Spinner, centred
//   PageErrorBoundary  per route, inside the main card, so a page that throws
//                      keeps the sidebar and navigation; the L-03 Gate with
//                      the real message, Retry (re-render the page) and Back
//                      to home (a full load of `/`, which also drops any
//                      broken client state). ShellRoute's PageRoutesBoundary
//                      is the outer net for anything a route slot misses.
// ────────────────────────────────────────────────────────────────

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Gate } from '@/ui/templates/Gate/Gate.js';

export function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center text-fg-3">
      <Spinner label="Loading" />
    </div>
  );
}

interface PageErrorBoundaryProps {
  children: ReactNode;
  /** Names the error ("Chat Error"). Defaults to "Page Error". */
  pageName?: string;
}

export class PageErrorBoundary extends Component<PageErrorBoundaryProps, { error: Error | undefined }> {
  constructor(props: PageErrorBoundaryProps) {
    super(props);
    this.state = { error: undefined };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[PageErrorBoundary:${this.props.pageName ?? 'page'}]`, error, info.componentStack);
  }

  private retry = (): void => {
    this.setState({ error: undefined });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    return (
      <Gate
        data-testid="page-error"
        icon="status-failed"
        tone="err"
        title={this.props.pageName ? `${this.props.pageName} Error` : 'Page Error'}
        detail={error.message || 'An unexpected error occurred.'}
        actions={
          <>
            <Button icon="back" onClick={() => window.location.assign('/')}>
              Back to home
            </Button>
            <Button variant="primary" icon="retry" onClick={this.retry}>
              Retry
            </Button>
          </>
        }
      />
    );
  }
}
