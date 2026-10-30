// ────────────────────────────────────────────────────────────────
// useChatActions — Copy transcript and Fork, shared by the chat header's More
// menu (fork at the latest turn) and a response's actions (fork from that
// turn). Copy confirms in place, not with a toast (D-30); failures toast.
// ────────────────────────────────────────────────────────────────

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { useFetchChatTranscript, useForkChat } from '@/hooks/queries.js';
import { copyTextToClipboard } from '@/utils/copyToClipboard.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';

/** The provider could not branch its own history, so the fork carries a digest. */
const SYNTHETIC_FORK_NOTE =
  'The provider does not support native rewind; the model will receive a summary of the surviving conversation with your next message.';

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

export function useChatActions(chatId: string) {
  const navigate = useNavigate();
  const fetchTranscript = useFetchChatTranscript();
  const forkMutation = useForkChat(chatId);
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

  /** Fork at `turnId`, or at the latest turn when omitted; opens the fork. */
  const fork = useCallback(
    (turnId?: string) => {
      forkMutation.mutate(
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
    },
    [forkMutation, navigate],
  );

  return { copyTranscript, copying, copied, fork, forking: forkMutation.isPending };
}
