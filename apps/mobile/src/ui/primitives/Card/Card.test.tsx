import React from 'react';
import { Text } from 'react-native';
import { screen, userEvent } from '@testing-library/react-native';
import { Card, cardClass } from './Card';
import { renderThemed } from '../../__tests__/themed';

describe('Card (MP-46)', () => {
  it('maps radii, outline and padding to tokens (MD-50)', () => {
    expect(cardClass('gate', true, 'none')).toBe('bg-raised rounded-card-lg border border-line-soft');
    expect(cardClass('card', false, 'md')).toContain('rounded-card');
  });
  it('is a button when pressable', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Card onPress={onPress} accessibilityLabel="Open project"><Text>x</Text></Card>);
    await user.press(screen.getByRole('button', { name: 'Open project' }));
    expect(onPress).toHaveBeenCalled();
  });
});
