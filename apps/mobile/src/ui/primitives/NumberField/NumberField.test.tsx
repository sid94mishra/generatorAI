import React from 'react';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';
import { NumberField } from './NumberField';
import { canStep, clampStep } from './numberFieldModel';
import { renderThemed } from '../../__tests__/themed';

describe('NumberField (MP-43)', () => {
  it('steps within bounds without float drift', () => {
    expect(clampStep(0.1, 0.2)).toBe(0.3);
    expect(clampStep(8, 1, 1, 8)).toBe(8);
    expect(clampStep(1, -1, 1, 8)).toBe(1);
    expect(canStep(8, 1, 1, 8)).toBe(false);
    expect(canStep(8, -1, 1, 8)).toBe(true);
  });

  it('is one adjustable element with increment / decrement actions and visible buttons', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<NumberField label="Max turns" value={20} min={1} max={20} onValueChange={onValueChange} format={(v) => `${v} turns`} />);
    const field = screen.getByLabelText('Max turns');
    expect(field.props.accessibilityRole).toBe('adjustable');
    expect(field.props.accessibilityValue).toMatchObject({ now: 20, max: 20, text: '20 turns' });
    fireEvent(field, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onValueChange).toHaveBeenLastCalledWith(19);
    fireEvent(field, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    await user.press(screen.getByLabelText('Decrease Max turns'));
    expect(onValueChange).toHaveBeenCalledTimes(2);
  });
});
