// ────────────────────────────────────────────────────────────────
// Permission card — the tool-permission gate.
//
// The most urgent of the three blocking gates: the agent is stopped
// mid-tool-call, not just waiting for input, so this renders first when
// several gates are open (see the chain in `app/chats/[id].tsx`).
//
// Modeled on `QuestionCard` (same pinned-card lifecycle, same theming and
// tap-target conventions) with the danger styling `ApprovalGate` uses for
// its reject action: Allow and Deny must never look alike, because a
// mis-tap here lets an agent loose on a tool it was not cleared to use.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ShieldAlert } from 'lucide-react-native';
import type { StreamBlock } from '@generatorai/client-core';

import { Button } from '../ui/Button';
import { Badge } from '../ui/primitives';
import { useTheme } from '../../theme/ThemeProvider';

type PermissionBlock = Extract<StreamBlock, { type: 'permission' }>;

export function PermissionCard({
  block,
  onDecide,
}: {
  block: PermissionBlock;
  onDecide: (behavior: 'allow' | 'deny') => Promise<void> | void;
}): React.ReactElement {
  const { colors } = useTheme();
  // A single in-flight flag rather than per-button, so a tap on Allow while
  // Deny is still resolving (or vice versa) cannot double-submit either one.
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null);

  const decide = async (behavior: 'allow' | 'deny'): Promise<void> => {
    if (pending) return;
    setPending(behavior);
    try {
      await onDecide(behavior);
    } finally {
      setPending(null);
    }
  };

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      className="mx-3 mb-2 gap-3 rounded-3xl border border-danger bg-card p-3.5"
    >
      <View className="flex-row items-center gap-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-2xl bg-danger-muted">
          <ShieldAlert size={16} color={colors.danger} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-md font-semibold text-foreground">Permission needed</Text>
          <Text numberOfLines={1} className="text-xs text-muted-foreground">
            {block.toolName}
          </Text>
        </View>
        <Badge label="Permission" tone="danger" />
      </View>

      <Text className="text-sm leading-relaxed text-foreground">{block.description}</Text>

      <View className="gap-1">
        <Text className="text-xs uppercase tracking-wide text-muted-foreground">Input</Text>
        <View className="rounded-xl bg-canvas-bg p-2.5">
          {/* Already bounded and secret-redacted by the server — render verbatim. */}
          <Text className="font-mono text-xs leading-code text-muted-foreground">
            {block.inputSummary}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-2">
        <Button
          label="Deny"
          variant="danger"
          size="lg"
          full
          loading={pending === 'deny'}
          disabled={pending !== null}
          onPress={() => void decide('deny')}
        />
        <Button
          label="Allow"
          variant="primary"
          size="lg"
          full
          loading={pending === 'allow'}
          disabled={pending !== null}
          onPress={() => void decide('allow')}
        />
      </View>
    </Animated.View>
  );
}
