import React from 'react';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { ListRow } from './ListRow';
import { listRowColumns, listRowLabel, listRowPress, listRowRole } from './listRowModel';
import { renderThemed } from '../../__tests__/themed';

describe('ListRow (ML-13)', () => {
  it('maps kinds to roles, names and presses', () => {
    expect(listRowRole('toggle')).toBe('switch');
    expect(listRowRole('radio')).toBe('radio');
    expect(listRowRole('value')).toBeUndefined();
    expect(listRowLabel({ kind: 'navigation', title: 'General', subtitle: 'Defaults', value: 'Sonnet' })).toBe('General, Defaults, Sonnet');
    expect(listRowLabel({ kind: 'requires-admin', title: 'Network' })).toBe('Network, Requires admin access');
    const onValueChange = jest.fn();
    listRowPress({ kind: 'toggle', switchValue: true, onValueChange })!();
    expect(onValueChange).toHaveBeenCalledWith(false);
    expect(listRowPress({ kind: 'value', onPress: jest.fn() })).toBeUndefined();
    // A trailing detail gets the remaining width; the title only what it needs (device review).
    expect(listRowColumns('navigation', '1 of 2 connected')).toEqual({ title: 'max-w-3/5 shrink-0', trailing: 'flex-1 justify-end' });
    expect(listRowColumns('navigation')).toEqual({ title: 'flex-1', trailing: '' });
    expect(listRowColumns('toggle', 'x').title).toBe('flex-1');
  });

  it('toggles from the whole row, which carries the switch state', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<ListRow kind="toggle" title="Haptics" switchValue={false} onValueChange={onValueChange} />);
    const row = screen.getByRole('switch', { name: 'Haptics' });
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
    await user.press(row);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('selects radio rows, navigates, and blocks disabled rows', async () => {
    const pick = jest.fn();
    const go = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <>
        <ListRow kind="radio" title="Plan" selected onPress={pick} />
        <ListRow kind="navigation" title="General" value="Sonnet" onPress={go} />
        <ListRow kind="navigation" title="MCP" onPress={go} disabled disabledReason="Server offline" />
      </>,
    );
    expect(screen.getByRole('radio', { name: 'Plan' }).props.accessibilityState).toMatchObject({ checked: true });
    await user.press(screen.getByRole('radio', { name: 'Plan' }));
    await user.press(screen.getByRole('button', { name: 'General, Sonnet' }));
    await user.press(screen.getByRole('button', { name: 'MCP' }));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('copies a copyable value through its accessibility action', async () => {
    const spy = jest.spyOn(Clipboard, 'setStringAsync').mockResolvedValue(true);
    await renderThemed(<ListRow kind="value" title="Server" value="local:3100" copyable />);
    fireEvent(screen.getByLabelText('Server, local:3100'), 'accessibilityAction', { nativeEvent: { actionName: 'copy' } });
    expect(spy).toHaveBeenCalledWith('local:3100');
  });
});
