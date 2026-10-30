// ErrorBoundary (06 §1.2 #17): a render error under the shell shows ErrorState with the message and two ways out —
// re-render in place, or go Home — instead of a blank app. A class component (React exposes componentDidCatch only
// that way); nothing in it may throw, so it reads no store or theme.
import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { reportCaughtError } from '../../services/native/crashReporting';
import { Button } from '../../ui/primitives/Button';
import { ErrorState } from '../../ui/primitives/ErrorState';

interface Props {
  children: React.ReactNode;
  /** Names the boundary in dev logs. */
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
    // Opt-in crash reporting (MD-42): a no-op unless the user turned it on.
    reportCaughtError(error);
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ''}]`, error, info.componentStack);
    }
  }

  private retry = (): void => this.setState({ error: null });

  private goHome = (): void => {
    this.setState({ error: null });
    // `replace`: the screen that crashed must not stay in the history.
    router.replace('/');
  };

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-surface px-8">
        <ErrorState title="Something broke on this screen" error={this.state.error} onRetry={this.retry} />
        <Button label="Go to Home" variant="ghost" size="sm" onPress={this.goHome} />
      </View>
    );
  }
}
