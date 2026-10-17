// ────────────────────────────────────────────────────────────────
// A chat's latest turn, compacted for the prelude (U-39 follow-up).
//
// Opening a chat replays its latest turn into the live view. A turn that is one
// long run of work (a workflow worker, an orchestrated task) is mostly
// streaming deltas: 83% of a 1,400-row worker turn was `harness.token`, and a
// legacy one was 8,099 tool-input deltas nothing renders — 19 sequential
// requests and 2.5 MB to open. The replay only ever concatenates consecutive
// deltas (`tokenBuf += text`), so a run of them folds into one row losslessly,
// and rows the broker no longer stores at all are dropped. The prelude then
// carries the whole turn in one response.
// ────────────────────────────────────────────────────────────────

import type { StreamEventRow } from '@generatorai/db';
import { isNoiseEventKind } from '../events/EventBus.js';

/** Kinds whose consecutive rows the replay concatenates by their `text`. */
const FOLDABLE: ReadonlySet<string> = new Set(['harness.token', 'harness.reasoning_delta']);

/** Everything but the text: two deltas fold only when they belong to the same stream. */
function routing(payload: unknown): string {
  const { text: _text, ...rest } = (payload ?? {}) as Record<string, unknown>;
  return JSON.stringify(rest);
}

/**
 * `rows` (seq order) with noise dropped and each run of same-stream deltas folded into its last row, whose
 * seq/id/ts it keeps — so "applied up to the last seq" still holds for the client's ledger.
 */
export function foldTurnRows(rows: readonly StreamEventRow[]): StreamEventRow[] {
  const out: StreamEventRow[] = [];
  let runKey: string | null = null;
  for (const row of rows) {
    if (isNoiseEventKind(row.kind, row.payload)) continue;
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    if (!FOLDABLE.has(row.kind) || typeof payload['text'] !== 'string') {
      out.push(row);
      runKey = null;
      continue;
    }
    const key = `${row.kind}\u0000${routing(payload)}`;
    const last = out[out.length - 1];
    if (runKey === key && last) {
      const merged = `${(last.payload as Record<string, unknown>)['text'] as string}${payload['text'] as string}`;
      out[out.length - 1] = { ...row, payload: { ...payload, text: merged } };
    } else {
      out.push(row);
      runKey = key;
    }
  }
  return out;
}
