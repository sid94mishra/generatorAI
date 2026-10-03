// TabRow (03 ML-08 page-tab form; MProjectDetail, MCodebase; R-3): a screen's top tabs — iOS pills (h32 in a 44 frame,
// the selected one on `bg-selected`), Android underline tabs (h48, a 3 dp fg indicator, a hairline under the row). A
// horizontal scroller that brings the active tab into view; counts inline in mono; a selection haptic. The pane's tab
// row (ML-08 PaneTabStrip) adds icons, attention dots and instance chips; this is the plain page form.
import React, { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { TabRowProps } from './TabRow.types';

export type { TabRowItem, TabRowProps } from './TabRow.types';

const android = nativePlatform === 'android';

/** "Codebases, 2" for assistive tech. */
export function tabRowLabel(tab: { label: string; count?: number }): string {
  return tab.count !== undefined ? `${tab.label}, ${tab.count}` : tab.label;
}

export function TabRow({ tabs, active, onSelect, accessibilityLabel, testID }: TabRowProps): React.ReactElement {
  const scroller = useRef<ScrollView | null>(null);
  const offsets = useRef<Record<string, number>>({});
  useEffect(() => {
    const x = offsets.current[active];
    if (x !== undefined) scroller.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  }, [active]);
  return (
    <View testID={testID} className={cn(android && 'border-b border-line-soft')}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        contentContainerClassName={cn('items-center', android ? 'px-2' : 'gap-1 px-3')}
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <View key={tab.id} onLayout={(e) => (offsets.current[tab.id] = e.nativeEvent.layout.x)}>
              <Pressable
                testID={testID ? `${testID}-${tab.id}` : undefined}
                onPress={() => onSelect(tab.id)}
                haptic="selection"
                feedback={android ? 'highlight' : 'none'}
                accessibilityRole="tab"
                accessibilityLabel={tabRowLabel(tab)}
                accessibilityState={{ selected }}
                className={cn('justify-center', android ? 'min-h-item px-3' : 'min-h-hit')}
              >
                <View className={cn('flex-row items-center gap-1.5', android ? 'h-full' : cn('h-tab rounded-control-sm px-3', selected && 'bg-selected'))}>
                  <Text role="subhead" weight={selected ? 600 : 500} tone={selected ? 'fg' : 'fg-2'} chrome numberOfLines={1}>
                    {tab.label}
                  </Text>
                  {tab.count !== undefined ? (
                    <Text role="monoSm" tone="fg-3" chrome>
                      {tab.count}
                    </Text>
                  ) : null}
                </View>
                {android && selected ? <View className="absolute bottom-0 end-3 start-3 h-0.75 rounded-t-badge bg-fg" /> : null}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
