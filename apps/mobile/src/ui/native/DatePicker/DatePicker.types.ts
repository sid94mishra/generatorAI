// MP-26 DatePicker contract (03 MP-26).
export type DatePickerMode = 'date' | 'time' | 'datetime';

export interface DatePickerProps {
  mode: DatePickerMode;
  value: Date;
  onValueChange: (d: Date) => void;
  /** Accessible name ("Run at"). */
  label: string;
  minimumDate?: Date;
  maximumDate?: Date;
  /** IANA zone the value is shown in (formatting only; the Date itself is absolute). */
  timeZone?: string;
  /** Minutes are rounded to this interval. */
  minuteInterval?: 1 | 5 | 15 | 30;
  /** iOS: 'compact' in rows (default), 'wheel' in sheets. Android always opens the M3 dialog. */
  display?: 'compact' | 'wheel';
  testID?: string;
}
