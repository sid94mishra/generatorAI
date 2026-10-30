import React from 'react';
import { screen } from '@testing-library/react-native';
import { LargeTitle, largeTitleLabel } from './LargeTitle';
import { renderThemed } from '../../__tests__/themed';
import { nativePlatform } from '../../platform/geometry';

describe('LargeTitle (MD-153)', () => {
  it('speaks the title and its count as one header', async () => {
    expect(largeTitleLabel('Chats', 48)).toBe('Chats, 48');
    expect(largeTitleLabel('Chats')).toBe('Chats');
    await renderThemed(<LargeTitle title="Chats" count={48} testID="lt" />);
    if (nativePlatform === 'android') {
      expect(screen.queryByTestId('lt')).toBeNull();
      return;
    }
    expect(screen.getByTestId('lt').props.accessibilityLabel).toBe('Chats, 48');
    expect(screen.getByText('Chats')).toBeTruthy();
  });
});
