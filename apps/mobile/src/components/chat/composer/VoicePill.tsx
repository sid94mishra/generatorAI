// ────────────────────────────────────────────────────────────────
// Voice pill — the dictation surface that replaces the field while live.
//
//   [✕]  ▁▂▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁  0:42  [⏸]  [✓]
//
// The 18 bars are `Animated.View`s whose height is derived on the UI thread
// from the hook's `waveform` shared value (D16): nothing here re-renders
// per audio buffer. The only React state is the elapsed-time label, ticked
// once a second and scoped to this component.
//
// Reduce Motion: bars settle instantly instead of easing.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming, type SharedValue } from 'react-native-reanimated';
import { Check, Pause, Play, X } from 'lucide-react-native';

import { IconButton } from '../../ui/Button';
import { Spinner } from '../../ui/States';
import { MAX_SCALE, useReduceMotion } from '../../ui/accessibility';
import { useTheme } from '../../../theme/ThemeProvider';
import { WAVEFORM_BARS, WAVEFORM_WEIGHTS, formatElapsed } from '../../../voice/dictationCommit';
import type { VoiceUiState } from './types';
import { useChatMotion } from '../chatMotion';

const BAR_MIN = 3;
const BAR_MAX = 22;

function Bar({
  index,
  waveform,
  color,
  paused,
  reduceMotion,
}: {
  index: number;
  waveform: SharedValue<number[]>;
  color: string | undefined;
  paused: boolean;
  reduceMotion: boolean;
}): React.ReactElement {
  const weight = WAVEFORM_WEIGHTS[index] ?? 1;
  const style = useAnimatedStyle(() => {
    const level = paused ? 0 : (waveform.value[index] ?? 0);
    const height = BAR_MIN + Math.min(1, level * weight * 1.6) * (BAR_MAX - BAR_MIN);
    return {
      height: reduceMotion ? height : withTiming(height, { duration: 90 }),
      opacity: paused ? 0.4 : 0.55 + Math.min(0.45, level),
    };
  }, [paused, reduceMotion, weight, index]);

  return (
    <Animated.View
      style={[{ width: 3, borderRadius: 1.5, backgroundColor: color }, style]}
    />
  );
}

export function VoicePill({
  state,
  waveform,
  startedAt,
  error,
  onPause,
  onResume,
  onCancel,
  onAccept,
}: {
  state: VoiceUiState;
  waveform: SharedValue<number[]>;
  startedAt: number | null;
  error?: string | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onAccept: () => void;
}): React.ReactElement {
  const motion = useChatMotion();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state !== 'listening' && state !== 'paused') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state]);

  const paused = state === 'paused';
  const transcribing = state === 'transcribing';
  const elapsed = startedAt ? formatElapsed(now - startedAt) : '0:00';
  const statusLabel = transcribing
    ? 'Transcribing'
    : paused
      ? 'Paused'
      : state === 'error'
        ? (error ?? 'Dictation failed')
        : 'Listening';

  return (
    <Animated.View
      entering={motion.fadeIn(140)}
      exiting={motion.fadeOut(120)}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Dictation ${statusLabel}, ${elapsed}`}
      accessibilityLiveRegion="polite"
      className="flex-row items-center gap-1 px-2 py-2"
    >
      <IconButton
        accessibilityLabel="Cancel dictation"
        accessibilityHint="Discards what was said"
        variant="ghost"
        icon={<X size={18} color={colors['muted-foreground']} />}
        onPress={onCancel}
      />

      <View
        className={`h-9 flex-1 flex-row items-center justify-center gap-[3px] rounded-2xl ${
          state === 'error' ? 'bg-danger-muted' : 'bg-subtle'
        }`}
      >
        {state === 'error' ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="px-3 text-xs text-danger">
            {statusLabel}
          </Text>
        ) : transcribing ? (
          <View className="flex-row items-center gap-2">
            <Spinner />
            <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs text-muted-foreground">
              Transcribing…
            </Text>
          </View>
        ) : (
          Array.from({ length: WAVEFORM_BARS }, (_, i) => (
            <Bar
              key={i}
              index={i}
              waveform={waveform}
              color={(paused ? colors['muted-foreground'] : colors.primary) ?? colors.primary}
              paused={paused}
              reduceMotion={reduceMotion}
            />
          ))
        )}
      </View>

      <Text
        maxFontSizeMultiplier={MAX_SCALE.chrome}
        className="min-w-9 text-center text-xs tabular-nums text-muted-foreground"
      >
        {elapsed}
      </Text>

      {state === 'error' ? null : (
        <IconButton
          accessibilityLabel={paused ? 'Resume dictation' : 'Pause dictation'}
          variant="ghost"
          disabled={transcribing}
          icon={
            paused ? (
              <Play size={18} color={colors.primary} />
            ) : (
              <Pause size={18} color={colors['muted-foreground']} />
            )
          }
          onPress={paused ? onResume : onPause}
        />
      )}
      <IconButton
        accessibilityLabel="Accept dictation"
        accessibilityHint="Adds what you said to the message"
        variant="primary"
        disabled={transcribing || state === 'error'}
        icon={<Check size={18} color={colors['primary-foreground']} />}
        onPress={onAccept}
      />
    </Animated.View>
  );
}
