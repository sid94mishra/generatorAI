// ────────────────────────────────────────────────────────────────
// NeedsYouStrip — the "N waiting for you" accessory above the tab bar.
//
// A floating pill rather than a bar: it must not read as a fifth tab, and
// it has to stay tappable while a list scrolls under it. Sits `offset`
// above the bottom edge (the tab bar's height), so the tabs layout owns the
// arithmetic and this component only owns the motion.
//
// Animates in and out on the UI thread; under Reduce Motion it appears and
// disappears without travelling. Announced politely so a screen-reader user
// hears the count change without being interrupted mid-sentence.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { BellRing, ChevronRight } from 'lucide-react-native';

import { APPROVALS_ROUTE, needsYouLabel } from '../../navigation/routes';
import { Touchable } from '../ui/Touchable';
import { MAX_SCALE, announce, useReduceMotion } from '../ui/accessibility';
import { useReducedMotionPreset } from '../ui/motion';
import { useTheme } from '../../theme/ThemeProvider';

export function NeedsYouStrip({ count, offset }: { count: number; offset: number }): React.ReactElement | null {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const presets = useReducedMotionPreset();
  const label = needsYouLabel(count);
  const visible = label !== null;

  // Keep the last label while collapsing so the text does not vanish a
  // frame before the pill does.
  const lastLabel = useRef(label);
  if (label) lastLabel.current = label;
  const shown = label ?? lastLabel.current;

  const progress = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      progress.value = withTiming(visible ? 1 : 0, presets.timingFast);
    } else {
      progress.value = visible ? withSpring(1, presets.springEnter) : withTiming(0, presets.timingFast);
    }
  }, [visible, reduceMotion, progress, presets]);

  useEffect(() => {
    if (label) announce(label);
  }, [label]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [16, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.94, 1]) },
    ],
  }));

  if (!shown) return null;

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityLiveRegion="polite"
      style={[style, { position: 'absolute', left: 0, right: 0, bottom: offset + 10, alignItems: 'center' }]}
    >
      <Touchable
        accessibilityLabel={`${shown}. Review approvals`}
        accessibilityHint="Opens the approvals list"
        haptic="tap"
        onPress={() => router.push(APPROVALS_ROUTE)}
        className="min-h-11 flex-row items-center gap-2 rounded-full border border-warning bg-warning-muted px-4 py-2"
        style={{
          shadowColor: 'rgb(0,0,0)',
          shadowOpacity: 0.22,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
          backgroundColor: colors.card,
        }}
      >
        <View className="h-6 w-6 items-center justify-center rounded-full bg-warning-muted">
          <BellRing size={13} color={colors.warning} />
        </View>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.chrome}
          className="text-sm font-semibold text-foreground"
        >
          {shown}
        </Text>
        <ChevronRight size={16} color={colors['muted-foreground']} />
      </Touchable>
    </Animated.View>
  );
}
