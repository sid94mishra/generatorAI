// ────────────────────────────────────────────────────────────────
// Tests — shared telemetry metrics utilities
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { getMeter } from '../src/telemetry/metrics.js';

describe('getMeter', () => {
  it('returns a meter from the global provider', () => {
    const meter = getMeter('test-meter');
    expect(meter).toBeDefined();
  });

  it('creates counters without error', () => {
    const meter = getMeter('test-meter');
    const counter = meter.createCounter('test.counter');
    expect(counter).toBeDefined();
    // No-op meter — add() should not throw
    counter.add(1);
  });

  it('creates histograms without error', () => {
    const meter = getMeter('test-meter');
    const histogram = meter.createHistogram('test.histogram');
    expect(histogram).toBeDefined();
    histogram.record(42);
  });

  it('creates up-down counters without error', () => {
    const meter = getMeter('test-meter');
    const upDown = meter.createUpDownCounter('test.updown');
    expect(upDown).toBeDefined();
    upDown.add(1);
    upDown.add(-1);
  });
});
