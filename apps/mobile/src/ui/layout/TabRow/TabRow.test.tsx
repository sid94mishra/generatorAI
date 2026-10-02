import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { TabRow, tabRowLabel } from './TabRow';
import { renderThemed } from '../../__tests__/themed';

describe('TabRow', () => {
  it('names tabs with their counts and marks the active one', async () => {
    expect(tabRowLabel({ label: 'Chats', count: 6 })).toBe('Chats, 6');
    await renderThemed(<TabRow tabs={[{ id: 'a', label: 'Codebases', count: 2 }, { id: 'b', label: 'Settings' }]} active="b" onSelect={jest.fn()} accessibilityLabel="Project sections" />);
    expect(screen.getByRole('tab', { name: 'Settings' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('tab', { name: 'Codebases, 2' }).props.accessibilityState).toMatchObject({ selected: false });
  });

  it('selects on press', async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<TabRow tabs={[{ id: 'a', label: 'Codebases' }, { id: 'b', label: 'Chats' }]} active="a" onSelect={onSelect} accessibilityLabel="Project sections" testID="tabs" />);
    await user.press(screen.getByTestId('tabs-b'));
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});
