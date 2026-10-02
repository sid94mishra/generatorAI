import React from 'react';
import { Platform, Text } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { Pressable, rippleFor } from './Pressable';
import { pressFeedback } from '../../platform/pressFeedback';
import { renderThemed } from '../../__tests__/themed';

describe('Pressable (MP-03)', () => {
  it('is a named button that fires onPress, with a hit-target frame (MD-91)', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Pressable accessibilityLabel="Open" onPress={onPress} testID="p"><Text>Open</Text></Pressable>);
    await user.press(screen.getByRole('button', { name: 'Open' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('p').props.className).toContain('min-h-hit');
    expect(screen.getByTestId('p').props.className).toContain('min-w-hit');
  });

  it('blocks presses when disabled and reads the reason', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <Pressable accessibilityLabel="Send" disabled disabledReason="Nothing to send" onPress={onPress}>
        <Text>Send</Text>
      </Pressable>,
    );
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toBeDisabled();
    expect(button.props.accessibilityHint).toBe('Nothing to send');
    await user.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ripples on Android only, never while disabled', () => {
    const ripple = rippleFor(pressFeedback('scale'), false, '#ffffff14', true);
    if (Platform.OS === 'android') expect(ripple).toEqual({ color: '#ffffff14', borderless: true, foreground: true });
    else expect(ripple).toBeUndefined();
    expect(rippleFor('ripple', true, '#ffffff14', false)).toBeUndefined();
  });

  it('exposes accessibility actions for gesture alternatives (03 §1.6.5)', async () => {
    const onAction = jest.fn();
    await renderThemed(
      <Pressable accessibilityLabel="Row" frame="none" accessibilityActions={[{ name: 'archive', label: 'Archive' }]} onAccessibilityAction={onAction} testID="p">
        <Text>Row</Text>
      </Pressable>,
    );
    const node = screen.getByTestId('p');
    expect(node.props.accessibilityActions).toEqual([{ name: 'archive', label: 'Archive' }]);
    expect(node.props.className ?? '').not.toContain('min-h-hit');
  });
});
