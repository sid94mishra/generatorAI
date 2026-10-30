// ────────────────────────────────────────────────────────────────
// StreamingChatRegistry — which chats have an in-flight turn, since when.
//
// `ChatManagementService` already kept this set as a plain
// `Map<chatId, unsubscribe>` (`activeSubscriptions`): an entry exists exactly
// while a prompt is being processed. Two readers needed more than the key
// set: the attention feed (G-01) shows "running for 4m", which needs the
// start time, and it must hear the set change without polling. Inferring it
// from `harness.turn_start` / `harness.idle` does not work — the entry is
// added after `turn_start` and removed after the `harness.idle` handler has
// run, so both events race the map.
//
// A `Map` subclass so every existing `set` / `delete` call site keeps its
// exact semantics. `set` is only ever called once per turn, so it always
// restarts the clock — a stale entry left by a turn that never settled must
// not make the next turn look hours old.
// ────────────────────────────────────────────────────────────────

export type StreamingChangeListener = (chatId: string, streaming: boolean) => void;

export class StreamingChatRegistry extends Map<string, () => void> {
  private readonly startedAt = new Map<string, Date>();
  private readonly listeners = new Set<StreamingChangeListener>();

  override set(chatId: string, unsubscribe: () => void): this {
    super.set(chatId, unsubscribe);
    // Field initialisers have not run yet when `Map`'s constructor calls
    // `set` for an initial iterable; this class is never constructed with one.
    this.startedAt.set(chatId, new Date());
    this.notify(chatId, true);
    return this;
  }

  override delete(chatId: string): boolean {
    const removed = super.delete(chatId);
    if (removed) {
      this.startedAt.delete(chatId);
      this.notify(chatId, false);
    }
    return removed;
  }

  override clear(): void {
    const ids = [...super.keys()];
    super.clear();
    this.startedAt.clear();
    for (const id of ids) this.notify(id, false);
  }

  /** chatId → when its current turn started streaming. A copy. */
  since(): Map<string, Date> {
    return new Map(this.startedAt);
  }

  /** Called synchronously on every add/remove. Returns an unsubscribe. */
  onChange(listener: StreamingChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(chatId: string, streaming: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(chatId, streaming);
      } catch {
        // A broken observer must never break the turn lifecycle it observes.
      }
    }
  }
}
