import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { IconButton } from '../../primitives/IconButton';
import { Menu } from './Menu';
import type { MenuEntry } from './Menu.types';
import { panelPosition } from './MenuJs';
import { entriesAt, findMenuItem, menuActions, menuGroups } from './menuModel';
import { renderThemed } from '../../__tests__/themed';

const ITEMS: MenuEntry[] = [
  { id: 'rename', label: 'Rename', icon: 'edit' },
  { id: 'move', label: 'Move to', children: [{ id: 'inbox', label: 'Inbox' }, { id: 'later', label: 'Later', disabled: true }] },
  { type: 'separator' },
  { id: 'delete', label: 'Delete', destructive: true },
];

describe('Menu (MP-27)', () => {
  it('groups, finds and flattens entries for accessibility actions', () => {
    expect(menuGroups(ITEMS).map((g) => g.map((i) => i.id))).toEqual([['rename', 'move'], ['delete']]);
    expect(findMenuItem(ITEMS, 'inbox')?.label).toBe('Inbox');
    expect(entriesAt(ITEMS, ['move'])).toHaveLength(2);
    expect(menuActions(ITEMS)).toEqual([
      { name: 'rename', label: 'Rename' },
      { name: 'inbox', label: 'Move to › Inbox' },
      { name: 'delete', label: 'Delete' },
    ]);
    expect(panelPosition({ x: 300, y: 100, width: 44, height: 44 }, { width: 402, height: 874 })).toEqual({ top: 148, left: 104, width: 240 });
    expect(panelPosition({ x: 16, y: 100, width: 370, height: 56 }, { width: 402, height: 874 }, true)).toEqual({ top: 160, left: 16, width: 370 });
  });

  it('opens from its trigger, walks into a submenu and selects', async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Menu items={ITEMS} onSelect={onSelect} trigger={<IconButton icon="more" label="More" onPress={() => undefined} />} />);
    await user.press(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    await user.press(screen.getByRole('menuitem', { name: 'Move to' }));
    await user.press(screen.getByRole('menuitem', { name: 'Inbox' }));
    expect(onSelect).toHaveBeenCalledWith('inbox');
  });
});
