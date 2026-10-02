import React from 'react';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';
import { EntityRow } from './EntityRow';
import { entityRowLabel } from './entityRowModel';
import { renderThemed } from '../../__tests__/themed';

const NOW = Date.parse('2026-10-02T12:00:00Z');

describe('EntityRow (ML-14)', () => {
  it('speaks status word, title, states, meta and time', () => {
    expect(entityRowLabel({ leading: { status: 'needs_you' }, title: 'Fix flaky test', meta: ['payments-service'], time: '2026-10-02T11:57:00Z', pinned: true, unread: true }, NOW)).toBe(
      'Needs you, Fix flaky test, pinned, unread, payments-service, 3 minutes ago',
    );
  });

  it('is a checkbox in selection mode (MD-60)', async () => {
    await renderThemed(<EntityRow title="Draft" leading={{ checkbox: true }} onPress={jest.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Draft' }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it('opens on press and exposes menu and swipe actions to assistive tech', async () => {
    const onPress = jest.fn();
    const onMenuSelect = jest.fn();
    const archive = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <EntityRow
        title="Fix flaky test"
        leading={{ status: 'needs_you' }}
        onPress={onPress}
        menu={[{ id: 'pin', label: 'Pin' }]}
        onMenuSelect={onMenuSelect}
        swipeActions={[{ id: 'archive', label: 'Archive', onPress: archive }]}
      />,
    );
    const row = screen.getByRole('button', { name: /Fix flaky test/ });
    await user.press(row);
    expect(onPress).toHaveBeenCalled();
    expect(row.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(['pin', 'archive']);
    fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'archive' } });
    fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'pin' } });
    expect(archive).toHaveBeenCalled();
    expect(onMenuSelect).toHaveBeenCalledWith('pin');
  });

});
