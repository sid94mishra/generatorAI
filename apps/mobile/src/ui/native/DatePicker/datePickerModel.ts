// Pure DatePicker logic (03 MP-26): native component sets, clamping, minute rounding and the shown / spoken value.
import type { DatePickerMode, DatePickerProps } from './DatePicker.types';

export function iosComponents(mode: DatePickerMode): Array<'date' | 'hourAndMinute'> {
  return mode === 'date' ? ['date'] : mode === 'time' ? ['hourAndMinute'] : ['date', 'hourAndMinute'];
}

export function androidComponents(mode: DatePickerMode): 'date' | 'hourAndMinute' | 'dateAndTime' {
  return mode === 'date' ? 'date' : mode === 'time' ? 'hourAndMinute' : 'dateAndTime';
}

/** Rounds to the minute interval, then clamps into [minimumDate, maximumDate]. */
export function normalizeDate(date: Date, { minuteInterval, minimumDate, maximumDate }: Pick<DatePickerProps, 'minuteInterval' | 'minimumDate' | 'maximumDate'>): Date {
  let ms = date.getTime();
  if (minuteInterval && minuteInterval > 1) {
    const step = minuteInterval * 60_000;
    ms = Math.round(ms / step) * step;
  }
  if (minimumDate) ms = Math.max(ms, minimumDate.getTime());
  if (maximumDate) ms = Math.min(ms, maximumDate.getTime());
  return new Date(ms);
}

/** One adjustable step: a day for dates, the minute interval (default 1) for times. */
export function stepDate(date: Date, mode: DatePickerMode, direction: 1 | -1, minuteInterval = 1): Date {
  const ms = mode === 'date' ? 86_400_000 : minuteInterval * 60_000;
  return new Date(date.getTime() + direction * ms);
}

export function formatDateValue(date: Date, mode: DatePickerMode, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions =
    mode === 'date' ? { dateStyle: 'medium' } : mode === 'time' ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(date);
}
