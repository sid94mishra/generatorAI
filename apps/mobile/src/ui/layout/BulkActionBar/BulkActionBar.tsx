// ML-25 BulkActionBar (03 ML-25; MD-60): selection mode replaces the NewAction. iOS: a bottom glass capsule h52 with
// "N selected" and icon actions (Archive, Delete in err, More). Android: the M3 bottom app bar (h80, raised) with the
// same actions. The header carries Cancel / Select all; both are also accessibility actions on the bar. The count is
// announced when it changes.
import React, { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { cn } from '../../lib/cn';
import { GlassSurface } from '../../native/GlassSurface';
import { nativePlatform } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { BulkAction, BulkActionBarProps } from './BulkActionBar.types';

export type { BulkAction, BulkActionBarProps } from './BulkActionBar.types';

export function selectedText(count: number): string {
  return `${count} selected`;
}

function Action({ action }: { action: BulkAction }): React.ReactElement {
  const android = nativePlatform === 'android';
  return (
    <Pressable testID={action.testID} onPress={action.onPress} disabled={action.disabled} feedback="scale" borderless accessibilityRole="button" accessibilityLabel={action.label}>
      <View collapsable={false} className={cn('items-center justify-center', action.disabled && 'opacity-40')}>
        <Icon concept={action.icon} size={android ? 24 : 22} tone={action.destructive ? 'err' : 'fg'} />
      </View>
    </Pressable>
  );
}

export function BulkActionBar({ count, actions, onSelectAll, onCancel, testID }: BulkActionBarProps): React.ReactElement {
  const insets = useInsets();
  const android = nativePlatform === 'android';
  const text = selectedText(count);
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(text);
  }, [text]);
  const a11y = {
    accessibilityLabel: text,
    accessibilityActions: [
      { name: 'selectAll', label: 'Select all' },
      { name: 'cancel', label: 'Cancel selection' },
    ],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => (e.nativeEvent.actionName === 'selectAll' ? onSelectAll() : onCancel()),
  };
  const content = (
    <>
      <View accessible {...a11y} className="flex-1">
        <Text role="subhead" weight={600} numberOfLines={1}>
          {text}
        </Text>
      </View>
      {actions.map((a) => (
        <Action key={a.id} action={a} />
      ))}
    </>
  );
  if (android) {
    return (
      <View testID={testID} className="min-h-20 flex-row items-center gap-1 bg-raised pe-2 ps-4" style={{ paddingBottom: insets.bottom }}>
        {content}
      </View>
    );
  }
  return (
    <View className="px-3" style={{ paddingBottom: insets.bottom + 6 }}>
      <GlassSurface testID={testID} radiusStep="full" className="min-h-13 flex-row items-center gap-1 pe-1.5 ps-5">
        {content}
      </GlassSurface>
    </View>
  );
}
