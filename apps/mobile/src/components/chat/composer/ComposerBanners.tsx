// ────────────────────────────────────────────────────────────────
// Composer banners — the strips that sit above the card.
//
//   bound agent   "🤖 Reviewer"  — which agent drives this chat; tap opens it
//   workspace prep "Preparing workspace…" / "Workspace failed: … · Retry"
//   gate banner   "Waiting for your decision — Cancel and send"
//
// All three are driven by the screen (it owns the chat query and the gate
// mutations); the composer only lays them out and keeps them honest — a
// banner that says "Retry" with no handler renders without the button.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Bot, CircleAlert, RotateCcw } from 'lucide-react-native';

import { Chip } from '../../ui/Chip';
import { Spinner } from '../../ui/States';
import { Touchable } from '../../ui/Touchable';
import { MAX_SCALE } from '../../ui/accessibility';
import { useTheme } from '../../../theme/ThemeProvider';
import type { WorkspacePrepState } from './types';
import { useChatMotion } from '../chatMotion';

export interface BoundAgentProps {
  name: string;
  ref: string;
  role?: 'agent' | 'orchestrator';
  onPress?: () => void;
}

export function BoundAgentChip({ agent }: { agent: BoundAgentProps }): React.ReactElement {
  const motion = useChatMotion();
  const { colors } = useTheme();
  return (
    <Animated.View entering={motion.fadeIn(120)} exiting={motion.fadeOut(120)} className="px-3 pt-2">
      <View className="flex-row">
        <Chip
          accessibilityLabel={`Agent ${agent.name}${agent.role === 'orchestrator' ? ', orchestrator' : ''}`}
          accessibilityHint={agent.onPress ? 'Opens the agent' : undefined}
          label={agent.role === 'orchestrator' ? `${agent.name} · orchestrator` : agent.name}
          icon={<Bot size={13} color={colors.primary} />}
          tone="accent"
          size="sm"
          {...(agent.onPress ? { onPress: agent.onPress, showChevron: true } : {})}
        />
      </View>
    </Animated.View>
  );
}

export interface WorkspacePrepProps extends WorkspacePrepState {
  onRetry?: () => void;
  retrying?: boolean;
}

export function WorkspacePrepBar({ prep }: { prep: WorkspacePrepProps }): React.ReactElement | null {
  const motion = useChatMotion();
  const { colors } = useTheme();
  if (prep.status === 'ready') return null;
  const failed = prep.status === 'error';
  return (
    <Animated.View
      entering={motion.fadeIn(120)}
      exiting={motion.fadeOut(120)}
      accessibilityLiveRegion="polite"
      className={`mx-3 mt-2 flex-row items-center gap-2 rounded-2xl border px-3 py-2 ${
        failed ? 'border-danger bg-danger-muted' : 'border-border bg-subtle'
      }`}
    >
      {failed ? <CircleAlert size={16} color={colors.danger} /> : <Spinner />}
      <Text
        numberOfLines={2}
        maxFontSizeMultiplier={MAX_SCALE.chrome}
        className={`flex-1 text-sm ${failed ? 'text-danger' : 'text-muted-foreground'}`}
      >
        {failed
          ? `Workspace failed to prepare${prep.error ? `: ${prep.error}` : '.'}`
          : prep.status === 'pending'
            ? 'Workspace queued…'
            : 'Preparing workspace…'}
      </Text>
      {failed && prep.onRetry ? (
        <Touchable
          accessibilityLabel="Retry workspace preparation"
          haptic="tap"
          disabled={Boolean(prep.retrying)}
          onPress={prep.onRetry}
          className="h-8 flex-row items-center gap-1 rounded-full bg-raised px-2.5"
        >
          {prep.retrying ? <Spinner /> : <RotateCcw size={13} color={colors.foreground} />}
          <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs font-medium text-foreground">
            Retry
          </Text>
        </Touchable>
      ) : null}
    </Animated.View>
  );
}

export interface GateBannerProps {
  /** "Waiting for your decision" / "The agent asked a question". */
  label: string;
  /** Cancels the pending interaction, then sends the draft. */
  onCancelAndSend: () => void;
  busy?: boolean;
  /** Whether there is anything to send; the button reads differently otherwise. */
  hasDraft: boolean;
}

export function GateBanner({ gate }: { gate: GateBannerProps }): React.ReactElement {
  const motion = useChatMotion();
  const { colors } = useTheme();
  return (
    <Animated.View
      entering={motion.fadeIn(120)}
      exiting={motion.fadeOut(120)}
      accessibilityLiveRegion="assertive"
      className="mx-3 mt-2 flex-row items-center gap-2 rounded-2xl border border-warning bg-warning-muted px-3 py-2"
    >
      <CircleAlert size={16} color={colors.warning} />
      <Text
        numberOfLines={2}
        maxFontSizeMultiplier={MAX_SCALE.chrome}
        className="flex-1 text-sm text-warning"
      >
        {gate.label}
      </Text>
      <Touchable
        accessibilityLabel={gate.hasDraft ? 'Cancel the pending request and send your message' : 'Cancel the pending request'}
        haptic="commit"
        disabled={Boolean(gate.busy)}
        onPress={gate.onCancelAndSend}
        className="h-8 flex-row items-center rounded-full bg-raised px-2.5"
      >
        {gate.busy ? (
          <Spinner />
        ) : (
          <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs font-medium text-foreground">
            {gate.hasDraft ? 'Cancel and send' : 'Cancel'}
          </Text>
        )}
      </Touchable>
    </Animated.View>
  );
}
