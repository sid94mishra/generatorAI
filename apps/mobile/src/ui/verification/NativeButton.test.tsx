import React from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import { NativeButtonProbe } from './NativeButton.stories';

describe('native component harness', () => {
  it('exposes a named button and delivers native press events', async () => {
    const user = userEvent.setup();
    await render(<NativeButtonProbe />);
    await user.press(screen.getByRole('button', { name: 'Storybook ready: 0' }));
    expect(screen.getByRole('button', { name: 'Storybook ready: 1' })).toBeEnabled();
  });
  it('preserves disabled accessibility state and does not invoke a press', async () => {
    const user = userEvent.setup();
    await render(<NativeButtonProbe disabled />);
    const button = screen.getByRole('button', { name: 'Storybook ready: 0' });
    expect(button).toBeDisabled();
    await user.press(button);
    expect(screen.getByRole('button', { name: 'Storybook ready: 0' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Storybook ready: 1' })).toBeNull();
  });
});
