// ────────────────────────────────────────────────────────────────
// Suggestion strip — row 2 of the composer.
//
// A horizontal strip of tappable chips rather than a dropdown: a phone has
// no hover and no arrow keys, and a list that covers the transcript hides
// the thing the user is replying to. Each chip carries a small kind glyph
// so `/deploy` the skill and `/deploy` the prompt are distinguishable.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  Bot,
  FileText,
  Globe,
  Layers,
  Sparkles,
  Terminal,
  Wand2,
} from 'lucide-react-native';

import { Touchable } from '../../ui/Touchable';
import { Spinner } from '../../ui/States';
import { MAX_SCALE } from '../../ui/accessibility';
import { useTheme } from '../../../theme/ThemeProvider';
import type { SlashItem } from './types';
import { useChatMotion } from '../chatMotion';

function KindIcon({
  item,
  color,
}: {
  item: SlashItem;
  color: string | undefined;
}): React.ReactElement {
  switch (item.kind) {
    case 'command':
      return item.pane === 'browser' ? <Globe size={13} color={color} /> : <Terminal size={13} color={color} />;
    case 'skill':
      return <Sparkles size={13} color={color} />;
    case 'prompt':
      return <Wand2 size={13} color={color} />;
    case 'agent':
      return <Bot size={13} color={color} />;
    case 'file':
      return <FileText size={13} color={color} />;
    default:
      return <Layers size={13} color={color} />;
  }
}

export function SuggestionStrip({
  items,
  loading = false,
  emptyHint,
  onSelect,
}: {
  items: readonly SlashItem[];
  loading?: boolean;
  /** Shown when the source is loaded and nothing matched. */
  emptyHint?: string | null;
  onSelect: (item: SlashItem) => void;
}): React.ReactElement | null {
  const motion = useChatMotion();
  const { colors } = useTheme();
  if (items.length === 0 && !loading && !emptyHint) return null;

  return (
    <Animated.View entering={motion.fadeIn(120)} exiting={motion.fadeOut(120)}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10, alignItems: 'center' }}
      >
        {loading && items.length === 0 ? (
          <View className="h-9 flex-row items-center gap-2 px-2">
            <Spinner />
            <Text className="text-sm text-muted-foreground">Loading…</Text>
          </View>
        ) : null}
        {!loading && items.length === 0 && emptyHint ? (
          <Text className="px-2 text-sm text-muted-foreground">{emptyHint}</Text>
        ) : null}
        {items.map((item) => (
          <Touchable
            key={item.id}
            accessibilityLabel={item.label}
            {...(item.description ? { accessibilityHint: item.description } : {})}
            haptic="none"
            onPress={() => onSelect(item)}
            className="h-9 max-w-64 flex-row items-center gap-1.5 rounded-2xl border border-border bg-raised px-3"
          >
            <KindIcon item={item} color={colors['muted-foreground']} />
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_SCALE.chrome}
              className="text-sm font-medium text-foreground"
            >
              {item.label}
            </Text>
            {item.kind === 'file' && item.alias ? (
              <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs text-muted-foreground">
                {item.alias}
              </Text>
            ) : null}
          </Touchable>
        ))}
      </ScrollView>
    </Animated.View>
  );
}
