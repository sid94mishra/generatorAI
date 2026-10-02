import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { SearchInput, searchSurface, searchTrailing } from './SearchInput';
import { renderThemed, themed } from '../../__tests__/themed';

describe('SearchInput (MP-17)', () => {
  it('picks one trailing control and the MD-46 surface', () => {
    expect(searchTrailing({ value: '', mic: true })).toBe('mic');
    expect(searchTrailing({ value: 'a', mic: true })).toBe('clear');
    expect(searchTrailing({ value: 'a', loading: true })).toBe('spinner');
    expect(searchTrailing({ value: '' })).toBeNull();
    expect(searchSurface('bar', false)).toContain('min-h-search');
    expect(searchSurface('compact', false)).toContain('min-h-search-sm');
  });

  it('clears with a named control and exposes the dictation control', async () => {
    const onChangeText = jest.fn();
    const onMicPress = jest.fn();
    const user = userEvent.setup();
    const { rerender } = await renderThemed(<SearchInput value="abc" onChangeText={onChangeText} placeholder="Search chats" />);
    await user.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChangeText).toHaveBeenCalledWith('');
    await rerender(themed(<SearchInput value="" onChangeText={onChangeText} placeholder="Search chats" mic onMicPress={onMicPress} />));
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    await user.press(screen.getByRole('button', { name: 'Dictate' }));
    expect(onMicPress).toHaveBeenCalled();
  });

  it('is a search button in button mode', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<SearchInput asButton value="" onChangeText={jest.fn()} placeholder="Search chats, runs" onPress={onPress} testID="drawer-search" />);
    await user.press(screen.getByTestId('drawer-search'));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByTestId('drawer-search').props.accessibilityRole).toBe('search');
  });
});
