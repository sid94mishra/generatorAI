// ────────────────────────────────────────────────────────────────
// MessageActions — the row under an assistant response.
//
// Two actions, both about taking the conversation somewhere else:
//   Copy transcript — the whole chat as markdown, rendered by client-core's
//                     shared formatter so web and mobile agree byte for byte.
//   Fork from here  — branch a new chat that remembers everything up to and
//                     including this turn, and nothing after it. The fork
//                     SHARES the parent's workspace: it is a conversation
//                     branch, not a copy of the files.
//
// Hover-revealed on pointer devices, always visible on touch (`hover: none`
// has no hover to reveal it with) and on the last response, which is the one
// people actually act on.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { copyTextToClipboard } from '@/utils/copyToClipboard.js';
import { useNavigate } from 'react-router-dom';
import { Copy, GitFork, Loader2 } from 'lucide-react';
import { toast } from '@/components/Toast.js';
import { fetchChatTranscript, useForkChat } from '@/hooks/queries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import type { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';
import { ApiError } from '@/platform/apiFetch.js';
import { cn } from '@/lib/utils.js';

interface MessageActionsProps {
  chatId: string;
  /** The turn this response closed — the fork anchor. */
  turnId?: string | undefined;
  /**
   * Show the row without hovering. True for the newest response; touch
   * devices get it regardless through the `hover: none` variant below.
   */
  alwaysVisible?: boolean;
  className?: string;
}

/** The provider could not branch its own history, so the fork carries a digest. */
const SYNTHETIC_NOTE =
  'The provider does not support native rewind; the model will receive a summary of the surviving conversation with your next message.';

const BUTTON_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50';

export function MessageActions({ chatId, turnId, alwaysVisible, className }: MessageActionsProps) {
  const navigate = useNavigate();
  const platform = usePlatform() as HttpPlatformClient;
  const fork = useForkChat(chatId);
  const [copying, setCopying] = useState(false);

  const copyTranscript = useCallback(async () => {
    setCopying(true);
    try {
      const { markdown } = await fetchChatTranscript(platform, chatId);
      await copyTextToClipboard(markdown);
      toast({ variant: 'success', title: 'Transcript copied' });
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Could not copy the transcript',
        description:
          error instanceof Error ? error.message : 'The transcript could not be read.',
      });
    } finally {
      setCopying(false);
    }
  }, [chatId, platform]);

  const forkFromHere = useCallback(() => {
    fork.mutate(
      { ...(turnId ? { turnId } : {}) },
      {
        onSuccess: (result) => {
          toast({
            variant: 'success',
            title: `Forked into ${result.chat.name}`,
            ...(result.conversation === 'synthetic' ? { description: SYNTHETIC_NOTE } : {}),
          });
          navigate(`/chats/${result.chat.id}`);
        },
        onError: (error: unknown) => {
          const code = error instanceof ApiError ? error.code : undefined;
          toast({
            variant: 'error',
            title: code === 'CHAT_BUSY' ? 'Nothing was forked' : 'Fork failed',
            description:
              code === 'CHAT_BUSY'
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
        'mt-1.5 flex items-center gap-1 transition-opacity',
        // Revealed by the row's `group` on pointer devices; always there when
        // there is no hover to reveal it with, or when this is the newest
        // response.
        alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        '[@media(hover:none)]:opacity-100',
        className,
      )}
      data-testid="message-actions"
    >
      <button
        type="button"
        data-testid="copy-transcript-button"
        onClick={() => void copyTranscript()}
        disabled={copying}
        title="Copy the whole chat as markdown"
        aria-label="Copy transcript"
        className={BUTTON_CLASS}
      >
        {copying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
        Copy transcript
      </button>
      <button
        type="button"
        data-testid="fork-button"
        onClick={forkFromHere}
        disabled={fork.isPending}
        title="Branch a new chat that ends with this response"
        aria-label="Fork from here"
        className={BUTTON_CLASS}
      >
        {fork.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <GitFork className="h-3.5 w-3.5" />
        )}
        Fork from here
      </button>
    </div>
  );
}
