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
//
// Deny is two-step: the first tap reveals an optional reason (the agent
// reads it — "use the test database instead" changes what it does next),
// and a second tap sends. Allow stays one tap.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ShieldAlert } from 'lucide-react-native';
import type { StreamBlock } from '@generatorai/client-core';

import { Button } from '../ui/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { useCardEntering } from '../common/enterMotion';
import { GateScroll } from './GateScroll';
import { useChatMotion } from './chatMotion';
import { commandPreview, editPreview } from './permissionPreview';

type PermissionBlock = Extract<StreamBlock, { type: 'permission' }>;

export function PermissionCard({
  block,
  onDecide,
}: {
  block: PermissionBlock;
  onDecide: (behavior: 'allow' | 'deny', message?: string) => Promise<void> | void;
}): React.ReactElement {
  const { colors } = useTheme();
  const entering = useCardEntering();
  const motion = useChatMotion();
  // A single in-flight flag rather than per-button, so a tap on Allow while
  // Deny is still resolving (or vice versa) cannot double-submit either one.
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  // A file edit reads as a path and a before/after; anything else stays raw.
  const preview = useMemo(() => editPreview(block.toolName, block.inputSummary), [block.toolName, block.inputSummary]);
  const command = useMemo(() => (preview ? null : commandPreview(block.inputSummary)), [preview, block.inputSummary]);
  // The server's description of a shell call IS the command; say it once.
  const description = command && block.description.trim() === command.command ? command.note : block.description;

  const decide = async (behavior: 'allow' | 'deny'): Promise<void> => {
    if (pending) return;
    setPending(behavior);
    try {
      const message = behavior === 'deny' ? reason.trim() : '';
      await onDecide(behavior, message ? message : undefined);
    } finally {
      setPending(null);
    }
  };

  return (
    <Animated.View
      entering={entering}
      className="mx-3 mt-2 gap-3 rounded-3xl border border-warning bg-card p-3.5"
    >
      <View className="flex-row items-center gap-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-2xl bg-warning-muted">
          <ShieldAlert size={16} color={colors.warning} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-md font-semibold text-foreground">Permission needed</Text>
          <Text numberOfLines={1} className="text-xs text-muted-foreground">
            {block.toolName}
          </Text>
        </View>
      </View>

      {denying ? (
        // The user has already inspected the command. Prioritise their
        // reason and decision above the keyboard; Back restores full input.
        <Text numberOfLines={3} className="text-sm leading-relaxed text-foreground">{block.description}</Text>
      ) : <GateScroll>
        {description ? <Text className="text-sm leading-relaxed text-foreground">{description}</Text> : null}

        {preview ? (
          <View className="gap-1.5" accessibilityLabel={`Change to ${preview.path}: ${preview.removed.length} lines removed, ${preview.added.length} added`}>
            <Text numberOfLines={1} ellipsizeMode="middle" className="font-mono text-xs text-muted-foreground">
              {preview.path}
            </Text>
            <View className="overflow-hidden rounded-xl bg-canvas-bg py-1">
              {preview.removed.map((line, i) => (
                <Text key={`r${i}`} selectable numberOfLines={2} className="bg-danger-muted px-2.5 font-mono text-xs leading-code text-foreground">
                  <Text className="text-danger">− </Text>
                  {line}
                </Text>
              ))}
              {preview.added.map((line, i) => (
                <Text key={`a${i}`} selectable numberOfLines={2} className="bg-success-muted px-2.5 font-mono text-xs leading-code text-foreground">
                  <Text className="text-success">+ </Text>
                  {line}
                </Text>
              ))}
              {preview.hidden > 0 ? (
                <Text className="px-2.5 pt-1 text-xs text-muted-foreground">
                  {preview.hidden} more {preview.hidden === 1 ? 'line' : 'lines'}
                </Text>
              ) : null}
            </View>
          </View>
        ) : command ? (
          <View className="rounded-xl bg-canvas-bg p-2.5" accessibilityLabel={`Command: ${command.command}`}>
            <Text selectable className="font-mono text-xs leading-code text-foreground">
              <Text className="text-muted-foreground">$ </Text>
              {command.command}
            </Text>
          </View>
        ) : (
          <View className="gap-1">
            <Text className="text-xs uppercase tracking-wide text-muted-foreground">Input</Text>
            <View className="rounded-xl bg-canvas-bg p-2.5">
              {/* Already bounded and secret-redacted by the server — render verbatim. */}
              <Text selectable className="font-mono text-xs leading-code text-muted-foreground">
                {block.inputSummary}
              </Text>
            </View>
          </View>
        )}
      </GateScroll>}

      {denying ? (
        <Animated.View entering={motion.fadeIn(120)} className="gap-2">
          <TextInput
            accessibilityLabel="Reason for denying (optional)"
            multiline
            autoFocus
            value={reason}
            onChangeText={setReason}
            placeholder="Tell the agent why, or what to do instead (optional)"
            placeholderTextColor={colors['muted-foreground']}
            className="max-h-28 min-h-11 rounded-2xl border border-border bg-raised px-3 py-2.5 text-sm text-foreground"
          />
          <View className="flex-row gap-2">
            <Button
              label="Back"
              variant="secondary"
              size="lg"
              disabled={pending !== null}
              onPress={() => setDenying(false)}
            />
            <Button
              label={reason.trim() ? 'Deny with reason' : 'Deny'}
              variant="danger"
              size="lg"
              grow
              loading={pending === 'deny'}
              disabled={pending !== null}
              onPress={() => void decide('deny')}
            />
          </View>
        </Animated.View>
      ) : (
        <View className="flex-row gap-2">
          <Button
            label="Deny"
            variant="danger"
            size="lg"
            grow
            disabled={pending !== null}
            onPress={() => setDenying(true)}
          />
          <Button
            label="Allow"
            variant="primary"
            size="lg"
            grow
            loading={pending === 'allow'}
            disabled={pending !== null}
            onPress={() => void decide('allow')}
          />
        </View>
      )}
    </Animated.View>
  );
}
