// "Mention in chat" from a screen pushed over the chat (FilePreview, the diff): the composer of that chat — still
// mounted under the pushed screen — takes `@<path>` at its caret. A request with no composer listening is kept for
// the next one that mounts for the chat (the chat was reopened by a link). Pure module state, unit-tested.
type Listener = (path: string) => void;

const listeners = new Map<string, Set<Listener>>();
const pending = new Map<string, string[]>();

export function requestMention(chatId: string, path: string): void {
  const set = listeners.get(chatId);
  if (set && set.size > 0) {
    for (const listener of set) listener(path);
    return;
  }
  pending.set(chatId, [...(pending.get(chatId) ?? []), path]);
}

/** A chat's composer listens; queued requests are delivered at once. Returns the unsubscribe. */
export function onMentionRequest(chatId: string, listener: Listener): () => void {
  const set = listeners.get(chatId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(chatId, set);
  const queued = pending.get(chatId);
  if (queued) {
    pending.delete(chatId);
    for (const path of queued) listener(path);
  }
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(chatId);
  };
}
