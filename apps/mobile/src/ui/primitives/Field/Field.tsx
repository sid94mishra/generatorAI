// MP-19 Field (03 MP-19): label (+ " · required", provenance) over one control, then help or error. iOS insets the
// help 6 16, Android 4 16. The help / error also reach the control as its accessibilityHint (fieldContext).
import React, { useMemo } from 'react';
import { View } from 'react-native';

import { Icon } from '../Icon';
import { Text } from '../Text';
import type { FieldProps } from './Field.types';
import { FieldContext } from './fieldContext';

export type { FieldContextValue, FieldProps } from './Field.types';

export function Field({ label, help, error, required = false, provenance, children, testID }: FieldProps): React.ReactElement {
  const context = useMemo(() => ({ hint: error ?? help, invalid: Boolean(error), required }), [error, help, required]);
  return (
    <View testID={testID} className="gap-1.5">
      {label ? (
        <View className="flex-row items-center gap-2 px-1">
          <Text role="footnote" tone="fg-2" weight={500} className="shrink">
            {required ? `${label} · required` : label}
          </Text>
          {provenance}
        </View>
      ) : null}
      <FieldContext.Provider value={context}>{children}</FieldContext.Provider>
      {error ? (
        <View className="flex-row items-center gap-1.5 px-4 ios:pt-0.5 android:pt-0">
          <Icon concept="status-failed" size={14} tone="err" />
          <Text role="footnote" tone="err" className="shrink" accessibilityRole="text">
            {error}
          </Text>
        </View>
      ) : help ? (
        <Text role="footnote" tone="fg-3" className="px-4 ios:pt-0.5 android:pt-0">
          {help}
        </Text>
      ) : null}
    </View>
  );
}
