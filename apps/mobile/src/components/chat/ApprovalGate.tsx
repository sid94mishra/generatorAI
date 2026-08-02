// ────────────────────────────────────────────────────────────────
// Approval gate — the flagship mobile interaction.
//
// Long-running agents block on human decisions. A gate resolved in three
// seconds from a phone is worth more than any authoring feature this app
// could offer, so it is pinned above the composer and cannot be scrolled
// past or dismissed accidentally.
//
// Deliberate choices:
//   * large targets — this gets tapped one-handed, often in a hurry
//   * destructive styling on reject, so the two are never confused
//   * haptics — confirmation without having to read the screen
//   * disabled while in flight, so a double tap cannot double-submit
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FileText, HelpCircle } from 'lucide-react-native';

import { useTheme } from '../../theme/ThemeProvider';
import type { GateAction } from './gateActions';

export { toGateAction, type GateAction } from './gateActions';

export function ApprovalGate({
  kind,
  title,
  summary,
  actions,
  onDecide,
  onOpenDetail,
}: {
  kind: 'plan' | 'question';
  title: string;
  summary?: string;
  actions: GateAction[];
  onDecide(actionId: string): Promise<void>;
  onOpenDetail?(): void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (action: GateAction): Promise<void> => {
    if (busy) return;
    setBusy(action.id);
    try {
      await onDecide(action.id);
      await Haptics.notificationAsync(
        action.tone === 'danger'
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success,
      );
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="gap-3 border-t border-primary bg-card px-4 py-3">
      <View className="flex-row items-center gap-2">
        {kind === 'plan' ? (
          <FileText size={16} color={colors.primary} />
        ) : (
          <HelpCircle size={16} color={colors.primary} />
        )}
        <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={2}>
          {title}
        </Text>
      </View>

      {summary ? (
        <Pressable accessibilityRole="button" onPress={onOpenDetail} disabled={!onOpenDetail}>
          <Text className="text-sm text-muted-foreground" numberOfLines={3}>
            {summary}
          </Text>
          {onOpenDetail ? <Text className="mt-1 text-xs text-primary">Read the full plan</Text> : null}
        </Pressable>
      ) : null}

      <View className="flex-row gap-2">
        {actions.map((action) => (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            disabled={busy !== null}
            onPress={() => void decide(action)}
            // 44pt minimum: this is tapped one-handed, in a hurry.
            className={`min-h-[44px] flex-1 items-center justify-center rounded-lg px-3 py-3 ${
              action.tone === 'primary'
                ? 'bg-primary-emphasis'
                : action.tone === 'danger'
                  ? 'border border-danger'
                  : 'border border-border'
            } ${busy !== null ? 'opacity-60' : ''}`}
          >
            {busy === action.id ? (
              <ActivityIndicator size="small" color={colors['primary-foreground']} />
            ) : (
              <Text
                className={`text-sm font-semibold ${
                  action.tone === 'primary'
                    ? 'text-primary-foreground'
                    : action.tone === 'danger'
                      ? 'text-danger'
                      : 'text-foreground'
                }`}
              >
                {action.label}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
