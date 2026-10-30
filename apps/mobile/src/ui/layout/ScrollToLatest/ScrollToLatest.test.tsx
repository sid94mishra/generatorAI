import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { ScrollToLatest } from './ScrollToLatest';
import { renderThemed, themed } from '../../__tests__/themed';

describe('ScrollToLatest (ML-26)', () => {
  it('is named from the shared copy, counts new turns, and hides', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    const { rerender } = await renderThemed(<ScrollToLatest visible onPress={onPress} newCount={3} />);
    await user.press(screen.getByRole('button', { name: 'Jump to latest, 3 new' }));
    expect(onPress).toHaveBeenCalled();
    await rerender(themed(<ScrollToLatest visible={false} onPress={onPress} />));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
