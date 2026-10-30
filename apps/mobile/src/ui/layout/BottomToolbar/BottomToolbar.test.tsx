import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { BottomToolbar } from './BottomToolbar';
import { renderThemed } from '../../__tests__/themed';

describe('BottomToolbar (ML-27)', () => {
  it('renders navigation, actions and the primary as named buttons', async () => {
    const next = jest.fn();
    const retry = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<BottomToolbar nav={[{ icon: 'chevron-down', label: 'Next step', onPress: next }]} primary={{ label: 'Retry step', icon: 'retry', onPress: retry }} />);
    await user.press(screen.getByRole('button', { name: 'Next step' }));
    await user.press(screen.getByRole('button', { name: 'Retry step' }));
    expect(next).toHaveBeenCalled();
    expect(retry).toHaveBeenCalled();
  });
});
