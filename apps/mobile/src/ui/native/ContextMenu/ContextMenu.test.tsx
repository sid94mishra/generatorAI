import React from 'react';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { MenuEntry } from '../Menu/Menu.types';
import { ContextMenu } from './ContextMenu';
import { CONTEXT_MENU_HINT, contextTargetProps } from './contextMenuModel';
import { renderThemed } from '../../__tests__/themed';

const ITEMS: MenuEntry[] = [
  { id: 'pin', label: 'Pin' },
  { id: 'old', label: 'Old', disabled: true },
  { type: 'separator' },
  { id: 'delete', label: 'Delete', destructive: true },
];

describe('ContextMenu (MP-28)', () => {
  it('turns enabled items into accessibility actions with the long-press hint (MD-28)', () => {
    const onSelect = jest.fn();
    const props = contextTargetProps({ items: ITEMS, onSelect }, 'Opens the chat');
    expect(props.accessibilityActions).toEqual([{ name: 'pin', label: 'Pin' }, { name: 'delete', label: 'Delete' }]);
    expect(props.accessibilityHint).toBe(`Opens the chat. ${CONTEXT_MENU_HINT}`);
    expect(contextTargetProps({ items: ITEMS, onSelect, disabled: true })).toEqual({});
  });

  it('opens on long press, runs actions from assistive tech, and keeps the row tap', async () => {
    const onSelect = jest.fn();
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <ContextMenu items={ITEMS} onSelect={onSelect}>
        <Pressable frame="none" onPress={onPress} accessibilityLabel="Fix flaky checkout test">
          <Text>Fix flaky checkout test</Text>
        </Pressable>
      </ContextMenu>,
    );
    const row = screen.getByRole('button', { name: 'Fix flaky checkout test' });
    expect(row.props.accessibilityHint).toBe(CONTEXT_MENU_HINT);
    fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(onSelect).toHaveBeenCalledWith('delete');
    await user.press(row);
    expect(onPress).toHaveBeenCalled();
    await user.longPress(row);
    await user.press(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(onSelect).toHaveBeenLastCalledWith('pin');
  });
});
