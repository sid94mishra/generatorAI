// ────────────────────────────────────────────────────────────────
// useChatStopRewind — stopping a turn (W30-b two-phase Stop), cancelling a
// turn parked on a gate, and taking back a rewound prompt.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { useCancelChat } from '@/hooks/queries.js';
import { useTwoPhaseStop } from '@/hooks/useTwoPhaseStop.js';
import { useRewindStore } from '@/stores/rewindStore.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { applyStopEffects } from '../chatStopEffects.js';

export interface UseChatStopRewindOptions {
  chatId: string | undefined;
  sessionId: string | undefined;
  chatActive: boolean;
  /** The BACKEND's view: a turn is pending or streaming. */
  isWorking: boolean;
}

export function useChatStopRewind({ chatId, sessionId, chatActive, isWorking }: UseChatStopRewindOptions) {
  const cancelMutation = useCancelChat();

  /**
   * A rewind hands the prompt back so it can be edited and resent.
   *
   * The offer is parked in `rewindStore` by whichever path performed the
   * rewind (this tab's own request, or a `chat.rewound` event from another
   * surface) and consumed exactly once here, then forwarded to the composer.
   * Nothing is auto-sent: re-running the turn would make the destructive
   * option unreviewable.
   */
  const pendingRewindPrompt = useRewindStore((s) => s.pending);
  const [restoredDraft, setRestoredDraft] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!pendingRewindPrompt || pendingRewindPrompt.chatId !== chatId) return;
    setRestoredDraft({ text: pendingRewindPrompt.prompt, at: pendingRewindPrompt.at });
    useRewindStore.getState().clear();
  }, [pendingRewindPrompt, chatId]);

  // A turn in flight is refused by the server (409 CHAT_BUSY), and an
  // archived chat cannot be moved at all — so the control says so rather
  // than letting the user find out by pressing it.
  const canRewind = chatActive && !isWorking;

  /**
   * W30-b — two-phase Stop.
   *
   * `isLive` is the BACKEND's view: `stream.status` is driven entirely by the
   * event stream, so a turn the server has settled returns the control to idle
   * even when the cancel request itself got no response, and a turn the server
   * is still running keeps offering escalation regardless of how many times
   * the button was pressed. The blocks are KEPT on a graceful stop: stopping is
   * how you say "that is enough, let me read it", and the auto-clear swaps them
   * for the persisted message once the history refetch lands.
   */
  const stop = useTwoPhaseStop({
    isLive: isWorking,
    onCancel: ({ force, budgetSeconds }) => {
      if (!chatId) return;
      applyStopEffects(useStreamStore.getState(), sessionId, force);
      // The controller's verdict reaches the server: a forced second press
      // tears the provider conversation down, not just the abort again.
      cancelMutation.mutate({ chatId, force, budgetSeconds });
    },
  });

  /** Give up on a turn that is parked on a gate. */
  const cancelPendingInteraction = useCallback(() => {
    if (!chatId) return;
    if (sessionId) {
      const store = useStreamStore.getState();
      store.clearStream(sessionId);
      store.requestCancel(sessionId);
    }
    cancelMutation.mutate(chatId);
  }, [chatId, sessionId, cancelMutation]);

  return { stop, canRewind, restoredDraft, cancelPendingInteraction };
}
