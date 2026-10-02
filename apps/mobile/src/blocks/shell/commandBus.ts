// A tiny bus for commands a focused surface handles itself (the palette's next / previous / open / close, Escape
// for panels): the hardware-key host (M5-09) emits, the surface that is listening answers. Last subscriber wins.
import type { CommandId } from '@generatorai/shared/ui-contract';

type Handler = (id: CommandId) => boolean;
const handlers: Handler[] = [];

/** Subscribe while mounted; return true from the handler when the command was handled. */
export function onScopedCommand(handler: Handler): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** Offer a command to the most recent listeners first; false when nobody handled it. */
export function emitScopedCommand(id: CommandId): boolean {
  for (let i = handlers.length - 1; i >= 0; i -= 1) {
    if (handlers[i]!(id)) return true;
  }
  return false;
}
