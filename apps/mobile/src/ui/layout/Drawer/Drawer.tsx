// ML-06 Drawer (03 ML-06; MSidebar, MTabletIOS, MTabletAndroid; MD-28, MD-59, MD-95): the sidebar content frame —
// header (server + New chat), the search field in button mode, the seven destinations, the live Needs you / Running
// sections, and a pinned footer (connection + Settings). Presentational: the shell fills the slots. Nav items are
// iOS rounded rows / Android pills (MD-02), min-h 44 / 48 (MD-59); live rows the same heights (the board's 40/36
// raised). Safe areas are paid inside the frame, so it works in the phone overlay and the tablet column alike.
import React from 'react';
import { ScrollView, View } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { Count } from '../../primitives/Count';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Spinner } from '../../primitives/Spinner';
import { Text } from '../../primitives/Text';
import type { DrawerLiveRowProps, DrawerNavItemProps, DrawerProps, DrawerSectionProps } from './Drawer.types';

export type { DrawerLiveRowProps, DrawerNavItemProps, DrawerProps, DrawerSectionProps } from './Drawer.types';

const android = nativePlatform === 'android';

export function Drawer({ header, search, nav, live, footer, variant, testID }: DrawerProps): React.ReactElement {
  const insets = useInsets();
  return (
    <View testID={testID} accessibilityLabel={variant === 'persistent' ? 'Sidebar' : undefined} className="flex-1" style={{ paddingTop: insets.top }}>
      <View className="min-h-panel-bar flex-row items-center gap-2 pe-3 ps-5">{header}</View>
      <View className="px-4 pb-2.5 pt-1">{search}</View>
      <ScrollView className="flex-1" contentContainerClassName="pb-3" showsVerticalScrollIndicator={false}>
        <View accessibilityLabel="Navigation" className="gap-0.5 px-3">
          {nav}
        </View>
        {live}
      </ScrollView>
      <View className="min-h-panel-bar flex-row items-center gap-2 border-t border-line-soft pe-2 ps-5" style={{ paddingBottom: insets.bottom }}>
        {footer}
      </View>
    </View>
  );
}

export function DrawerNavItem({ destination, label, icon, selected, onPress, count }: DrawerNavItemProps): React.ReactElement {
  return (
    <Pressable
      testID={`drawer-${destination}`}
      onPress={onPress}
      frame="none"
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count}` : label}
      accessibilityState={{ selected }}
      className={cn('min-h-nav flex-row items-center gap-3', android ? 'rounded-full px-4' : 'rounded-nav px-3', selected && 'bg-selected')}
    >
      <Icon concept={icon} size={20} tone={selected ? 'fg' : 'fg-2'} filled={selected} />
      <Text role="body" weight={500} tone={selected ? 'fg' : 'fg-2'} numberOfLines={1} chrome className="flex-1">
        {label}
      </Text>
      {count ? <Count value={count} hidden /> : null}
    </Pressable>
  );
}

export function DrawerSection({ label, count, countTone = 'fg-3', showAll, children, testID }: DrawerSectionProps): React.ReactElement {
  return (
    <View className="mt-3 px-3">
      <View testID={testID} accessibilityRole="header" accessibilityLabel={count ? `${label}, ${count}` : label} className="flex-row items-center gap-1.5 px-3 py-1.5">
        <Text role="footnote" weight={600} tone="fg-3" chrome>
          {label}
        </Text>
        {count ? <Count value={count} tone={countTone} hidden /> : null}
      </View>
      {children}
      {showAll ? (
        <Pressable onPress={showAll.onPress} frame="none" accessibilityRole="button" className={cn('min-h-item justify-center px-3', android ? 'rounded-full' : 'rounded-nav')}>
          <Text role="subhead" tone="fg-2" chrome>
            {showAll.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function DrawerLiveRow({ title, kind, trailing, trailingMono = false, onPress, accessibilityLabel, testID }: DrawerLiveRowProps): React.ReactElement {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      frame="none"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, kind === 'needs-you' ? 'needs you' : 'running', trailing].filter(Boolean).join(', ')}
      className={cn('min-h-item flex-row items-center gap-3 px-3', android ? 'rounded-full' : 'rounded-nav')}
    >
      {kind === 'needs-you' ? <Icon concept="hand" size={16} tone="warn" /> : <Spinner size={14} />}
      <Text role="subhead" tone={kind === 'needs-you' ? 'fg' : 'fg-2'} numberOfLines={1} chrome className="flex-1">
        {title}
      </Text>
      {trailing ? (
        <Text role={trailingMono ? 'monoSm' : 'footnote'} tone="fg-3" numberOfLines={1} chrome>
          {trailing}
        </Text>
      ) : null}
    </Pressable>
  );
}
