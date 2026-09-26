// ────────────────────────────────────────────────────────────────
// F-chat-04 MessageActions — the row under an agent response:
//   Copy transcript — the whole chat as markdown (client-core's formatter, so
//                     web and mobile agree byte for byte);
//   Fork from here  — a new chat that remembers everything up to and including
//                     this turn and nothing after it.
//
// Hover-revealed on pointer devices, always shown on touch and on the newest
// response (the one people act on). Copy confirms in place ("Copied"), not
// with a toast (D-30); failures toast.
// ────────────────────────────────────────────────────────────────

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { useFetchChatTranscript, useForkChat } from '@/hooks/queries.js';
import { copyTextToClipboard } from '@/utils/copyToClipboard.js';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';

export interface MessageActionsProps {
  chatId: string;
  /** The turn this response closed — the fork anchor. */
  turnId?: string | undefined;
  /** Show without hovering (the newest response). */
  alwaysVisible?: boolean;
}

/** The provider could not branch its own history, so the fork carries a digest. */
const SYNTHETIC_FORK_NOTE =
  'The provider does not support native rewind; the model will receive a summary of the surviving conversation with your next message.';

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

export function MessageActions({ chatId, turnId, alwaysVisible = false }: MessageActionsProps) {
  const navigate = useNavigate();
  const fetchTranscript = useFetchChatTranscript();
  const fork = useForkChat(chatId);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyTranscript = useCallback(async () => {
    setCopying(true);
    try {
      const { markdown } = await fetchTranscript(chatId);
      await copyTextToClipboard(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      toast.error('Could not copy the transcript', {
        description: error instanceof Error ? error.message : 'The transcript could not be read.',
      });
    } finally {
      setCopying(false);
    }
  }, [chatId, fetchTranscript]);

  const forkFromHere = useCallback(() => {
    fork.mutate(
      { ...(turnId ? { turnId } : {}) },
      {
        onSuccess: (result) => {
          if (result.conversation === 'synthetic') toast.info(`Forked into ${result.chat.name}`, { description: SYNTHETIC_FORK_NOTE });
          navigate(`/chats/${result.chat.id}`);
        },
        onError: (error: unknown) => {
          const busy = errorCode(error) === 'CHAT_BUSY';
          toast.error(busy ? 'Nothing was forked' : 'Fork failed', {
            description: busy
              ? 'This chat is still working on a turn. Stop it first, then fork.'
              : error instanceof Error
                ? error.message
                : 'The server refused the fork.',
          });
        },
      },
    );
  }, [fork, navigate, turnId]);

  return (
    <div
      className={cn(
        'flex items-center gap-1 transition-control',
        alwaysVisible
          ? 'opacity-100'
          : 'opacity-0 group-focus-within/response:opacity-100 group-hover/response:opacity-100 pointer-coarse:opacity-100',
      )}
      data-testid="message-actions"
    >
      <Button
        variant="ghost"
        size="sm"
        icon={copied ? 'check' : 'copy'}
        loading={copying}
        disabled={copying}
        onClick={() => void copyTranscript()}
        title="Copy the whole chat as markdown"
        aria-label="Copy transcript"
        data-testid="copy-transcript-button"
      >
        {copied ? 'Copied' : 'Copy transcript'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon="branch"
        loading={fork.isPending}
        disabled={fork.isPending}
        onClick={forkFromHere}
        title="Branch a new chat that ends with this response"
        aria-label="Fork from here"
        data-testid="fork-button"
      >
        Fork from here
      </Button>
    </div>
  );
}
