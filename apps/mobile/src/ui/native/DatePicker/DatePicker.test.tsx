import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { DatePicker } from './DatePicker';
import { androidComponents, formatDateValue, iosComponents, normalizeDate, stepDate } from './datePickerModel';
import { renderThemed } from '../../__tests__/themed';

const AT = new Date(Date.UTC(2026, 9, 2, 2, 7));

describe('DatePicker (MP-26)', () => {
  it('maps modes, rounds to the interval and clamps to the range', () => {
    expect(iosComponents('datetime')).toEqual(['date', 'hourAndMinute']);
    expect(androidComponents('time')).toBe('hourAndMinute');
    expect(normalizeDate(AT, { minuteInterval: 15 }).toISOString()).toBe('2026-10-02T02:00:00.000Z');
    expect(normalizeDate(AT, { minimumDate: new Date(Date.UTC(2026, 9, 3)) }).toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(stepDate(AT, 'date', 1).getTime() - AT.getTime()).toBe(86_400_000);
    expect(stepDate(AT, 'time', -1, 5).getTime() - AT.getTime()).toBe(-300_000);
    expect(formatDateValue(AT, 'time', 'UTC')).toMatch(/2:07|02:07/);
  });

  it('names the value and steps through accessibility actions', async () => {
    const onValueChange = jest.fn();
    await renderThemed(<DatePicker mode="time" value={AT} onValueChange={onValueChange} label="Run at" timeZone="UTC" minuteInterval={5} />);
    const control = screen.getByLabelText(/^Run at, /);
    fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect((onValueChange.mock.calls[0]![0] as Date).toISOString()).toBe('2026-10-02T02:10:00.000Z');
  });
});
