// ────────────────────────────────────────────────────────────────
// StatusGlyph — the one status signal a run or stage row carries.
//
// A 36pt tinted tile whose glyph says the state (check, cross, pause,
// hand-raised, spinner). Rows used to pair a coloured dot with a coloured
// badge saying the same thing twice; this replaces both.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Ban, Check, Circle, Hand, Moon, Pause, X } from 'lucide-react-native';

import { statusLabel } from './statusStyle';
import { toneOf } from './tone';
import { TONE_BADGE, type Tone } from '../ui/primitives';
import { useTheme } from '../../theme/ThemeProvider';

const TONE_COLOR: Record<Tone, string> = {
  neutral: 'muted-foreground',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

export function StatusGlyph({
  status,
  size = 36,
}: {
  status: string;
  size?: 28 | 36;
}): React.ReactElement {
  const { colors } = useTheme();
  const tone = toneOf(status);
  const color = (colors as Record<string, string | undefined>)[TONE_COLOR[tone]] ?? colors.foreground;
  const icon = size === 36 ? 16 : 14;

  let glyph: React.ReactNode;
  switch (status) {
    case 'running':
    case 'starting':
    case 'queued':
    case 'cancelling':
      glyph = <ActivityIndicator size="small" color={color} />;
      break;
    case 'completed':
      glyph = <Check size={icon} color={color} />;
      break;
    case 'failed':
      glyph = <X size={icon} color={color} />;
      break;
    case 'paused':
      glyph = <Pause size={icon} color={color} />;
      break;
    case 'awaiting_input':
      glyph = <Hand size={icon} color={color} />;
      break;
    case 'sleeping':
      glyph = <Moon size={icon} color={color} />;
      break;
    case 'cancelled':
    case 'skipped':
      glyph = <Ban size={icon} color={color} />;
      break;
    default:
      glyph = <Circle size={icon - 4} color={color} />;
  }

  return (
    <View
      accessible
      accessibilityLabel={statusLabel(status)}
      className={`items-center justify-center rounded-full border ${TONE_BADGE[tone]}`}
      style={{ width: size, height: size }}
    >
      {glyph}
    </View>
  );
}
