import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { Textarea } from './Textarea';
import { meterText, meterTone, rowBounds, utf8Bytes } from './textareaModel';
import { renderThemed } from '../../__tests__/themed';

describe('Textarea (MP-18)', () => {
  it('bounds growth by rows and formats the meter', () => {
    expect(rowBounds(24, 24, 3, 8)).toEqual({ minHeight: 96, maxHeight: 216 });
    expect(rowBounds(24, 0, 5, 2)).toEqual({ minHeight: 120, maxHeight: 120 });
    expect(meterText({ used: 2150, max: 32 * 1024, unit: 'bytes' })).toBe('2.1 KB of 32 KB');
    expect(meterText({ used: 12, max: 2000, unit: 'chars' })).toMatch(/^12 of 2.000 characters$|^12 of 2,000 characters$/);
    expect(meterTone({ used: 10, max: 100, unit: 'chars' })).toBe('fg-3');
    expect(meterTone({ used: 95, max: 100, unit: 'chars' })).toBe('warn');
    expect(meterTone({ used: 101, max: 100, unit: 'chars' })).toBe('err');
    expect(utf8Bytes('aé€😀')).toBe(10);
  });

  it('is a named multi-line field that reports text and shows the meter', async () => {
    const onChangeText = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Textarea label="Task" value="" onChangeText={onChangeText} meter={{ used: 0, max: 1024, unit: 'bytes' }} error="Required" />);
    const input = screen.getByLabelText('Task');
    expect(input.props.multiline).toBe(true);
    expect(input.props.accessibilityHint).toBe('Error: Required');
    await user.type(input, 'a');
    expect(onChangeText).toHaveBeenCalledWith('a');
    expect(screen.getByText('0 B of 1 KB')).toBeTruthy();
  });
});
