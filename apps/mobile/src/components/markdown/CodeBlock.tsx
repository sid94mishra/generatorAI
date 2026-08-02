// ────────────────────────────────────────────────────────────────
// Code block.
//
// Horizontally scrollable rather than wrapped: wrapped code loses its
// indentation, which is most of what makes code readable.
//
// Syntax highlighting is deliberately absent here. Per the plan it comes
// from a server-side tokenization endpoint keyed by content SHA, so colours
// match the desktop exactly and the phone spends nothing. Plain monospace is
// the honest interim, not a placeholder that pretends to highlight.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Check, Copy } from 'lucide-react-native';

import { useTheme } from '../../theme/ThemeProvider';

export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const onCopy = async (): Promise<void> => {
    await Clipboard.setStringAsync(code);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View className="overflow-hidden rounded-lg border border-border bg-subtle">
      <View className="flex-row items-center justify-between border-b border-border px-3 py-1.5">
        <Text className="font-mono text-xs text-muted-foreground">{language ?? 'text'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy code"
          onPress={() => void onCopy()}
          hitSlop={8}
        >
          {copied ? (
            <Check size={14} color={colors.success} />
          ) : (
            <Copy size={14} color={colors['muted-foreground']} />
          )}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <Text className="p-3 font-mono text-sm leading-code text-foreground">{code}</Text>
      </ScrollView>
    </View>
  );
}
