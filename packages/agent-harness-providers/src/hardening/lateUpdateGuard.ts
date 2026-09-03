// ────────────────────────────────────────────────────────────────
// GenerationGuard — W13, the late-update guard.
//
// ── The bug it prevents ────────────────────────────────────────────
//
// Turn N is cancelled or times out. Turn N+1 starts on the same conversation.
// Turn N's stream is not dead yet — an in-flight SDK message, a tool handler
// that was mid-await, a provider that flushes a final `result` after the
// interrupt — and its next update arrives AFTER turn N+1 has begun emitting.
// Applied blindly, that update writes turn N's text into turn N+1's message,
// re-opens a tool call the user already stopped, or (worst) delivers turn N's
// `harness.idle` and ends turn N+1 in the UI while it is still running.
//
// Wall-clock or "is the controller aborted" checks do not catch this: the
// superseded turn's controller may be aborted while its own last message is
// already queued on the microtask queue behind the new turn's first one.
//
// The fix is a monotonic generation counter. Every update carries the
// generation it was produced under; anything older than `current` is DROPPED.
// This is the same mechanism W41 calls "generational enrichment" for provider
// status refreshes — the shape is identical, so it lives in one class.
//
// ── Why discards are counted, never silent ─────────────────────────
//
// PART 4.5: "Unmodelled protocol events emit a counter, never silently
// dropped." A guard that discards invisibly is indistinguishable from a
// provider that stopped emitting. `discardedCount` makes "we dropped 40
// updates from a superseded turn" a number someone can see.
// ────────────────────────────────────────────────────────────────

export interface GenerationGuardOptions {
  /** Fired per discarded update. Keep it cheap — this is on the event path. */
  onDiscard?: (key: string, updateGeneration: number, currentGeneration: number) => void;
}

/**
 * Per-key monotonic generation counter.
 *
 * Keyed because one provider instance serves many conversations, and
 * superseding turn N of conversation A must not discard conversation B's
 * updates. Use the conversationId as the key.
 */
export class GenerationGuard {
  private readonly generations = new Map<string, number>();
  private discarded = 0;
  private readonly onDiscard: GenerationGuardOptions['onDiscard'];

  constructor(options: GenerationGuardOptions = {}) {
    this.onDiscard = options.onDiscard;
  }

  /** Current generation for `key`. Generation 0 means "nothing started yet". */
  current(key: string): number {
    return this.generations.get(key) ?? 0;
  }

  /**
   * Start a new turn: bump the generation and return the token the new turn's
   * updates must carry. Everything issued under the previous token is
   * superseded from this instant.
   */
  begin(key: string): number {
    const next = this.current(key) + 1;
    this.generations.set(key, next);
    return next;
  }

  /**
   * Supersede whatever is running without starting a replacement — the cancel
   * path. Later updates from the cancelled turn are discarded, and the next
   * `begin()` still gets a fresh number.
   */
  supersede(key: string): number {
    return this.begin(key);
  }

  /** `true` if an update stamped `generation` may still be applied. */
  accept(key: string, generation: number): boolean {
    const current = this.current(key);
    if (generation === current) return true;
    this.discarded += 1;
    this.onDiscard?.(key, generation, current);
    return false;
  }

  /**
   * Wrap a handler so it only runs for the generation it was created under.
   * The intended call site is the point where a provider subscribes to a
   * turn's stream, so no caller has to remember to check.
   */
  gate<A extends unknown[]>(
    key: string,
    generation: number,
    fn: (...args: A) => void,
  ): (...args: A) => void {
    return (...args: A) => {
      if (!this.accept(key, generation)) return;
      fn(...args);
    };
  }

  /** How many updates have been dropped as late. Never resets on its own. */
  get discardedCount(): number {
    return this.discarded;
  }

  /** Drop a conversation's counter when the conversation is deleted. */
  forget(key: string): void {
    this.generations.delete(key);
  }
}
