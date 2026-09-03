// ────────────────────────────────────────────────────────────────
// Fallback counters — PART 11.1: "Every expensive fallback increments a
// counter · Counter registry; tests assert deltas."
//
// The problem this solves is not observability in general — it is that a
// degraded path which still *works* is invisible. The system keeps serving
// requests while quietly paying 10× for them: the WebSocket screencast fell
// back to HTTP polling, node-pty failed to load so terminals are running on
// plain `child_process`, the DB sequence source failed so the event bus is
// issuing in-memory sequence numbers. Each of those is a correct-but-wrong
// state that no error log ever reports, because nothing errored.
//
// Two things are needed for the guardrail, and the repo previously had
// neither:
//
//   1. A NAMED REGISTRY. Every fallback declares itself here, so "which
//      degraded paths exist?" is answerable by reading one file rather than
//      grepping for catch blocks.
//   2. A READABLE VALUE. OpenTelemetry counters are write-only through the
//      API — `counter.add(1)` returns nothing and there is no way to read a
//      count back without standing up an SDK MeterProvider with an in-memory
//      exporter. That is why the plan's "tests assert deltas" clause was
//      unimplementable against the bare OTel facade: a test could only assert
//      that `add()` did not throw. This module therefore keeps its own
//      process-local tally alongside the OTel counter, so a test can assert a
//      real delta and an operator can read the whole set off /api/health.
//
// The OTel counter is still emitted, so real deployments get these in their
// metrics backend. The local tally is a few integers; it is not a metrics
// system and does not try to be one.
// ────────────────────────────────────────────────────────────────

import { getMeter } from './metrics.js';
import type { Counter } from '@opentelemetry/api';

/**
 * Every expensive fallback in the system, declared once.
 *
 * Adding a member here is the cheap half of the guardrail; the expensive half
 * is remembering to call `recordFallback` at the degradation site. Keep the
 * description in terms of *what got slower or weaker*, not what threw — the
 * reader of a dashboard needs the consequence.
 */
export const FALLBACK_KINDS = {
  /** WebSocket screencast unavailable; the viewer is polling JPEG over HTTP. */
  browser_screencast_http_poll: 'Browser live view degraded from WebSocket to HTTP polling',
  /** `node-pty` could not be loaded; terminals have no real TTY. */
  terminal_child_process_host: 'Terminal degraded from node-pty to plain child_process (no TTY)',
  /** The out-of-process pty host was unavailable; terminals run in-process. */
  terminal_in_process_host: 'Terminal host degraded from pty-host process to in-process node-pty',
  /** DB sequence allocation failed; sequences are in-memory and non-durable. */
  event_sequence_in_memory: 'Event sequence source degraded from the database to in-memory',
  /** Event persistence failed after retries; the broadcast was dropped. */
  event_persist_dropped: 'Event dropped after persistence retries were exhausted',
  /** A stream resume skipped a gap older than the dedup window. */
  stream_gap_skipped: 'Stream resume skipped events older than the dedup window',
  /** The cheap accessibility read failed; the full tree was re-serialised. */
  accessibility_full_reserialise: 'Accessibility snapshot fell back to full-tree serialisation',
  /** A provider model catalog read missed its cache and probed the provider. */
  model_catalog_cold_probe: 'Model catalog served by cold-probing the provider instead of cache',
} as const;

export type FallbackKind = keyof typeof FALLBACK_KINDS;

const tallies = new Map<FallbackKind, number>();
let counter: Counter | undefined;

function otelCounter(): Counter {
  // Lazily created: acquiring a meter before the SDK is configured yields a
  // no-op, and we would then hold that no-op forever.
  counter ??= getMeter('generatorai.fallbacks').createCounter('generatorai.fallback.total', {
    description: 'Count of expensive fallback paths taken, by kind',
  });
  return counter;
}

/**
 * Record that a degraded path was taken.
 *
 * Call this AT the degradation, not at the catch site that decided it — the
 * two are often different functions, and the count needs to mean "we actually
 * ran the slow path", not "we considered it".
 */
export function recordFallback(kind: FallbackKind, attributes?: Record<string, string>): void {
  tallies.set(kind, (tallies.get(kind) ?? 0) + 1);
  otelCounter().add(1, { kind, ...attributes });
}

/** Current count for one kind. Zero if it has never fired. */
export function fallbackCount(kind: FallbackKind): number {
  return tallies.get(kind) ?? 0;
}

/**
 * Every fallback that has fired at least once, with its count and
 * description. Intended for `/api/health` — an empty list is the healthy
 * state, and any entry is a "we are silently paying for something" signal.
 */
export function fallbackReport(): Array<{ kind: FallbackKind; count: number; description: string }> {
  return [...tallies.entries()]
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ kind, count, description: FALLBACK_KINDS[kind] }));
}

/** Test-only: clear tallies so cases do not leak into each other. */
export function resetFallbackCounters(): void {
  tallies.clear();
}
