// ────────────────────────────────────────────────────────────────
// Per-turn usage from a persistent session's running totals.
//
// A persistent Claude CLI process reports `total_cost_usd`, `usage` and
// `modelUsage` on every `result` as totals for the whole process, not for the
// turn: a chat's second turn showed the first turn's cost added in, and every
// consumer that sums `harness.usage` (workflow summaries, telemetry) counted
// the first turn again on each later one. `harness.usage` means "this turn",
// so the persistent reader subtracts what the session had already reported
// when the turn began. A one-shot query is its own process: its totals are the
// turn's and need no adjustment.
// ────────────────────────────────────────────────────────────────

type Counters = Record<string, number>;

export interface SessionUsageTotals {
  costUsd: number;
  usage: Counters;
  models: Record<string, Counters>;
}

const USAGE_COUNTERS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const;
// `contextWindow` / `maxOutputTokens` describe the model, not spend: never subtracted.
const MODEL_COUNTERS = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'webSearchRequests', 'costUSD'] as const;

interface ResultLike {
  total_cost_usd?: number;
  usage?: object;
  modelUsage?: Record<string, object>;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function pick(source: object | undefined, keys: readonly string[]): Counters {
  const out: Counters = {};
  for (const k of keys) out[k] = num((source as Record<string, unknown> | undefined)?.[k]);
  return out;
}

/** The running totals a `result` carries. */
export function sessionTotalsOf(result: ResultLike): SessionUsageTotals {
  const models: Record<string, Counters> = {};
  for (const [model, usage] of Object.entries(result.modelUsage ?? {})) models[model] = pick(usage, MODEL_COUNTERS);
  return { costUsd: num(result.total_cost_usd), usage: pick(result.usage, USAGE_COUNTERS), models };
}

function minus(source: object, base: Counters | undefined, keys: readonly string[]): object {
  if (!base) return source;
  const out: Record<string, unknown> = { ...source };
  for (const k of keys) {
    if (typeof out[k] === 'number') out[k] = Math.max(0, (out[k] as number) - (base[k] ?? 0));
  }
  return out;
}

/**
 * `result` with the session's totals as of `base` taken out, so its cost and token counts cover only what came
 * after. Unchanged when `base` is absent or the totals went backwards (not the process `base` was read from).
 */
export function usageSince<T extends ResultLike>(result: T, base: SessionUsageTotals | undefined): T {
  if (!base || num(result.total_cost_usd) + 1e-9 < base.costUsd) return result;
  const modelUsage = result.modelUsage
    ? Object.fromEntries(Object.entries(result.modelUsage).map(([m, u]) => [m, minus(u, base.models[m], MODEL_COUNTERS)]))
    : undefined;
  return {
    ...result,
    total_cost_usd: Math.max(0, num(result.total_cost_usd) - base.costUsd),
    ...(result.usage ? { usage: minus(result.usage, base.usage, USAGE_COUNTERS) } : {}),
    ...(modelUsage ? { modelUsage } : {}),
  };
}
