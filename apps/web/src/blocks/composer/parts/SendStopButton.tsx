// ────────────────────────────────────────────────────────────────
// F-composer-13 — the primary control.
//
// Send (accent when there is something to send, `selected` + fg-3 when not);
// while a turn is live it is Stop, "Stopping…" (inert for the 400 ms arming
// window) and, once 15 s pass with the turn still live, the "Force reset" pill.
// The composer never owns the turn: the face comes from the shared composer
// machine (`primaryAction`) and the label/enabled state from the page's
// two-phase stop (`stopState`). No queue (D-29): the draft simply waits.
// ────────────────────────────────────────────────────────────────

import type { ComposerPrimaryAction, ComposerStopView } from '@generatorai/shared/ui-contract';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

export interface SendStopButtonProps {
  primaryAction: ComposerPrimaryAction;
  canSend: boolean;
  /** A send is in flight. */
  sending: boolean;
  stopState?: ComposerStopView | undefined;
  onSend: () => void;
  onStop?: (() => void) | undefined;
}

export function SendStopButton({ primaryAction, canSend, sending, stopState, onSend, onStop }: SendStopButtonProps) {
  if (primaryAction === 'force_reset') {
    return (
      <Button
        variant="primary"
        size="sm"
        icon="stop"
        onClick={onStop}
        title="The turn did not stop gracefully — reset it"
        className="bg-err hover:not-disabled:bg-err/90"
      >
        {stopState?.label}
      </Button>
    );
  }
  if (primaryAction !== 'send') {
    const label = stopState?.label ?? 'Stop generation';
    return (
      <IconButton
        variant="primary"
        icon="stop"
        label={label}
        tooltip={false}
        title={label}
        onClick={onStop}
        disabled={stopState ? !stopState.enabled : false}
      />
    );
  }
  if (sending) {
    return (
      <Button variant="primary" disabled aria-label="Send message" title="Send (Enter)" className="size-control rounded-card px-0">
        <Spinner size={14} />
      </Button>
    );
  }
  return (
    <IconButton
      variant="primary"
      icon="send"
      label="Send message"
      tooltip={false}
      title="Send (Enter)"
      onClick={onSend}
      disabled={!canSend}
      className={cn(!canSend && 'bg-selected text-fg-3 opacity-100 disabled:text-fg-3')}
    />
  );
}
