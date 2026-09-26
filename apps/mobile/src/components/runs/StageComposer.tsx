// ────────────────────────────────────────────────────────────────
// StageComposer — the chat's composer, pointed at a workflow stage (P03b:
// a stage is a compact chat).
//
// The same `Composer` and controller a chat uses (draft, attachments,
// voice, history), in its compact form: the stage's session fixes the model,
// effort and permissions, so only the agent mode of the next message is on
// the strip. What a message does depends on the stage, and the server
// decides: between turns it is the next turn, a completed stage is amended
// (later stages keep what they used), a paused one resumes with it. Mid-turn
// it is refused (409 STAGE_BUSY), exactly as a busy chat refuses — Stop
// first. An in-turn gate pins its chat card in the dock above the field.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, type AgentMode, type ApprovalOutcome, type StageRunSummary } from '@generatorai/client-core';

import { useAuth } from '../../auth/AuthProvider';
import { useStageConversation } from '../../api/useStageConversation';
import { Composer } from '../chat/Composer';
import { useComposerController } from '../chat/composer/useComposerController';
import { readAllAttachmentBytes } from '../chat/composer/attachmentPickers';
import type { ComposerSendPayload } from '../chat/composer/types';
import { useTwoPhaseStop } from '../../stream/useTwoPhaseStop';
import { useToast } from '../ui/Toast';
import { useKeyboardHeight } from '../ui/keyboard';
import { StageGateCard } from './StageGateCard';
import { stageGateOf } from './stageGate';

const NOOP = (): void => {};

/** Why the field is shut, when it is; null when a message can go. */
function closedReason(status: string): string | null {
  switch (status) {
    case 'pending':
    case 'ready':
    case 'retry_wait':
    case 'waiting':
      return 'The stage has not started its conversation yet.';
    case 'failed':
    case 'skipped':
    case 'cancelled':
      return 'This stage is final. Re-run it from here to continue its work.';
    default:
      return null;
  }
}

export function StageComposer({
  runId,
  stage,
  workspaceId,
  streaming,
  canControl,
  busy,
  onDecide,
  onAmending,
}: {
  runId: string;
  stage: StageRunSummary;
  workspaceId: string | null;
  /** The stage's live stream is mid-turn: Send becomes Stop. */
  streaming: boolean;
  /** The device holds workflow control (messages steer the run). */
  canControl: boolean;
  /** The completion review's approve command is in flight. */
  busy: boolean;
  onDecide: (outcome: ApprovalOutcome, feedback?: string) => void;
  /** A completed stage took the message as an amendment: keep its stream open. */
  onAmending?: (() => void) | undefined;
}): React.ReactElement {
  const { state } = useAuth();
  const scopes = state.status === 'authenticated' ? state.scopes : [];
  const toast = useToast();
  const conversation = useStageConversation(runId, stage.id);
  const [mode, setMode] = useState<AgentMode>('auto');

  const gate = stage.status === 'awaiting_input' ? stageGateOf(stage.interruptData) : null;
  const closed = closedReason(stage.status);
  const disabledReason = !canControl
    ? 'Messaging a stage needs workflow permission on this device.'
    : closed ?? (gate ? 'Answer above to continue.' : undefined);

  const onSend = useCallback(
    async (payload: ComposerSendPayload) => {
      try {
        const files = await readAllAttachmentBytes(payload.attachments);
        const result = await conversation.send.mutateAsync({ message: payload.text.trim(), mode: payload.mode ?? mode, files });
        if (result.outcome === 'amending') onAmending?.();
      } catch (err) {
        // The controller restores the draft; say why, in the server's words.
        toast({
          message: err instanceof ApiError && err.status === 409 ? err.message : 'Could not send that. Your text has been restored.',
          tone: 'error',
        });
        throw err;
      }
    },
    [conversation.send, mode, onAmending, toast],
  );

  const composer = useComposerController({
    // Drafts are kept per stage, apart from any chat's.
    chatId: `stage:${stage.id}`,
    scopes,
    workspaceId,
    onSend,
    disabled: Boolean(disabledReason),
  });

  const stop = useTwoPhaseStop({
    isLive: streaming,
    onCancel: (options) => conversation.stop.mutate({ force: options.force === true }),
  });

  // Above the keyboard and the home indicator, as the chat's dock is: the
  // larger of the two, never their sum.
  const keyboard = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const dockStyle = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.value, insets.bottom) }), [insets.bottom]);

  return (
    <Animated.View style={dockStyle}>
    <Composer
      {...composer.props}
      compact
      placeholder="Message this stage…"
      dock={
        gate && gate.kind !== 'review' ? (
          <StageGateCard runId={runId} stage={stage} busy={busy} onDecide={onDecide} />
        ) : null
      }
      onStop={stop.press}
      stopState={stop}
      isStreaming={streaming}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      models={undefined}
      modelsLoading={false}
      selectedModelId={null}
      onSelectModel={NOOP}
      mode={mode}
      onModeChange={setMode}
      effort={null}
      onEffortChange={NOOP}
      contextTier="default"
      onContextTierChange={NOOP}
      permissionMode=""
      onPermissionModeChange={NOOP}
      contextTokens={null}
      codebaseCount={0}
    />
    </Animated.View>
  );
}
