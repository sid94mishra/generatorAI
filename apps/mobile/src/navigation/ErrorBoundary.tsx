// ────────────────────────────────────────────────────────────────
// ErrorBoundary — the screen you see instead of a white rectangle.
//
// A render error anywhere under the root navigator used to unmount the
// whole tree: React has no default boundary, so the app went blank with no
// text, no back button and no way to recover short of force-quitting. This
// catches it, shows the ordinary `ErrorState` with the message, and offers
// two ways out — re-render in place, or go home.
//
// A class component because React still only exposes `componentDidCatch`
// that way. Kept deliberately small: nothing in here may itself throw, which
// rules out hooks, theme lookups and anything that reads a store.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../components/ui/Button';
import { ErrorState } from '../components/ui/States';

interface Props {
  children: React.ReactNode;
  /** Names the boundary in dev logs when several are mounted. */
  scope?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ''}]`, error, info.componentStack);
    }
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  private goHome = (): void => {
    this.setState({ error: null });
    // `replace` rather than `push`: the screen that crashed must not stay in
    // the history for the back gesture to return to.
    router.replace('/(tabs)');
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        <ErrorState
          title="Something broke on this screen"
          message={error.message || 'An unexpected error stopped this screen from drawing.'}
          onRetry={this.retry}
        />
        <View>
          <Button
            label="Go to Home"
            variant="ghost"
            size="sm"
            onPress={this.goHome}
            accessibilityHint="Leaves this screen and opens the Home tab"
          />
        </View>
      </View>
    );
  }
}
