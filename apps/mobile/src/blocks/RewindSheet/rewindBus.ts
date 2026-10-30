// "Rewind to here" from the pane (MB-32 CheckpointScrubber): the pane renders in the shell, outside the chat's tree,
// so the request travels to the chat screen that owns the rewind (its sheet, its own-echo bookkeeping). Pure module
// state; a request with no chat listening is dropped (the scrubber only offers rewind inside a chat pane).
type Listener = (target: { turnId: string; prompt: string }) => void;
const listeners = new Map<string, Set<Listener>>();

export function requestRewind(chatId: string, target: { turnId: string; prompt: string }): void {
  for (const listener of listeners.get(chatId) ?? []) listener(target);
}

export function onRewindRequest(chatId: string, listener: Listener): () => void {
  const set = listeners.get(chatId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(chatId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(chatId);
  };
}
