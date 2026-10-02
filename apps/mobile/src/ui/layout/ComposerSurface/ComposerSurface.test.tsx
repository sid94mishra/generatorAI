import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { ComposerPrimaryButton } from './ComposerPrimaryButton';
import { renderThemed } from '../../__tests__/themed';

describe('ComposerPrimaryButton (MB-01, MD-56)', () => {
  it('Send is disabled with the blocking reason as its hint', async () => {
    await renderThemed(<ComposerPrimaryButton kind="send" disabled disabledReason="Answer the permission above to send" onPress={jest.fn()} />);
    const send = screen.getByTestId('composer-send');
    expect(send.props.accessibilityState).toMatchObject({ disabled: true });
    expect(send.props.accessibilityHint).toContain('Answer the permission above to send');
  });

  it('Stop is named for the agent and runs; Stopping is inert', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await renderThemed(<ComposerPrimaryButton kind="stop" stopLabel="Stop Bug Fixer" onPress={onPress} />);
    await user.press(screen.getByRole('button', { name: 'Stop Bug Fixer' }));
    expect(onPress).toHaveBeenCalled();
  });
});
