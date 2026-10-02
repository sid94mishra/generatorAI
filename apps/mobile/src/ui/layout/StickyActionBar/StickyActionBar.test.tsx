import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { StickyActionBar } from './StickyActionBar';
import { renderThemed } from '../../__tests__/themed';

describe('StickyActionBar (ML-23)', () => {
  it('shows the summary and runs the primary and secondary', async () => {
    const create = jest.fn();
    const back = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<StickyActionBar summary={{ title: 'Bug Fixer' }} secondary={{ label: 'Back', onPress: back }} primary={{ label: 'Create chat', onPress: create }} />);
    expect(screen.getByText('Bug Fixer')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Create chat' }));
    await user.press(screen.getByRole('button', { name: 'Back' }));
    expect(create).toHaveBeenCalled();
    expect(back).toHaveBeenCalled();
  });
});
