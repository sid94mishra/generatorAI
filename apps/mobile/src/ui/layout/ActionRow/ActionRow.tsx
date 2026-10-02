// ActionRow: the action row of a gate card (MB-15) and the approval sheet (MB-50). iOS draws the actions
// equal-width side by side (`md`); Android end-aligns them with quiet ones at the start; a narrow row (< 360) or a
// large text size stacks them full-width, primary first (MD-50). Roles map to Button variants; an optional note
// ("Face ID required") sits under the row.
import React, { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { Button } from '../../primitives/Button';
import { Text } from '../../primitives/Text';
import type { ActionRowProps, RowAction } from './ActionRow.types';
import { actionLayout, buttonVariant, stackedOrder } from './actionRowModel';

export type { ActionRole, ActionRowProps, RowAction } from './ActionRow.types';

function ActionButton({ action, fullWidth }: { action: RowAction; fullWidth: boolean }): React.ReactElement {
  return (
    <Button
      label={action.label}
      variant={buttonVariant(action.role)}
      size="md"
      fullWidth={fullWidth}
      onPress={action.onPress}
      {...(action.icon ? { icon: action.icon } : {})}
      {...(action.disabled !== undefined ? { disabled: action.disabled } : {})}
      {...(action.disabledReason ? { disabledReason: action.disabledReason } : {})}
      {...(action.loading !== undefined ? { loading: action.loading } : {})}
      {...(action.accessibilityLabel ? { accessibilityLabel: action.accessibilityLabel } : {})}
      {...(action.testID ? { testID: action.testID } : {})}
    />
  );
}

export function ActionRow({ actions, note, testID }: ActionRowProps): React.ReactElement {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const layout = actionLayout(nativePlatform, width, fontScale);
  const quiet = actions.filter((a) => a.role === 'quiet');
  const rest = actions.filter((a) => a.role !== 'quiet');
  return (
    <View testID={testID} className="gap-2" onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {layout === 'stacked' ? (
        <View className="gap-2">
          {stackedOrder(actions).map((a) => (
            <ActionButton key={a.id} action={a} fullWidth />
          ))}
        </View>
      ) : layout === 'equal' ? (
        <View className="flex-row gap-2">
          {actions.map((a) => (
            <View key={a.id} className="flex-1">
              <ActionButton action={a} fullWidth />
            </View>
          ))}
        </View>
      ) : (
        <View className="flex-row items-center gap-2">
          {quiet.map((a) => (
            <ActionButton key={a.id} action={a} fullWidth={false} />
          ))}
          <View className="flex-1" />
          {rest.map((a) => (
            <ActionButton key={a.id} action={a} fullWidth={false} />
          ))}
        </View>
      )}
      {note ? (
        <Text role="footnote" tone="fg-3" align={layout === 'end' ? 'end' : 'center'} className={cn(layout === 'stacked' && 'self-center')}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}
