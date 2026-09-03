import { beforeEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_KINDS,
  fallbackCount,
  fallbackReport,
  recordFallback,
  resetFallbackCounters,
} from '../src/telemetry/fallbackCounters.js';

// PART 11.1 requires "tests assert deltas" on fallback counters. That clause
// was unimplementable against the bare OTel API — `counter.add(1)` returns
// void and there is no read path without an SDK MeterProvider — which is why
// the only pre-existing metrics test asserted that `add()` did not throw.
// These assert real values.

describe('fallback counters', () => {
  beforeEach(() => resetFallbackCounters());

  it('starts at zero for every declared kind', () => {
    for (const kind of Object.keys(FALLBACK_KINDS) as Array<keyof typeof FALLBACK_KINDS>) {
      expect(fallbackCount(kind)).toBe(0);
    }
  });

  it('records a readable delta rather than a write-only counter', () => {
    const before = fallbackCount('terminal_child_process_host');
    recordFallback('terminal_child_process_host');
    recordFallback('terminal_child_process_host');
    expect(fallbackCount('terminal_child_process_host') - before).toBe(2);
  });

  it('keeps kinds independent', () => {
    recordFallback('event_persist_dropped');
    expect(fallbackCount('event_persist_dropped')).toBe(1);
    expect(fallbackCount('browser_screencast_http_poll')).toBe(0);
  });

  it('does not throw when the OTel SDK was never initialised', () => {
    // The no-op meter path is the one that runs in tests and in any
    // deployment with telemetry disabled — it must stay free of surprises.
    expect(() => recordFallback('stream_gap_skipped', { reason: 'window' })).not.toThrow();
  });

  it('reports nothing while the system is healthy', () => {
    expect(fallbackReport()).toEqual([]);
  });

  it('reports only kinds that actually fired, with their description', () => {
    recordFallback('browser_screencast_http_poll');
    recordFallback('browser_screencast_http_poll');
    recordFallback('model_catalog_cold_probe');

    const report = fallbackReport();
    expect(report).toHaveLength(2);

    const screencast = report.find((r) => r.kind === 'browser_screencast_http_poll');
    expect(screencast).toEqual({
      kind: 'browser_screencast_http_poll',
      count: 2,
      description: FALLBACK_KINDS.browser_screencast_http_poll,
    });
  });

  it('gives every declared kind a description that says what got worse', () => {
    // A dashboard reader needs the consequence, not the exception. Guard
    // against a future kind being added with a placeholder description.
    for (const [kind, description] of Object.entries(FALLBACK_KINDS)) {
      expect(description.length, `${kind} needs a real description`).toBeGreaterThan(20);
      expect(description).toMatch(/degrad|drop|skip|fell back|instead of/i);
    }
  });
});
