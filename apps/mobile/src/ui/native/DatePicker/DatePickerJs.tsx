// MP-26 DatePicker — the drawn value button shared by Android (it opens the M3 dialog) and the JS path (Jest, web,
// clients without Expo UI), where it is an adjustable element stepping by a day or the minute interval.
import React from 'react';

import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { DatePickerProps } from './DatePicker.types';
import { formatDateValue, normalizeDate, stepDate } from './datePickerModel';

export function DateValueButton({ props, onPress }: { props: DatePickerProps; onPress?: () => void }): React.ReactElement {
  const { mode, value, label, timeZone, testID } = props;
  const text = formatDateValue(value, mode, timeZone);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : 'adjustable'}
      accessibilityLabel={`${label}, ${text}`}
      accessibilityHint={onPress ? 'Opens a picker' : undefined}
      accessibilityActions={onPress ? undefined : [{ name: 'increment', label: 'Later' }, { name: 'decrement', label: 'Earlier' }]}
      onAccessibilityAction={(name) => props.onValueChange(normalizeDate(stepDate(value, mode, name === 'increment' ? 1 : -1, props.minuteInterval), props))}
      feedback="highlight"
      className="self-start"
    >
      <Text role="subhead" weight={500} className="min-h-control-sm rounded-control bg-selected px-3 py-2" tabular>
        {text}
      </Text>
    </Pressable>
  );
}

export function DatePickerJs(props: DatePickerProps): React.ReactElement {
  return <DateValueButton props={props} />;
}
