// ────────────────────────────────────────────────────────────────
// ChatHeader — title, transport badge and the overflow menu.
//
// Rendered INTO the native stack header through `navigation.setOptions`
// (`headerTitle` / `headerRight`), so the back button, large-title
// behaviour and safe areas stay the platform's. The title is a button:
// tapping it opens the rename sheet, which is where web puts renaming too.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ellipsis } from 'lucide-react-native';

import { IconButton } from '../ui/Button';
import { Touchable } from '../ui/Touchable';
import { StatusDot } from '../ui/primitives';
import { MAX_SCALE } from '../ui/accessibility';
import { useTheme } from '../../theme/ThemeProvider';
import type { TransportBadge } from './sessionTransport';

export function ChatHeaderTitle({
  title,
  subtitle,
  transport,
  onPress,
}: {
  title: string;
  /**
   * Model and branch. These two facts change what a prompt will do, and they
   * were previously only discoverable by opening two different sheets —
   * after sending, which is too late.
   */
  subtitle?: string | null;
  transport: TransportBadge;
  onPress: () => void;
}): React.ReactElement {
  return (
    <View className="flex-row items-center gap-2">
      <Touchable
        accessibilityLabel={`${title}${subtitle ? `. ${subtitle}` : ''}. Rename`}
        accessibilityHint="Opens the rename sheet"
        haptic="tap"
        ripple={false}
        scale="none"
        onPress={onPress}
        className="min-w-0 shrink"
      >
        <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-md font-semibold text-foreground">
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_SCALE.chrome}
            className="text-xs text-muted-foreground"
          >
            {subtitle}
          </Text>
        ) : null}
      </Touchable>
      <TransportChip transport={transport} />
    </View>
  );
}

function TransportChip({ transport }: { transport: TransportBadge }): React.ReactElement {
  const tone = transport.tone === 'neutral' ? 'neutral' : transport.tone;
  const healthy = transport.label === 'LAN';
  const text =
    transport.tone === 'success'
      ? 'text-success'
      : transport.tone === 'warning'
        ? 'text-warning'
        : transport.tone === 'danger'
          ? 'text-danger'
          : 'text-muted-foreground';
  return (
    <Touchable
      accessibilityLabel={`Connection: ${transport.label}. ${transport.detail}`}
      accessibilityHint="Opens diagnostics"
      haptic="tap"
      ripple={false}
      scale="none"
      onPress={() => router.push('/settings/diagnostics')}
      // The chip is ~20pt tall; the slop brings the target to 44pt.
      hitSlop={12}
      className={`shrink-0 flex-row items-center gap-1 rounded-full bg-subtle py-0.5 ${healthy ? 'px-1.5' : 'px-2'}`}
    >
      <StatusDot tone={tone} label={null} />
      {/* On a healthy direct connection the word "LAN" is chrome that costs
          the chat's own name ~50pt of a 393pt header — the title was being
          truncated with room to spare. The dot carries it; the label comes
          back the moment the connection is anything but normal. */}
      {healthy ? null : (
        <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className={`text-xs font-medium ${text}`}>
          {transport.label}
        </Text>
      )}
    </Touchable>
  );
}

export function ChatHeaderMenuButton({ onPress }: { onPress: () => void }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <IconButton
      accessibilityLabel="Chat menu"
      icon={<Ellipsis size={20} color={colors.foreground} />}
      onPress={onPress}
    />
  );
}
