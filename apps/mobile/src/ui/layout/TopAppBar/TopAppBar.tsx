// The Android M3 top app bar (03 ML-02 Android column; MD-18, MD-85, MD-86, MD-94), drawn in JS because neither Expo UI
// nor react-native-screens exposes the M3 bars. h-bar 64 under the status bar: the sidebar toggle (`menu-button`) /
// ← back / ✕ cancel, the title (Title L at module roots; Breadcrumb 12 over detailTitle 18/600 on details; Title L in
// modals), ≤ 2 trailing icon buttons + ⋮ overflow, the pane toggle with its count on workspaces, and the modal's
// 14/600 text confirm. Home alone has the large headline below the bar (MD-94). The bar turns raised when content
// scrolls under it. Also the web preview's header.
import React from 'react';
import { View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { Menu } from '../../native/Menu';
import type { MenuEntry } from '../../native/Menu/Menu.types';
import type { HeaderAction, HeaderProps } from '../../native/router/Header/Header.types';
import { actionTestID, backLabel, paneToggleLabel, sidebarToggleLabel, splitActions } from '../../native/router/Header/headerModel';
import { useFontScale, useFontScaleOverride } from '../../platform/fontScale';
import { useInsets } from '../../platform/insets';
import { Count } from '../../primitives/Count';
import { IconButton } from '../../primitives/IconButton';
import { Pressable } from '../../primitives/Pressable';
import { Spinner } from '../../primitives/Spinner';
import { Text } from '../../primitives/Text';
import { Breadcrumb } from '../Breadcrumb';
import { StatusLine } from '../StatusLine';

export type { HeaderProps } from '../../native/router/Header/Header.types';

function ActionButton({ action }: { action: HeaderAction }): React.ReactElement {
  const button = <IconButton icon={action.icon} label={action.label} selected={action.selected} badge={action.badge} onPress={action.onPress ?? (() => undefined)} testID={actionTestID(action)} />;
  if (!action.menu?.length) return button;
  return <Menu items={action.menu} onSelect={(id) => action.onMenuSelect?.(id)} trigger={button} accessibilityLabel={action.label} />;
}

function Overflow({ actions }: { actions: HeaderAction[] }): React.ReactElement | null {
  if (!actions.length) return null;
  const items: MenuEntry[] = actions.map((a) => ({ id: a.id, label: a.label, icon: a.icon, destructive: a.destructive, testID: actionTestID(a) }));
  return (
    <Menu
      items={items}
      onSelect={(id) => actions.find((a) => a.id === id)?.onPress?.()}
      trigger={<IconButton icon="more-vertical" label="More options" onPress={() => undefined} testID="header-overflow" />}
      accessibilityLabel="More options"
    />
  );
}

export function TopAppBar(props: HeaderProps): React.ReactElement {
  const { role, title, count, breadcrumb, status, subtitle, actions = [], onSidebarToggle, sidebarToggleState = 'drawer', onBack, paneToggle, modal, largeTitle = false, scroll, testIDs, testID } = props;
  const colors = useThemeColors();
  const insets = useInsets();
  const osScale = useFontScale();
  const fontScale = useFontScaleOverride() ?? osScale;
  const { inline, overflow } = splitActions(actions, fontScale);
  const surface = useAnimatedStyle(
    () => ({ backgroundColor: scroll ? interpolateColor(scroll.value, [0, 8], [colors.surface, colors.raised]) : colors.surface }),
    [scroll, colors.surface, colors.raised],
  );

  let leading: React.ReactNode = null;
  if (role === 'top' && onSidebarToggle) {
    leading = <IconButton icon="sidebar" label={sidebarToggleLabel(sidebarToggleState, true)} selected={sidebarToggleState === 'shown'} onPress={onSidebarToggle} testID={testIDs?.sidebarToggle ?? 'menu-button'} />;
  } else if ((role === 'detail' || role === 'workspace') && onBack) {
    leading = <IconButton icon="back" label={backLabel(breadcrumb)} onPress={onBack} testID={testIDs?.back} />;
  } else if (role === 'modal' && modal) {
    leading = <IconButton icon="x" label={modal.cancelLabel ?? 'Cancel'} onPress={modal.onCancel} />;
  }

  const detail = role === 'detail' || role === 'workspace';
  const home = role === 'top' && largeTitle;
  // A plain-string subtitle is set as a footnote (RN renders strings only inside <Text>).
  const line = typeof subtitle === 'string' ? <Text role="footnote" tone="fg-2">{subtitle}</Text> : subtitle;
  return (
    <Animated.View testID={testID} style={[surface, { paddingTop: insets.top }]}>
      <View className={cn('min-h-bar flex-row items-center gap-1 pe-1', leading ? 'ps-1' : 'ps-4')}>
        {leading}
        <View className={cn('flex-1 justify-center', leading && 'ps-1')}>
          {detail && breadcrumb?.length ? <Breadcrumb segments={breadcrumb} /> : null}
          {home ? null : (
            <View className="flex-row items-baseline gap-2">
              <Text role={detail ? 'detailTitle' : 'title'} numberOfLines={1} accessibilityRole="header" className="shrink">
                {title}
              </Text>
              {/* MChats "Chats 48" (MD-153). */}
              {role === 'top' && count != null ? <Count value={count} /> : null}
            </View>
          )}
        </View>
        {inline.map((a) => (
          <ActionButton key={a.id} action={a} />
        ))}
        {role === 'workspace' && paneToggle ? (
          <IconButton
            icon="dock"
            label={paneToggleLabel(paneToggle.open, paneToggle.count)}
            selected={paneToggle.open}
            badge={paneToggle.attention ? { dot: 'warn' } : paneToggle.count > 0 ? { count: paneToggle.count } : undefined}
            onPress={paneToggle.onPress}
            testID={testIDs?.paneToggle ?? 'pane-toggle'}
          />
        ) : null}
        <Overflow actions={overflow} />
        {role === 'modal' && modal?.primary ? (
          <Pressable onPress={modal.primary.onPress} disabled={modal.primary.disabled || modal.primary.loading} feedback="none" accessibilityRole="button" accessibilityLabel={modal.primary.label} accessibilityState={{ busy: modal.primary.loading }} className="px-3">
            {modal.primary.loading ? (
              <Spinner size={16} tone="fg-2" label={modal.primary.label} />
            ) : (
              <Text role="subhead" weight={600} tone={modal.primary.disabled ? 'fg-3' : 'fg'}>
                {modal.primary.label}
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
      {home ? (
        <View className="gap-1 px-4 pb-3 pt-2">
          <Text role="largeTitle" accessibilityRole="header">
            {title}
          </Text>
          {line}
        </View>
      ) : line ? (
        <View className="px-4 pb-2">{line}</View>
      ) : null}
      {detail && status ? <StatusLine status={status} /> : null}
    </Animated.View>
  );
}
