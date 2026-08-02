// ────────────────────────────────────────────────────────────────
// contextUsage — the single source of truth for "how full is the
// model's context window?".
//
// Both SDKs report authoritative context numbers (Copilot via
// `session.usage_info` / `metadata.contextInfo`, Claude via
// `getContextUsage()`), and both arrive as `harness.context_usage`
// events. This module decides what to show when they disagree with —
// or are missing next to — the coarse per-turn token counts.
//
// Precedence, highest first:
//   1. provider-reported snapshot  (source: 'provider')
//   2. derived snapshot            (source: 'derived' — last-call token math)
//   3. last turn's usage event     (input + cacheRead + cacheWrite)
//
// There is deliberately NO hardcoded model→window table. Guessing a
// window from a model name is what made the composer and the gauge
// disagree in the first place; if we genuinely don't know the limit we
// say so instead of inventing one.
// ────────────────────────────────────────────────────────────────

/** Where the tokens are going. Providers populate different subsets. */
export interface ContextBreakdown {
  system?: number;
  tools?: number;
  mcpTools?: number;
  memoryFiles?: number;
  conversation?: number;
  toolCalls?: number;
  toolResults?: number;
  attachments?: number;
  userMessages?: number;
  assistantMessages?: number;
  skills?: number;
  agents?: number;
}

/** A `harness.context_usage` event, as stored in the stream store. */
export interface ContextUsageSnapshot {
  source: 'provider' | 'derived';
  currentTokens: number;
  promptTokenLimit?: number;
  totalContextWindow?: number;
  compactionThreshold?: number;
  messagesLength?: number;
  model?: string;
  provider?: string;
  breakdown?: ContextBreakdown;
  apiUsage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  /** Client clock time the snapshot was applied — drives the "as of" label. */
  at?: number;
}

/** The last turn's raw token counters (`harness.usage`). */
export interface TurnUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
  provider?: string;
}

/** The selected model's provider-published limits. */
export interface ModelLimits {
  promptTokenLimit?: number;
  totalContextWindow?: number;
  maxOutputTokens?: number;
  longContext?: { promptTokenLimit?: number; totalContextWindow?: number };
  /** @deprecated legacy fields kept for servers that predate promptTokenLimit */
  contextWindow?: number;
  standardContextWindow?: number;
}

export interface ResolvedContextUsage {
  /** Tokens occupying the window, or null when nothing is known yet. */
  used: number | null;
  /** Denominator (max PROMPT tokens), or null when the provider hasn't said. */
  limit: number | null;
  /** used/limit clamped to 0..1; null when either side is unknown. */
  pct: number | null;
  /** Tokens still available, or null. */
  remaining: number | null;
  /** How trustworthy `used` is. */
  source: 'provider' | 'derived' | 'turn-usage' | 'none';
  breakdown?: ContextBreakdown;
  compactionThreshold?: number;
  messagesLength?: number;
  apiUsage?: ContextUsageSnapshot['apiUsage'];
  model?: string;
}

/**
 * Tokens occupying the window after a turn.
 *
 * Anthropic's `input_tokens` EXCLUDES cached tokens, so cache reads and cache
 * writes must be added back — otherwise a cache-heavy conversation reads as
 * near-empty. (Copilot already reports totals, and re-adding zero-valued cache
 * fields is harmless there.)
 */
export function contextTokensFromUsage(usage: TurnUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

/**
 * Resolve the model's prompt-token budget for the active context tier.
 *
 * Treats 0 as "unknown" — Copilot's `auto` model reports 0, and `??` would
 * happily pass that through and pin the gauge at 0%.
 */
export function resolveModelLimit(
  model: ModelLimits | undefined | null,
  tier?: 'default' | 'long_context',
): number | null {
  if (!model) return null;
  const positive = (n?: number): number | null => (typeof n === 'number' && n > 0 ? n : null);
  if (tier === 'long_context') {
    const long = positive(model.longContext?.promptTokenLimit) ?? positive(model.contextWindow);
    if (long != null) return long;
  }
  return (
    positive(model.promptTokenLimit) ??
    positive(model.standardContextWindow) ??
    positive(model.contextWindow) ??
    null
  );
}

/**
 * Combine everything we know into one consistent view.
 *
 * The provider's own `promptTokenLimit` wins over the catalog's, because the
 * runtime knows which tier the session actually negotiated.
 */
export function resolveContextUsage(args: {
  snapshot?: ContextUsageSnapshot | null;
  usage?: TurnUsage | null;
  model?: ModelLimits | null;
  tier?: 'default' | 'long_context';
}): ResolvedContextUsage {
  const { snapshot, usage, model, tier } = args;

  let used: number | null = null;
  let source: ResolvedContextUsage['source'] = 'none';
  if (snapshot && Number.isFinite(snapshot.currentTokens) && snapshot.currentTokens >= 0) {
    used = snapshot.currentTokens;
    source = snapshot.source;
  } else if (usage) {
    used = contextTokensFromUsage(usage);
    source = 'turn-usage';
  }

  const limit =
    (typeof snapshot?.promptTokenLimit === 'number' && snapshot.promptTokenLimit > 0
      ? snapshot.promptTokenLimit
      : null) ?? resolveModelLimit(model, tier);

  const pct = used != null && limit != null && limit > 0
    ? Math.max(0, Math.min(1, used / limit))
    : null;

  const result: ResolvedContextUsage = {
    used,
    limit,
    pct,
    remaining: used != null && limit != null ? Math.max(0, limit - used) : null,
    source,
  };
  if (snapshot?.breakdown) result.breakdown = snapshot.breakdown;
  if (snapshot?.compactionThreshold != null) result.compactionThreshold = snapshot.compactionThreshold;
  if (snapshot?.messagesLength != null) result.messagesLength = snapshot.messagesLength;
  if (snapshot?.apiUsage) result.apiUsage = snapshot.apiUsage;
  const modelName = snapshot?.model ?? usage?.model;
  if (modelName) result.model = modelName;
  return result;
}

/** Compact human token count: 1234 → "1.2k", 1_050_000 → "1.05M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n < 1000) return `${Math.round(n)}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Ring/bar colour by fill fraction. */
export function contextRingColor(pct: number | null): string {
  if (pct == null) return 'var(--color-border)';
  if (pct >= 0.9) return 'var(--color-danger)';
  if (pct >= 0.7) return 'var(--color-warning)';
  return 'var(--color-primary)';
}

/** "<1" / "42" / "—" — the label shown next to the ring. */
export function formatPctLabel(pct: number | null): string {
  if (pct == null) return '—';
  if (pct === 0) return '0';
  if (pct < 0.01) return '<1';
  return Math.round(pct * 100).toString();
}
