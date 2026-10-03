// ML-11 FullScreenEditor (03 ML-11; MD-21, MD-85): the body of a `fullScreenModal` route (options:
// fullScreenModalOptions — no swipe dismiss). A JS modal header (h-dialog-bar 56 / 64): iOS "Cancel" text at the
// start, the centred title, the text confirm at the end; Android ✕ + Title L at the start, the 14/600 text confirm
// at the end. While dirty the header shows the change count, and Cancel / Android Back / router removal ask
// "Discard changes?". Keyboard-aware scrolling body; optional stepper and sticky wizard bar. The bar clears the
// status bar with a position-aware safe area (the native SafeAreaView measures where the modal actually sits): an
// iOS full-screen modal is presented over the whole window — outside the shell column that pays the top inset — so
// the context's (consumed) top inset reads 0 there, while an Android modal stays inside the column.
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardStickyView } from '../../lib/styled';

import { useDirtyGuard } from '../DirtyGuard/useDirtyGuard';
import { nativePlatform } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { IconButton } from '../../primitives/IconButton';
import { Pressable } from '../../primitives/Pressable';
import { Spinner } from '../../primitives/Spinner';
import { Text } from '../../primitives/Text';
import type { FullScreenEditorProps } from './FullScreenEditor.types';

export type { FullScreenEditorProps } from './FullScreenEditor.types';

const TOP_EDGE: Edge[] = ['top'];

/** "3 changes" / "1 change" (exported for tests). */
export function changeCountText(dirty: boolean, count?: number): string | undefined {
  if (!dirty || !count) return undefined;
  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

function Confirm({ label, onPress, disabled = false, loading = false }: NonNullable<FullScreenEditorProps['primary']>): React.ReactElement {
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} feedback="none" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy: loading }} className="px-3">
      {loading ? (
        <Spinner size={16} tone="fg-2" label={label} />
      ) : (
        <Text role={nativePlatform === 'android' ? 'subhead' : 'body'} weight={600} tone={disabled ? 'fg-3' : 'fg'}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function FullScreenEditor({ title, primary, cancelLabel = 'Cancel', onCancel, dirty, dirtyCount, stepper, stickyBar, body = 'scroll', navigation, children, testID }: FullScreenEditorProps): React.ReactElement {
  const insets = useInsets();
  const { guard } = useDirtyGuard(dirty, { onDiscard: onCancel, navigation });
  const cancel = (): void => void guard(onCancel);
  const changes = changeCountText(dirty, dirtyCount);
  const android = nativePlatform === 'android';
  const heading = (
    <View className={android ? 'flex-1' : 'absolute inset-x-24 items-center'} pointerEvents="none">
      <Text role={android ? 'title' : 'headline'} align={android ? 'start' : 'center'} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {changes ? (
        <Text role="caption" tone="fg-3" align={android ? 'start' : 'center'}>
          {changes}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View testID={testID} accessibilityViewIsModal onAccessibilityEscape={cancel} className="flex-1 bg-surface">
      <SafeAreaView edges={TOP_EDGE} mode="padding">
        <View className="min-h-dialog-bar flex-row items-center gap-1 px-2">
          {android ? (
            <IconButton icon="x" label={cancelLabel} onPress={cancel} />
          ) : (
            <Pressable onPress={cancel} feedback="none" accessibilityRole="button" accessibilityLabel={cancelLabel} className="z-10 px-2">
              <Text role="body">{cancelLabel}</Text>
            </Pressable>
          )}
          {heading}
          {android ? null : <View className="flex-1" />}
          {primary ? <Confirm {...primary} /> : null}
        </View>
      </SafeAreaView>
      {stepper ? <View className="px-gutter pb-2">{stepper}</View> : null}
      {body === 'fixed' ? (
        <View className="flex-1 pt-2">{children}</View>
      ) : (
        <KeyboardAwareScrollView className="flex-1" contentContainerClassName="gap-6 px-gutter pb-8 pt-2" keyboardShouldPersistTaps="handled" bottomOffset={16}>
          {children}
        </KeyboardAwareScrollView>
      )}
      {stickyBar ? (
        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
          <View style={{ paddingBottom: insets.bottom }}>{stickyBar}</View>
        </KeyboardStickyView>
      ) : null}
    </View>
  );
}
