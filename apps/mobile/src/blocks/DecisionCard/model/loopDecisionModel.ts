// MB-34 DecisionCard model (03 MB-34; P05 WP-5A.5; MRunLoop): a PARKED loop is `awaiting_input` with
// `interruptData.kind === 'loop_decision'` and is answered with the loop run commands (grant iterations, raise the
// budget, continue with input, accept, accept an earlier iteration, fail) — never with the approval card. This
// reads the park's payload, the iterations an accept may take, the card's headline and the spend so far. Pure,
// unit-tested (moved from components/runs/loopModel).

export interface LoopDecisionView {
  /** `pause`: an exit rule asked for a person; `exhaust`: a limit was hit with onLimit=pause. */
  action: 'pause' | 'exhaust';
  reason: string;
  /** The last finished iteration (0-based; -1 when none finished). */
  k: number;
  iterations: number;
  maxIterations: number | null;
  /** Iterations whose workspace was checkpointed. */
  checkpoints: number[];
  scores: Array<{ k: number; score: number | null }>;
  budget: Record<string, number>;
  usage: Record<string, unknown>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The parked loop's payload, or null when `interruptData` is not a loop decision. */
export function loopDecisionOf(interruptData: unknown): LoopDecisionView | null {
  const d = rec(interruptData);
  if (d['kind'] !== 'loop_decision') return null;
  const budget: Record<string, number> = {};
  for (const [key, value] of Object.entries(rec(d['budget']))) {
    const n = num(value);
    if (n !== null) budget[key] = n;
  }
  const iterations = num(d['iterations']) ?? 0;
  return {
    action: d['action'] === 'exhaust' ? 'exhaust' : 'pause',
    reason: typeof d['reason'] === 'string' ? d['reason'] : '',
    k: num(d['k']) ?? iterations - 1,
    iterations,
    maxIterations: num(d['maxIterations']),
    checkpoints: Array.isArray(d['checkpoints']) ? (d['checkpoints'] as unknown[]).map(num).filter((n): n is number => n !== null) : [],
    scores: Array.isArray(d['scores'])
      ? (d['scores'] as unknown[]).flatMap((s) => {
          const k = num(rec(s)['k']);
          return k === null ? [] : [{ k, score: num(rec(s)['score']) }];
        })
      : [],
    budget,
    usage: rec(d['usage']),
  };
}

/** The iterations `accept_iteration` can take: every checkpointed one plus the last (no restore). Oldest first. */
export function acceptableIterations(view: LoopDecisionView): number[] {
  const out = new Set(view.checkpoints.filter((k) => k >= 0 && k <= view.k));
  if (view.k >= 0) out.add(view.k);
  return [...out].sort((a, b) => a - b);
}

/** `max_iterations` → `max iterations`. */
export function reasonLabel(reason: string | null | undefined): string {
  return reason ? reason.replace(/[_:]+/g, ' ').trim() : '';
}

/** The card's one-line "why": "Paused · budget reached", "Ran out · max iterations". */
export function decisionHeadline(view: LoopDecisionView): string {
  const reason = reasonLabel(view.reason);
  if (view.action === 'exhaust') return reason ? `Ran out · ${reason}` : 'The loop ran out';
  return reason ? `Paused · ${reason}` : 'A rule paused the loop';
}

/** Spend so far against the budget, as short parts ("12/20 turns", "$0.42/$1.00"). */
export function budgetParts(view: Pick<LoopDecisionView, 'usage' | 'budget'>): string[] {
  const parts: string[] = [];
  const turns = num(view.usage['turns']);
  const cost = num(view.usage['costUsd']);
  const tokens = (num(view.usage['inputTokens']) ?? 0) + (num(view.usage['outputTokens']) ?? 0);
  const of = (limit: number | undefined, fmt: (n: number) => string) => (limit !== undefined ? `/${fmt(limit)}` : '');
  if (turns !== null || view.budget['maxTurns'] !== undefined) parts.push(`${turns ?? 0}${of(view.budget['maxTurns'], String)} turns`);
  if (cost !== null || view.budget['maxCostUsd'] !== undefined) {
    const usd = (n: number) => `$${n.toFixed(2)}`;
    parts.push(`${usd(cost ?? 0)}${of(view.budget['maxCostUsd'], usd)}`);
  }
  if (tokens > 0 || view.budget['maxTokens'] !== undefined) {
    const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
    parts.push(`${k(tokens)}${of(view.budget['maxTokens'], k)} tokens`);
  }
  if (view.budget['maxWallClockMs'] !== undefined) parts.push(`${Math.round(view.budget['maxWallClockMs'] / 60_000)} min limit`);
  return parts;
}

/** A refusal's text for the operator — the server's code prefix made readable. */
export function loopCommandError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (text.includes('checkpoint_unavailable')) {
    const detail = text.split('checkpoint_unavailable:')[1]?.trim();
    return `That iteration has no workspace checkpoint to restore.${detail ? ` ${detail}` : ''}`;
  }
  return text;
}

/** Parses a positive number from a field, or null when blank or not one. */
export function positive(text: string, integer: boolean): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return integer ? Math.round(n) : n;
}
