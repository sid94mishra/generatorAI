// ML-10 Sheet (03 ML-10; 06 §2.5; MD-21, MD-62, MD-85, MD-131): the content frame every sheet uses — route sheets
// (expo-router formSheet, options from routeSheetOptions) and the imperative sheet (SheetJs). SheetHeader: iOS ✕
// (glass, start) + centred headline + trailing text action; Android title-L at the start + optional ✕ at the end.
// SheetFooter: the action sheet's one primary, sticky above the keyboard. Dismissal is guarded while dirty.
import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { KeyboardStickyView } from '../../lib/styled';

import { cn } from '../../lib/cn';
import { useDirtyGuard } from '../../layout/DirtyGuard/useDirtyGuard';
import { nativePlatform } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { IconButton } from '../../primitives/IconButton';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { RouteSheetProps, SheetHeaderProps } from './Sheet.types';
import { actionPlacementProblem } from './sheetModel';

export type { PresentOptions, RouteSheetProps, SheetController, SheetDetent, SheetHeaderProps, SheetProps } from './Sheet.types';

function TextAction({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }): React.ReactElement {
  return (
    <Pressable onPress={onPress} disabled={disabled} feedback="none" accessibilityRole="button" accessibilityLabel={label} className="px-3">
      <Text role={nativePlatform === 'android' ? 'subhead' : 'body'} weight={600} tone={disabled ? 'fg-3' : 'fg'}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SheetHeader({ title, subtitle, onClose, closable = true, headerAction, back, testID }: SheetHeaderProps): React.ReactElement {
  if (nativePlatform === 'android') {
    return (
      <View testID={testID} className="min-h-dialog-bar flex-row items-center gap-1 px-2">
        {back ? <IconButton icon="back" label={`Back to ${back.label}`} onPress={back.onPress} /> : <View className="w-2" />}
        <View className="flex-1 py-2">
          <Text role="title" numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text role="caption" tone="fg-3" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {headerAction ? <TextAction {...headerAction} /> : null}
        {closable ? <IconButton icon="x" label="Close" onPress={onClose} /> : null}
      </View>
    );
  }
  return (
    <View testID={testID} className="min-h-dialog-bar flex-row items-center px-2">
      <View className="z-10 min-w-hit flex-row">
        {back ? (
          <IconButton icon="chevron-left" label={`Back to ${back.label}`} variant="glass" size="sm" onPress={back.onPress} />
        ) : (
          <IconButton icon="x" label="Close" variant="glass" size="sm" onPress={onClose} />
        )}
      </View>
      <View className="absolute inset-x-16 items-center" pointerEvents="none">
        <Text role="headline" align="center" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text role="caption" tone="fg-3" align="center" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View className="flex-1" />
      {headerAction ? <TextAction {...headerAction} /> : null}
    </View>
  );
}

/** The action sheet's footer: one full-width lg primary, riding above the keyboard (MD-85). */
export function SheetFooter({ children, testID }: { children: React.ReactNode; testID?: string }): React.ReactElement {
  const insets = useInsets();
  return (
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
      <View testID={testID} className="gap-2 px-4 pt-3 android:border-t android:border-line-soft" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        {children}
      </View>
    </KeyboardStickyView>
  );
}

/** The frame inside any sheet host: header, body (optionally scrolling), footer; guarded dismissal. */
export function Sheet({ navigation, ...props }: RouteSheetProps): React.ReactElement {
  const { title, subtitle, dirty = false, onDismiss, headerAction, back, footer, scrollable = false, children, testID } = props;
  const { guard } = useDirtyGuard(dirty, { onDiscard: onDismiss, navigation });
  const close = (): void => void guard(onDismiss);
  useEffect(() => {
    const problem = actionPlacementProblem(props);
    // eslint-disable-next-line no-console
    if (problem && typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`[Sheet] ${problem}`);
  });
  const closable = nativePlatform === 'ios' || Boolean(footer) || dirty;
  return (
    <View testID={testID} accessibilityViewIsModal onAccessibilityEscape={close} className={cn('shrink', scrollable && 'flex-1')}>
      <SheetHeader title={title} subtitle={subtitle} onClose={close} closable={closable} headerAction={headerAction} back={back} />
      {scrollable ? (
        <ScrollView className="flex-1" contentContainerClassName="pb-4" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View className="shrink pb-4">{children}</View>
      )}
      {footer ? <SheetFooter>{footer}</SheetFooter> : null}
    </View>
  );
}

/** A route sheet's body (options: routeSheetOptions(kind, dirty)); pass the screen's navigation to guard removal. */
export function RouteSheet(props: RouteSheetProps): React.ReactElement {
  return <Sheet {...props} />;
}
