// ────────────────────────────────────────────────────────────────
// SwipeableRow — the gesture every list in this app was missing.
//
// On both platforms a list row is expected to reveal its actions when you
// drag it sideways. Its absence is the single clearest "this was built for a
// browser" tell, and it was why archiving a chat meant hunting for a 44pt
// icon inside a 56pt row.
//
// Behaviour, matching the platform rather than inventing one:
//   • Drag left to reveal trailing actions; they track the finger 1:1.
//   • Past the reveal width the row keeps moving with resistance, and at the
//     full-swipe threshold the FIRST action arms — signalled by a haptic and
//     by the action filling the exposed track.
//   • Release past the threshold performs it; release short of it snaps to
//     open or closed, whichever the throw was heading for.
//   • Only one row is open at a time, which is why the open row is tracked
//     module-level rather than per-list.
//
// Vertical scrolling is preserved by activating on a horizontal offset, so a
// list scroll never gets stolen by an accidental sideways drift.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { SPRING_SWIPE } from './motion';
import { haptics } from './haptics';
import { MAX_SCALE, useReduceMotion } from './accessibility';
import { Touchable } from './Touchable';
import type { Tone } from './primitives';

export interface SwipeAction {
  label: string;
  icon?: React.ReactNode;
  tone?: Extract<Tone, 'primary' | 'danger' | 'warning' | 'neutral'>;
  onPress: () => void;
}

const ACTION_WIDTH = 84;
/** Fraction of the row width past which a release commits the first action. */
const FULL_SWIPE = 0.5;

const TONE_BG: Record<NonNullable<SwipeAction['tone']>, string> = {
  primary: 'bg-primary',
  danger: 'bg-danger',
  warning: 'bg-warning',
  neutral: 'bg-emphasis',
};

const TONE_FG: Record<NonNullable<SwipeAction['tone']>, string> = {
  primary: 'text-primary-foreground',
  danger: 'text-destructive-foreground',
  warning: 'text-foreground',
  neutral: 'text-foreground',
};

/** Closes whichever row is currently open before another one opens. */
let closeOpenRow: (() => void) | null = null;

export function SwipeableRow({
  actions,
  children,
  enabled = true,
}: {
  /** Trailing actions, leading-most first. Max 3 fit on a phone. */
  actions: SwipeAction[];
  children: React.ReactNode;
  enabled?: boolean;
}): React.ReactElement {
  const translateX = useSharedValue(0);
  const rowWidth = useSharedValue(0);
  const armed = useSharedValue(0);
  const startX = useSharedValue(0);
  const reduceMotion = useReduceMotion();
  const selfClose = useRef<() => void>(() => {});

  const revealWidth = Math.min(actions.length, 3) * ACTION_WIDTH;

  const close = useCallback(() => {
    translateX.value = withSpring(0, SPRING_SWIPE);
    armed.value = 0;
  }, [translateX, armed]);

  selfClose.current = close;

  useEffect(() => () => {
    if (closeOpenRow === selfClose.current) closeOpenRow = null;
  }, []);

  const claim = useCallback(() => {
    if (closeOpenRow && closeOpenRow !== selfClose.current) closeOpenRow();
    closeOpenRow = selfClose.current;
  }, []);

  const run = useCallback(
    (index: number) => {
      close();
      haptics.commit();
      actions[index]?.onPress();
    },
    [actions, close],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Horizontal-only activation: without this the row steals the list's
        // vertical scroll the moment a finger drifts a pixel sideways.
        .activeOffsetX([-12, 12])
        .failOffsetY([-8, 8])
        .enabled(enabled && actions.length > 0)
        .onBegin(() => {
          startX.value = translateX.value;
          runOnJS(claim)();
        })
        .onUpdate((event) => {
          const next = startX.value + event.translationX;
          if (next > 0) {
            // No leading actions: rubber-band rather than exposing a gap.
            translateX.value = next * 0.15;
            return;
          }
          const past = -next - revealWidth;
          translateX.value = past > 0 ? -(revealWidth + past * 0.6) : next;

          const threshold = rowWidth.value * FULL_SWIPE;
          const nowArmed = -translateX.value >= threshold ? 1 : 0;
          if (nowArmed !== armed.value) {
            armed.value = nowArmed;
            if (nowArmed) runOnJS(haptics.threshold)();
          }
        })
        .onEnd((event) => {
          const offset = -translateX.value;
          const threshold = rowWidth.value * FULL_SWIPE;

          if (offset >= threshold) {
            runOnJS(run)(0);
            translateX.value = withSpring(0, SPRING_SWIPE);
            armed.value = 0;
            return;
          }
          // Project the throw so a flick opens rather than snapping back.
          const projected = offset - event.velocityX * 0.1;
          translateX.value = withSpring(
            projected > revealWidth / 2 ? -revealWidth : 0,
            SPRING_SWIPE,
          );
          armed.value = 0;
        }),
    [actions.length, enabled, claim, run, revealWidth, translateX, startX, armed, rowWidth],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  const trackStyle = useAnimatedStyle(() => ({
    // The exposed track always matches the drag, so no background gap can
    // appear between the row edge and the actions.
    width: Math.max(0, -translateX.value),
  }));

  const firstArmedStyle = useAnimatedStyle(() => ({
    flex: armed.value ? 1 : 0,
    width: armed.value ? undefined : ACTION_WIDTH,
  }));

  return (
    <View
      className="relative overflow-hidden"
      onLayout={(e) => {
        rowWidth.value = e.nativeEvent.layout.width;
      }}
    >
      {actions.length > 0 ? (
        <Animated.View className="absolute bottom-0 right-0 top-0 flex-row" style={trackStyle}>
          {actions.slice(0, 3).map((action, index) => {
            const tone = action.tone ?? 'neutral';
            const content = (
              <>
                {action.icon}
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_SCALE.chrome}
                  className={`text-xs font-semibold ${TONE_FG[tone]}`}
                >
                  {action.label}
                </Text>
              </>
            );
            // The first action grows to fill the track once armed, which is
            // what tells the user that letting go now performs it.
            return index === 0 ? (
              <Animated.View key={action.label} style={firstArmedStyle}>
                <Touchable
                  accessibilityLabel={action.label}
                  haptic="commit"
                  scale="none"
                  onPress={() => run(0)}
                  className={`h-full items-center justify-center gap-1 ${TONE_BG[tone]}`}
                >
                  {content}
                </Touchable>
              </Animated.View>
            ) : (
              <Touchable
                key={action.label}
                accessibilityLabel={action.label}
                haptic="commit"
                scale="none"
                onPress={() => run(index)}
                style={{ width: ACTION_WIDTH }}
                className={`h-full items-center justify-center gap-1 ${TONE_BG[tone]}`}
              >
                {content}
              </Touchable>
            );
          })}
        </Animated.View>
      ) : null}

      <GestureDetector gesture={pan}>
        {/* The row itself keeps its own accessibility tree. The swipe actions
            are ALSO exposed as custom actions below, because a swipe is not
            performable with a screen reader. */}
        <Animated.View
          style={reduceMotion ? undefined : rowStyle}
          accessibilityActions={actions.map((a) => ({ name: a.label, label: a.label }))}
          onAccessibilityAction={(event) => {
            const match = actions.find((a) => a.label === event.nativeEvent.actionName);
            match?.onPress();
          }}
          className="bg-card"
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** Dismiss whatever row is open — call when a list loses focus. */
export function closeSwipedRow(): void {
  closeOpenRow?.();
  closeOpenRow = null;
}
