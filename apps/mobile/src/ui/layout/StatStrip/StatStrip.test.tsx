import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { StatStrip, statValue } from './StatStrip';
import { renderThemed } from '../../__tests__/themed';

describe('StatStrip (ML-18)', () => {
  it('reads unknown as — and never 0', () => {
    expect(statValue(null)).toBe('—');
    expect(statValue(0)).toBe('0');
  });

  it('names tiles "value, label" and presses them', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<StatStrip variant="tiles" items={[{ id: 'n', value: 3, label: 'Need you', tone: 'warn', onPress }]} />);
    await user.press(screen.getByRole('button', { name: '3, Need you' }));
    expect(onPress).toHaveBeenCalled();
  });
});
