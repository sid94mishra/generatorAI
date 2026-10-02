import React from 'react';
import { act, screen } from '@testing-library/react-native';
import { setHardwareKeyboardAttached } from '../../platform/keyboard';
import { Text } from '../../primitives/Text';
import { KeyboardStickyBar, stickyOffsets } from './KeyboardStickyBar';
import { renderThemed } from '../../__tests__/themed';

describe('KeyboardStickyBar (ML-29)', () => {
  it('lifts by the bottom inset only while the keyboard is closed', () => {
    expect(stickyOffsets(34)).toEqual({ closed: -34, opened: 0 });
  });

  it('hides with a hardware keyboard when asked', async () => {
    await renderThemed(
      <KeyboardStickyBar hideOnHardwareKeyboard>
        <Text>Keys</Text>
      </KeyboardStickyBar>,
    );
    expect(screen.getByText('Keys')).toBeTruthy();
    await act(async () => setHardwareKeyboardAttached(true));
    expect(screen.queryByText('Keys')).toBeNull();
    await act(async () => setHardwareKeyboardAttached(false));
  });
});
