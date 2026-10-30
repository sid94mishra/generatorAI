import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { SectionHeader } from './SectionHeader';
import { renderThemed } from '../../__tests__/themed';

describe('SectionHeader (ML-20)', () => {
  it('is a header with its count and action', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<SectionHeader title="Needs you" variant="home" count={3} action={{ label: 'See all', onPress }} />);
    expect(screen.getByRole('header', { name: 'Needs you' })).toBeTruthy();
    await user.press(screen.getByRole('link', { name: 'See all' }));
    expect(onPress).toHaveBeenCalled();
  });
});
