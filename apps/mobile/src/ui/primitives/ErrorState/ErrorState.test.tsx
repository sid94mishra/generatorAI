import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { ErrorState } from './ErrorState';
import { renderThemed } from '../../__tests__/themed';

describe('ErrorState (MP-33)', () => {
  it('shows the mapped message (no stack) and retries', async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<ErrorState title="Couldn't load chats" error={new Error('Network request failed\n  at x')} onRetry={onRetry} />);
    expect(screen.getByRole('header', { name: "Couldn't load chats" })).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('is an alert row inline', async () => {
    await renderThemed(<ErrorState inline title="Couldn't load worktrees" error="Timeout" testID="e" />);
    expect(screen.getByTestId('e').props.accessibilityRole).toBe('alert');
  });
});
