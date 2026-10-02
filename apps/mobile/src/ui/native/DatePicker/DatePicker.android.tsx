// MP-26 DatePicker — Android: the value button opens an M3 dialog hosting the Compose DateTimePicker through Expo UI
// (Cancel / OK text actions; the draft applies on OK). Without the ExpoUI module it is the JS path.
import React, { useState } from 'react';
import { Modal, Pressable as RNPressable, View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import { Button } from '../../primitives/Button';
import { Text } from '../../primitives/Text';
import { compose } from '../expoUi.android';
import type { DatePickerProps } from './DatePicker.types';
import { DatePickerJs, DateValueButton } from './DatePickerJs';
import { androidComponents, normalizeDate } from './datePickerModel';

export type { DatePickerMode, DatePickerProps } from './DatePicker.types';

export function DatePicker(props: DatePickerProps): React.ReactElement {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date | null>(null);
  if (!compose) return <DatePickerJs {...props} />;
  const { ui } = compose;
  const { mode, value, onValueChange, label, minimumDate, maximumDate } = props;
  const close = (): void => {
    setOpen(false);
    setDraft(null);
  };
  return (
    <>
      <DateValueButton props={props} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
        <RNPressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} className="absolute inset-0 bg-scrim" />
        <View className="flex-1 items-center justify-center p-6" pointerEvents="box-none">
          <View accessibilityViewIsModal className="w-full gap-2 rounded-dialog bg-overlay pb-2 pt-5 shadow-pop">
            <Text role="footnote" tone="fg-2" className="px-6">
              {label}
            </Text>
            <ui.Host matchContents={{ vertical: true }}>
              <ui.DateTimePicker
                initialDate={value.toISOString()}
                displayedComponents={androidComponents(mode)}
                variant="picker"
                color={colors.accent}
                selectableDates={{ start: minimumDate, end: maximumDate }}
                onDateSelected={setDraft}
              />
            </ui.Host>
            <View className="flex-row justify-end gap-2 px-3">
              <Button label="Cancel" variant="ghost" onPress={close} />
              <Button
                label="OK"
                variant="ghost"
                onPress={() => {
                  if (draft) onValueChange(normalizeDate(draft, props));
                  close();
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
