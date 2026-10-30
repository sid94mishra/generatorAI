import React from 'react';
import { Platform } from 'react-native';
import { screen, userEvent } from '@testing-library/react-native';
import { IconButton, iconButtonGlyph } from './IconButton';
import { renderThemed } from '../../__tests__/themed';

describe('IconButton (MP-05)', () => {
  it('requires a label, fires onPress and reports the toggle state', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<IconButton icon="dock" label="Open workspace pane, 2 changes" selected badge={{ count: 2 }} onPress={onPress} testID="i" />);
    const button = screen.getByRole('button', { name: 'Open workspace pane, 2 changes' });
    expect(button.props.accessibilityState).toMatchObject({ selected: true });
    await user.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('i').props.className).toContain('min-h-hit');
  });

  it('blocks presses while disabled', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<IconButton icon="mic" label="Dictate" disabled onPress={onPress} />);
    await user.press(screen.getByRole('button', { name: 'Dictate' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('sizes the glyph per platform (MD-127)', () => {
    const android = Platform.OS === 'android';
    expect(iconButtonGlyph('md')).toBe(android ? 24 : 22);
    expect(iconButtonGlyph('sm')).toBe(android ? 20 : 18);
  });
});
