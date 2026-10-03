// ML-01 Screen (03 ML-01; MD-22, MD-93): the root of every screen — the background (surface, or ground for grouped
// iOS settings), the header (given the scroll offset for the Android tonal bar), banner and status line, the body
// (scrolling, keyboard-aware for forms, or handed to a list), pull to refresh, the loading / error / empty / offline
// states, the bottom accessory with its height added to the content inset, a 720 reading width on expanded
// windows, and the PrimaryActionRegistry (one filled primary per screen). On iOS the body is always a ScrollView
// with automatic content insets, so content clears the transparent native header (`list` children do the same).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, RefreshControl, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { PrimaryActionContext, createPrimaryRegistry } from '../../lib/primaryAction';
import { KeyboardAwareScrollView } from '../../lib/styled';
import { useThemeColors } from '../../lib/themeColors';
import { ProgressIndicator } from '../../native/ProgressIndicator';
import { useSizeClass } from '../../platform/breakpoints';
import { nativePlatform } from '../../platform/geometry';
import { ErrorState } from '../../primitives/ErrorState';
import { OfflineState } from '../../primitives/OfflineState';
import type { ScreenProps } from './Screen.types';
import { READING_WIDTH, screenBody, stateAnnouncement } from './screenModel';

export type { ScreenProps, ScreenState } from './Screen.types';

function StateBody({ state }: { state: NonNullable<ScreenProps['state']> }): React.ReactElement | null {
  switch (state.kind) {
    case 'loading':
      return (
        <View accessible accessibilityLabel="Loading" accessibilityState={{ busy: true }} className={state.skeleton ? undefined : 'flex-1 items-center justify-center p-8'}>
          {state.skeleton ?? <ProgressIndicator label="Loading" />}
        </View>
      );
    case 'empty':
      return state.empty;
    case 'error':
      return (
        <View className="flex-1 justify-center">
          <ErrorState title={state.title ?? "Couldn't load"} error={state.error} onRetry={state.onRetry} />
        </View>
      );
    case 'offline':
      return (
        <View className="flex-1 justify-center">
          <OfflineState form="screen" state="unreachable" />
        </View>
      );
    default:
      return null;
  }
}

export function Screen({ header, statusLine, banner, scroll = 'scroll', background = 'plain', onRefresh, bottomAccessory, keyboard = 'none', state, scrollRef, children, testID }: ScreenProps): React.ReactElement {
  const colors = useThemeColors();
  const { sizeClass } = useSizeClass();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });
  const [accessoryHeight, setAccessoryHeight] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const registry = useMemo(
    () =>
      createPrimaryRegistry((message) => {
        // eslint-disable-next-line no-console
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(message);
      }),
    [],
  );

  const previous = useRef(state?.kind);
  useEffect(() => {
    const said = stateAnnouncement(previous.current, state?.kind, state?.kind === 'error' ? state.title : undefined);
    previous.current = state?.kind;
    if (said) AccessibilityInfo.announceForAccessibility?.(said);
  }, [state]);

  const refresh = onRefresh
    ? (
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void onRefresh().finally(() => setRefreshing(false));
          }}
          tintColor={colors.fg3}
          colors={[colors.fg2]}
          progressBackgroundColor={colors.raised}
        />
      )
    : undefined;

  const body = screenBody(state);
  const content =
    body === 'content' ? (
      <View className={cn('w-full', sizeClass === 'expanded' && 'self-center')} style={sizeClass === 'expanded' ? { maxWidth: READING_WIDTH } : undefined}>
        {children}
      </View>
    ) : (
      <StateBody state={state!} />
    );
  const inset = { paddingBottom: accessoryHeight };
  const fixed = scroll === 'none' || (scroll === 'list' && body === 'content');

  let main: React.ReactNode;
  if (scroll === 'list' && body === 'content') {
    main = <View className="flex-1">{content}</View>;
  } else if (keyboard === 'form' && !fixed) {
    main = (
      <KeyboardAwareScrollView className="flex-1" contentContainerStyle={inset} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" refreshControl={refresh} bottomOffset={16}>
        {content}
      </KeyboardAwareScrollView>
    );
  } else if (fixed && nativePlatform === 'android') {
    main = <View className="flex-1">{content}</View>;
  } else {
    main = (
      <Animated.ScrollView
        ref={scrollRef as never}
        className="flex-1"
        contentContainerClassName={cn(body !== 'content' && 'flex-grow')}
        contentContainerStyle={inset}
        contentInsetAdjustmentBehavior="automatic"
        scrollEnabled={!fixed}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        refreshControl={fixed ? undefined : refresh}
      >
        {content}
      </Animated.ScrollView>
    );
  }

  return (
    <PrimaryActionContext.Provider value={registry}>
      <View testID={testID} className={cn('flex-1', background === 'grouped' ? 'bg-ground' : 'bg-surface')}>
        {React.cloneElement(header, { scroll: scrollY })}
        {banner}
        {statusLine}
        {main}
        {bottomAccessory ? (
          <View pointerEvents="box-none" className="absolute inset-x-0 bottom-0" onLayout={(e) => setAccessoryHeight(Math.round(e.nativeEvent.layout.height))}>
            {bottomAccessory}
          </View>
        ) : null}
      </View>
    </PrimaryActionContext.Provider>
  );
}
