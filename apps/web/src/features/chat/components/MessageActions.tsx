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

import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { useChatActions } from '../hooks/useChatActions.js';

export interface MessageActionsProps {
  chatId: string;
  /** The turn this response closed — the fork anchor. */
  turnId?: string | undefined;
  /** Show without hovering (the newest response). */
  alwaysVisible?: boolean;
}

export function MessageActions({ chatId, turnId, alwaysVisible = false }: MessageActionsProps) {
  const { copyTranscript, copying, copied, fork, forking } = useChatActions(chatId);
  const forkFromHere = () => fork(turnId);

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
        loading={forking}
        disabled={forking}
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
