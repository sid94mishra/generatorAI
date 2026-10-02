import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { Checkbox, nextChecked } from './Checkbox';
import { renderThemed } from '../../__tests__/themed';

describe('Checkbox (MP-20)', () => {
  it('is a checkbox with its state; indeterminate reads as mixed and checks on press', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Checkbox checked="indeterminate" onValueChange={onValueChange} label="Select all" />);
    const box = screen.getByRole('checkbox', { name: 'Select all' });
    expect(box.props.accessibilityState).toMatchObject({ checked: 'mixed' });
    await user.press(box);
    expect(onValueChange).toHaveBeenCalledWith(true);
    expect(nextChecked(true)).toBe(false);
    expect(nextChecked(false)).toBe(true);
  });

  it('blocks presses when disabled and keeps a hit frame without a label', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Checkbox checked={false} onValueChange={onValueChange} accessibilityLabel="Select chat" disabled testID="cb" />);
    await user.press(screen.getByRole('checkbox', { name: 'Select chat' }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('cb').props.className).toContain('min-h-hit');
  });
});
