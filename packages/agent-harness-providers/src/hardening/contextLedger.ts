// ────────────────────────────────────────────────────────────────
// AppendOnlyContext — W13, the append-only invariant and the
// four-breakpoint cache scheme.
//
// ── The invariant ──────────────────────────────────────────────────
//
// Anthropic prompt caching is a PREFIX MATCH. The cache key is derived from
// the exact bytes of the rendered prompt up to each `cache_control`
// breakpoint, and the render order is `tools` → `system` → `messages`. One
// changed byte at position N invalidates every breakpoint at or after N.
//
// Which makes editing history the most expensive thing this package can
// silently do. Rewriting a tool result to redact a secret, re-serialising an
// earlier message with different key order, appending "(edited)" to turn 3,
// injecting a fresh timestamp into the system prompt on every request — each
// is a one-line change that costs full price on the ENTIRE conversation for
// the rest of its life. Nothing fails. `cache_read_input_tokens` just quietly
// reads 0 forever.
//
// So the context is APPEND-ONLY and the class enforces it: `append()` is the
// only mutator, and `assertPrefixOf()` proves a newly-rendered context still
// begins with the exact bytes of the last one. A violation throws, loudly,
// with the index that changed — because "your cache hit rate is 0%" is not a
// diagnosable symptom, and "record 4 was rewritten" is.
//
// ── The four-breakpoint scheme ─────────────────────────────────────
//
// The API allows a maximum of FOUR `cache_control` breakpoints per request.
// That is a hard budget, so the scheme allocates it deliberately rather than
// letting call sites sprinkle markers:
//
//   slot 0 — PINNED, end of `tools`+`system`. Everything before it is frozen
//            for the life of the session. This is the breakpoint that pays for
//            itself on turn two and every turn after.
//   slot 1 — PINNED, end of the session-stable prefix: retrieved documents,
//            few-shot examples, the workspace preamble. Set once, when that
//            prefix stops growing.
//   slots 2 and 3 — ROLLING, over the conversation. They ALTERNATE.
//
// The alternation is the part that is easy to get wrong. Two rolling
// breakpoints exist because a single one can only ever WRITE: move it to the
// end of the newest turn and the request contains no marker at a position that
// was cached last time, so there is nothing to read from and every turn pays a
// full write. With two, the older marker sits at a prefix that WAS written on
// the previous request (a read hit) while the newer one extends the cache for
// the next request (a write). Retiring the older of the two — never a pinned
// slot — is what keeps the budget at four.
//
// Volatile content (the current question, a timestamp, a per-request id) is
// appended AFTER the last breakpoint, where it invalidates nothing.
//
// Minimum cacheable prefix is model-dependent (512 tokens on Claude Opus 5 and
// Fable 5; 1024 on Opus 4.8 / Sonnet 5 / Sonnet 4.6; 4096 on Opus 4.6 and
// Haiku 4.5) and a shorter prefix silently does not cache — so `minTokens`
// is configurable and a breakpoint below it is refused rather than placed.
// ────────────────────────────────────────────────────────────────

/** Hard API limit: at most 4 `cache_control` breakpoints per request. */
export const MAX_CACHE_BREAKPOINTS = 4;

/** Cache-eligible prefix minimums, by model family. */
export const CACHE_MIN_PREFIX_TOKENS: Readonly<Record<string, number>> = Object.freeze({
  'claude-opus-5': 512,
  'claude-fable-5': 512,
  'claude-mythos-5': 512,
  'claude-opus-4-8': 1024,
  'claude-sonnet-5': 1024,
  'claude-sonnet-4-6': 1024,
  'claude-opus-4-7': 2048,
  'claude-opus-4-6': 4096,
  'claude-haiku-4-5': 4096,
});

/** Conservative default: the largest minimum, so a breakpoint is never wasted. */
export const DEFAULT_CACHE_MIN_PREFIX_TOKENS = 4096;

export function cacheMinPrefixTokens(model: string | undefined): number {
  if (!model) return DEFAULT_CACHE_MIN_PREFIX_TOKENS;
  return CACHE_MIN_PREFIX_TOKENS[model] ?? DEFAULT_CACHE_MIN_PREFIX_TOKENS;
}

export class ContextInvariantError extends Error {
  constructor(message: string, readonly index: number) {
    super(message);
    this.name = 'ContextInvariantError';
  }
}

export interface ContextRecord {
  /** Stable identity, so a violation names the record and not just an index. */
  readonly id: string;
  /** The exact bytes this record contributes to the rendered prompt. */
  readonly text: string;
}

/** Where a breakpoint sits, and whether the scheme may retire it. */
export interface CacheBreakpoint {
  readonly slot: 0 | 1 | 2 | 3;
  /** Index in the record list this breakpoint marks the END of (inclusive). */
  readonly index: number;
  readonly pinned: boolean;
  readonly label: string;
}

export interface AppendOnlyContextOptions {
  /** Model id, used to pick the minimum cacheable prefix. */
  model?: string;
  /**
   * Rough characters-per-token, used only to refuse breakpoints that are too
   * early to cache. 4 is the conventional English approximation; the exact
   * value does not matter because the check is a floor, not an accounting.
   */
  charsPerToken?: number;
}

export class AppendOnlyContext {
  private readonly records: ContextRecord[] = [];
  /** Cumulative rendered length after each record, for the min-prefix check. */
  private readonly cumulativeChars: number[] = [];
  private readonly breakpoints = new Map<0 | 1 | 2 | 3, CacheBreakpoint>();
  /** Which rolling slot the NEXT rolling breakpoint takes. Alternates 2↔3. */
  private nextRollingSlot: 2 | 3 = 2;
  private readonly minPrefixTokens: number;
  private readonly charsPerToken: number;

  constructor(options: AppendOnlyContextOptions = {}) {
    this.minPrefixTokens = cacheMinPrefixTokens(options.model);
    this.charsPerToken = options.charsPerToken ?? 4;
  }

  get length(): number {
    return this.records.length;
  }

  entries(): readonly ContextRecord[] {
    return this.records;
  }

  /** The only mutator. Returns the index of the appended record. */
  append(record: ContextRecord): number {
    const prev = this.cumulativeChars[this.cumulativeChars.length - 1] ?? 0;
    this.records.push(record);
    this.cumulativeChars.push(prev + record.text.length);
    return this.records.length - 1;
  }

  /** Rendered prefix through `index` (inclusive). */
  renderPrefix(index: number): string {
    return this.records.slice(0, index + 1).map((r) => r.text).join('');
  }

  /**
   * Prove that `next` is this context with records appended and NOTHING
   * rewritten. Call it wherever a context is rebuilt rather than mutated — a
   * resume, a fork, a compaction pass.
   *
   * @throws ContextInvariantError naming the first record that changed.
   */
  assertPrefixOf(next: readonly ContextRecord[]): void {
    if (next.length < this.records.length) {
      throw new ContextInvariantError(
        `Context shrank from ${this.records.length} to ${next.length} records. ` +
        `The context is append-only: removing a record rewrites the cached prefix ` +
        `and invalidates every breakpoint after it.`,
        next.length,
      );
    }
    for (let i = 0; i < this.records.length; i++) {
      const before = this.records[i] as ContextRecord;
      const after = next[i] as ContextRecord;
      if (before.id !== after.id || before.text !== after.text) {
        throw new ContextInvariantError(
          `Context record ${i} ("${before.id}") was rewritten. The context is ` +
          `append-only: prompt caching is a prefix match, so editing an already-sent ` +
          `record invalidates the cache for this record and everything after it — ` +
          `silently, at full price, for the rest of the conversation. ` +
          `Append a correction instead of editing history.`,
          i,
        );
      }
    }
  }

  private prefixTokensAt(index: number): number {
    const chars = this.cumulativeChars[index] ?? 0;
    return Math.floor(chars / this.charsPerToken);
  }

  /**
   * Place a PINNED breakpoint (slot 0 = tools+system, slot 1 = stable prefix).
   * Pinned slots are set once and never retired.
   *
   * @returns the breakpoint, or `undefined` when the prefix is too short to
   *   cache — placing a marker there would pay the write premium for zero reads.
   */
  pin(slot: 0 | 1, index: number, label: string): CacheBreakpoint | undefined {
    if (index < 0 || index >= this.records.length) {
      throw new RangeError(`pin: index ${index} is outside the context (${this.records.length} records)`);
    }
    if (this.prefixTokensAt(index) < this.minPrefixTokens) return undefined;
    const bp: CacheBreakpoint = { slot, index, pinned: true, label };
    this.breakpoints.set(slot, bp);
    return bp;
  }

  /**
   * Advance the rolling pair to cover everything through `index`.
   *
   * Takes the slot that was NOT used last time, so the previous rolling marker
   * survives as a read point for exactly one more request before it is
   * overwritten. That alternation is the difference between a cache that reads
   * and one that only ever writes.
   */
  roll(index: number, label: string): CacheBreakpoint | undefined {
    if (index < 0 || index >= this.records.length) {
      throw new RangeError(`roll: index ${index} is outside the context (${this.records.length} records)`);
    }
    if (this.prefixTokensAt(index) < this.minPrefixTokens) return undefined;
    const slot = this.nextRollingSlot;
    const bp: CacheBreakpoint = { slot, index, pinned: false, label };
    this.breakpoints.set(slot, bp);
    this.nextRollingSlot = slot === 2 ? 3 : 2;
    return bp;
  }

  /**
   * The breakpoints to render, in prompt order. Never more than four — the
   * scheme cannot exceed the budget because there are only four slots and a
   * roll overwrites a slot rather than adding one.
   */
  activeBreakpoints(): CacheBreakpoint[] {
    const list = [...this.breakpoints.values()].sort((a, b) => a.index - b.index);
    /* W13 — defensive: the slot map makes this unreachable, but a future
       caller adding a fifth marker must fail here rather than at the API. */
    if (list.length > MAX_CACHE_BREAKPOINTS) {
      throw new ContextInvariantError(
        `${list.length} cache breakpoints requested; the API allows at most ` +
        `${MAX_CACHE_BREAKPOINTS} per request.`,
        -1,
      );
    }
    return list;
  }
}
