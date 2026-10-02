import React from 'react';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';
import { BulkActionBar } from './BulkActionBar';
import { renderThemed } from '../../__tests__/themed';

describe('BulkActionBar (ML-25)', () => {
  it('names the count, runs actions and offers Select all / Cancel', async () => {
    const del = jest.fn();
    const onSelectAll = jest.fn();
    const onCancel = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<BulkActionBar count={2} actions={[{ id: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: del, testID: 'chats-bulk-delete' }]} onSelectAll={onSelectAll} onCancel={onCancel} />);
    await user.press(screen.getByTestId('chats-bulk-delete'));
    expect(del).toHaveBeenCalled();
    const label = screen.getByLabelText('2 selected');
    fireEvent(label, 'accessibilityAction', { nativeEvent: { actionName: 'selectAll' } });
    fireEvent(label, 'accessibilityAction', { nativeEvent: { actionName: 'cancel' } });
    expect(onSelectAll).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
