// ────────────────────────────────────────────────────────────────
// useComposerSend — whether the composer can send, and sending
// (03-component-inventory-domain.md §6.1, F-composer-13/22).
//
// Eligibility, the blocking state and the primary control come from the
// shared composer machine in client-core (M-12), so web and mobile answer
// "can I send / what does the button say" with the same rules. This hook owns
// the web side of the send itself: the `/command` template, the canned prompt
// for attachment-only sends, `onBuiltinCommand` before dispatch, the draft
// restored on failure, and the `sendingRef` re-entrancy guard (a ref, not
// state, so a double Enter inside one tick still sends once).
//
// The composer never owns the turn: the Stop control's state arrives from the
// page (`stopState`, from `useTwoPhaseStop`), and only its face is derived here.
// ────────────────────────────────────────────────────────────────

import { useCallback, useRef } from 'react';
import type { AgentMode, WorkspacePrepStatus } from '@generatorai/shared';
import type { ComposerBlockingState, ComposerPrimaryAction } from '@generatorai/shared/ui-contract';
import {
  canSendComposer,
  composerBlockingState,
  composerPrimaryAction,
  isPrepBlocking,
  stopPhaseFromView,
} from '@generatorai/client-core';
import { useSendPrompt } from '@/hooks/queries.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import type { CaptureSource } from '../model/types.js';
import type { ComposerDraft } from './useComposerDraft.js';
import type { ComposerHistory } from './useComposerHistory.js';

export interface UseComposerSendOptions {
  sessionId: string;
  draft: ComposerDraft;
  history: ComposerHistory;
  disabled: boolean;
  /** Captures (browser comments, terminal selections) owned by the page; they count as content. */
  pendingCaptures: Array<{ id: string; file: File; source: CaptureSource; label?: string }> | undefined;
  /** Set while a gate is open; the server rejects prompts with 409 until it closes. */
  pendingInteractionLabel: string | null | undefined;
  workspacePrep: { status: WorkspacePrepStatus; error?: string } | undefined;
  /** The agent mode for this turn (already defaulted). */
  agentMode: AgentMode;
  onBeforeSend: (() => Promise<void>) | undefined;
  customSendFn: ((args: { prompt: string; attachments: File[]; mode?: AgentMode }) => Promise<void>) | undefined;
  onBuiltinCommand: ((commandId: string) => void | Promise<void>) | undefined;
  /** Whether the host shows a Stop control (a turn is streaming and there is a stop handler). */
  turnLive: boolean;
  stopState: { label: string; enabled: boolean; forceAvailable: boolean } | undefined;
  /**
   * Whether a send starts the optimistic turn on `sessionId`'s stream (and
   * clears it when the send fails). Default true. A workflow stage's composer
   * passes false: its stream is the stage's whole transcript, and the server
   * echoes the operator's message into it (Workflow Overhaul P03b).
   */
  manageStream?: boolean;
}

export interface ComposerSend {
  /** A send is in flight (the mutation is pending). */
  isLoading: boolean;
  blockedByInteraction: boolean;
  blockedByWorkspacePrep: boolean;
  canSend: boolean;
  /** The one blocking state the machine would show (for the blocking-bar view). */
  blocking: ComposerBlockingState;
  /** Send, Stop, Stopping… or Force reset. */
  primaryAction: ComposerPrimaryAction;
  handleSend: () => Promise<void>;
}

const BROWSER_COMMENT_PROMPT =
  'Please address the attached browser comment(s). Each .md file has my note and the element it is about; the .png shows it.';
const ATTACHMENTS_PROMPT = 'Please take a look at the attached file(s).';

export function useComposerSend({
  sessionId,
  draft,
  history,
  disabled,
  pendingCaptures,
  pendingInteractionLabel,
  workspacePrep,
  agentMode,
  onBeforeSend,
  customSendFn,
  onBuiltinCommand,
  turnLive,
  stopState,
  manageStream = true,
}: UseComposerSendOptions): ComposerSend {
  const { text, attachments, activeCommand, setText, setAttachments, setActiveCommand, setMenu } = draft;
  const { recordSent, markSentAs } = history;
  const sendMutation = useSendPrompt(sessionId);
  const startPending = useStreamStore((state) => state.startPending);
  const clearStream = useStreamStore((state) => state.clearStream);
  const sendingRef = useRef(false);

  const isLoading = sendMutation.isPending;
  // PLN-01 — the server rejects prompts with 409 while a human gate is open,
  // so surface that as a disabled composer instead of a failed request.
  const blockedByInteraction = !!pendingInteractionLabel;
  // Mounts still being created: the prompt would have nowhere to run.
  const blockedByWorkspacePrep = isPrepBlocking(workspacePrep?.status);
  // Attachments are a message too. A browser comment arrives as attachments
  // with the composer empty — the note was typed in the page — and the send
  // arrow stayed grey until the user invented something to type here.
  const canSend = canSendComposer({
    text,
    hasCommand: activeCommand !== null,
    attachmentCount: attachments.length,
    captureCount: pendingCaptures?.length ?? 0,
    disabled,
    sending: isLoading,
    pendingInteraction: blockedByInteraction,
    prepStatus: workspacePrep?.status,
  });
  const stopPhase = stopPhaseFromView(turnLive, stopState);
  const blocking = composerBlockingState({
    prepStatus: workspacePrep?.status,
    pendingInteraction: blockedByInteraction,
    stopPhase,
  });
  const primaryAction = composerPrimaryAction(stopPhase);

  const handleSend = useCallback(async () => {
    if (!canSend || sendingRef.current) return;
    sendingRef.current = true;

    const cmd = activeCommand;
    const rawInput = text.trim();
    const currentAttachments = attachments;

    setText('');
    setAttachments([]);
    setActiveCommand(null);
    setMenu(null);
    // Remember what was sent so ↑ works before the server echoes it back.
    recordSent(rawInput, currentAttachments);

    let prompt = rawInput;
    try {
      if (cmd) {
        let template: string | undefined;
        if (cmd.loadTemplate) {
          try {
            template = await cmd.loadTemplate();
          } catch {
            template = undefined;
            toast.error(`Could not load the "${cmd.name}" prompt template`, {
              description: 'The message was sent without the template.',
            });
          }
        }
        prompt = cmd.format(rawInput, template);
        markSentAs(prompt);
      }

      // Captures (browser comments, terminal selections) live with the page and
      // are merged into the message by `customSendFn`; they count here too.
      const captureFiles = (pendingCaptures ?? []).map((c) => c.file);
      if (!prompt.trim() && currentAttachments.length + captureFiles.length > 0) {
        // The server needs words. Say what the attachments are for rather than
        // making the user type a sentence that adds nothing.
        const fromBrowser = [...currentAttachments.map((a) => a.file), ...captureFiles].some((f) =>
          /^(element|region)-/.test(f.name),
        );
        prompt = fromBrowser ? BROWSER_COMMENT_PROMPT : ATTACHMENTS_PROMPT;
      }

      if (!prompt.trim() && currentAttachments.length + captureFiles.length === 0) {
        // Nothing to send after formatting — restore and bail.
        setText(rawInput);
        setActiveCommand(cmd);
        setAttachments(currentAttachments);
        sendingRef.current = false;
        return;
      }

      if (manageStream) startPending(sessionId, prompt);
      const files = currentAttachments.map((a) => a.file);

      // Built-in commands (`/browser`, `/terminal`) surface their integrated
      // panel before the message is dispatched so the user can watch the agent
      // drive it live (e.g. start the browser in visible mode + focus its tab).
      if (cmd?.source === 'builtin' && onBuiltinCommand) {
        try {
          await onBuiltinCommand(cmd.id);
        } catch {
          /* non-fatal — the agent's lazy-start still runs */
        }
      }

      if (onBeforeSend) {
        await onBeforeSend();
      }
      if (customSendFn) {
        await customSendFn({ prompt, attachments: files, mode: agentMode });
      } else {
        await sendMutation.mutateAsync({ prompt, attachments: files });
      }
    } catch {
      // The draft comes back; the reason the server refused it (still
      // generating, waiting on a review, …) is toasted by the mutation's
      // global error handler under the "Message not sent" title — see
      // `useSendChatPrompt` / `useSendPrompt` meta.
      setText(rawInput);
      setActiveCommand(cmd);
      setAttachments(currentAttachments);
      if (manageStream) clearStream(sessionId);
    } finally {
      sendingRef.current = false;
    }
  }, [
    canSend,
    text,
    attachments,
    activeCommand,
    sessionId,
    sendMutation,
    startPending,
    clearStream,
    manageStream,
    onBeforeSend,
    customSendFn,
    onBuiltinCommand,
    agentMode,
    pendingCaptures,
    setText,
    setAttachments,
    setActiveCommand,
    setMenu,
    recordSent,
    markSentAs,
  ]);

  return {
    isLoading,
    blockedByInteraction,
    blockedByWorkspacePrep,
    canSend,
    blocking,
    primaryAction,
    handleSend,
  };
}
