import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { KbdHint, kbdText } from './KbdHint';
import { setHardwareKeyboardAttached } from '../../platform/keyboard';

describe('KbdHint (MP-39)', () => {
  it('formats per platform host', () => {
    expect(kbdText('Mod+K', 'ios')).toBe('⌘K');
    expect(kbdText('Mod+K', 'android')).toBe('Ctrl+K');
  });
  it('renders only with a hardware keyboard', async () => {
    await render(<KbdHint binding="Mod+K" testID="k" />);
    expect(screen.queryByTestId('k')).toBeNull();
    await act(async () => setHardwareKeyboardAttached(true));
    expect(screen.getByTestId('k')).toBeTruthy();
    await act(async () => setHardwareKeyboardAttached(false));
  });
});
