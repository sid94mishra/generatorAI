// ────────────────────────────────────────────────────────────────
// PageErrorBoundary — per-route error boundary (Phase 1, 1.20)
//
// Before Phase 1 the only error boundary was at the app root, so any
// page-level throw (bad query, broken child component) crashed the
// entire shell — sidebar + header + navigation all gone. This
// boundary scopes errors to the current page so the user can still
// navigate away without a full reload.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/index.js';

interface PageErrorBoundaryProps {
  children: React.ReactNode;
  /** Shown in the error header. Defaults to "Page Error". */
  pageName?: string;
  /**
   * Optional override rendered in place of the default error UI. Receives
   * the error + a `retry()` callback.
   */
  fallback?: (error: Error, retry: () => void) => React.ReactNode;
}

interface PageErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class PageErrorBoundary extends React.Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  constructor(props: PageErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface to the browser console; structured logging is TBD (Phase 2
    // observability). Avoid swallowing — the error should be debuggable.

    console.error(`[PageErrorBoundary:${this.props.pageName ?? 'page'}]`, error, info);
  }

  private retry = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback && this.state.error) {
      return <>{this.props.fallback(this.state.error, this.retry)}</>;
    }

    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-4 rounded border border-border bg-card p-6 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" aria-hidden />
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {this.props.pageName ? `${this.props.pageName} Error` : 'Page Error'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={this.retry}
              className="inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Retry
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => { window.location.href = '/'; }}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to home
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
