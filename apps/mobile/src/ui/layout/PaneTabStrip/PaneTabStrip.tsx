// ML-08 PaneTabStrip (03 ML-08; MPaneOpen, MPaneTabsOverview, MPaneTerminal; MD-02, MD-23, MD-91): the pane's tab
// row — iOS pills (h32 drawn inside a 44 frame), Android underline tabs (h48, a 3 dp fg indicator). A horizontal
// scroller that never closes the panel (HorizontalScrollGuard) and brings the active tab into view; counts inline in
// mono, a warn dot when a tab needs you; tap-only switching with a selection haptic. `instanceChips` draws Terminal
// instances / Browser pages as chips inside their tab, with ✕ and a trailing "+" hidden at the cap.
import React, { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { Count } from '../../primitives/Count';
import { Chip } from '../../primitives/Chip';
import { Icon } from '../../primitives/Icon';
import { IconButton } from '../../primitives/IconButton';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import { HorizontalScrollGuard } from '../SidePanel';
import type { PaneTabStripProps } from './PaneTabStrip.types';
import { paneTabLabel, paneTabTestID } from './paneTabModel';

export type { PaneTab, PaneTabStripProps } from './PaneTabStrip.types';

const android = nativePlatform === 'android';

export function PaneTabStrip({ tabs, active, onSelect, variant = 'tabs', onClose, onAdd, addLabel, accessibilityLabel, testID }: PaneTabStripProps): React.ReactElement {
  const scroller = useRef<ScrollView | null>(null);
  const offsets = useRef<Record<string, number>>({});
  useEffect(() => {
    const x = offsets.current[active];
    if (x !== undefined) scroller.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  }, [active]);

  return (
    <View testID={testID} className={cn('flex-row items-center', variant === 'tabs' && android && 'border-b border-line-soft')}>
      <HorizontalScrollGuard>
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          accessibilityRole="tablist"
          accessibilityLabel={accessibilityLabel}
          className="flex-1"
          contentContainerClassName={cn('items-center', variant === 'tabs' ? (android ? 'px-2' : 'gap-1 px-3') : 'gap-2 px-4')}
        >
          {tabs.map((tab) => {
            const selected = tab.id === active;
            const onLayout = (e: { nativeEvent: { layout: { x: number } } }): void => {
              offsets.current[tab.id] = e.nativeEvent.layout.x;
            };
            if (variant === 'instanceChips') {
              return (
                <View key={tab.id} onLayout={onLayout}>
                  <Chip
                    label={tab.label}
                    icon={tab.icon}
                    selected={selected}
                    count={tab.count}
                    onPress={() => onSelect(tab.id)}
                    onRemove={tab.closable && onClose ? () => onClose(tab.id) : undefined}
                    variant={tab.closable && onClose ? 'input' : 'filter'}
                    testID={paneTabTestID(tab, 'instanceChips')}
                  />
                </View>
              );
            }
            return (
              <View key={tab.id} onLayout={onLayout}>
                <Pressable
                  testID={paneTabTestID(tab, 'tabs')}
                  onPress={() => onSelect(tab.id)}
                  haptic="selection"
                  feedback={android ? 'highlight' : 'none'}
                  accessibilityRole="tab"
                  accessibilityLabel={paneTabLabel(tab)}
                  accessibilityState={{ selected }}
                  className={cn('justify-center', android ? 'min-h-item px-3' : 'min-h-hit')}
                >
                  <View className={cn('flex-row items-center gap-1.5', android ? 'flex-1' : cn('h-tab rounded-control-sm px-3', selected && 'bg-selected'))}>
                    <Icon concept={tab.icon} size={16} tone={selected ? 'fg' : 'fg-2'} />
                    <Text role="subhead" weight={500} tone={selected ? 'fg' : 'fg-2'} chrome numberOfLines={1}>
                      {tab.label}
                    </Text>
                    {tab.count ? <Count value={tab.count} hidden /> : null}
                    {tab.attention ? <Count value={0} form="dot" tone="warn" /> : null}
                  </View>
                  {android && selected ? <View className="absolute bottom-0 end-3 start-3 h-0.75 rounded-t-badge bg-fg" /> : null}
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      </HorizontalScrollGuard>
      {variant === 'instanceChips' && onAdd ? <IconButton icon="plus" size="sm" label={addLabel ?? 'Add'} onPress={onAdd} /> : null}
    </View>
  );
}
