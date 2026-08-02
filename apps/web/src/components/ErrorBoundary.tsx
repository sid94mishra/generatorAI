// ────────────────────────────────────────────────────────────────
// ErrorBoundary — Catches unhandled render errors
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
          <AlertTriangle className="h-10 w-10 text-[var(--color-destructive)]" />
          <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
            Something went wrong
          </h2>
          <p className="max-w-md text-center text-sm text-[var(--color-muted-foreground)]">
            An unexpected error occurred while rendering this page. You can try refreshing or going back.
          </p>
          {this.state.error && (
            <pre className="max-w-lg overflow-x-auto rounded-lg bg-[var(--color-muted)] p-3 text-xs font-mono text-[var(--color-destructive)]">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] transition-all hover:brightness-110 active:scale-[0.98]"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)]"
            >
              Go Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
