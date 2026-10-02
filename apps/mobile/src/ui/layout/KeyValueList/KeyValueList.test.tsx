import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { KeyValueList } from './KeyValueList';
import { renderThemed } from '../../__tests__/themed';

describe('KeyValueList (ML-19)', () => {
  it('names rows "label, value" and copies copyable values', async () => {
    const user = userEvent.setup();
    await renderThemed(<KeyValueList items={[{ label: 'Version', value: '0.42.1' }, { label: 'Server', value: 'local:3100', copyable: true }]} />);
    expect(screen.getByLabelText('Version, 0.42.1')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Copy Server' }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('local:3100');
  });
});
