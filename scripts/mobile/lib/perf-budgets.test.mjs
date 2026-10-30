import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameMetrics, judge, memoryMetrics, verdict } from './perf-budgets.mjs';

test('frame and memory metrics are found wherever agent-device nests them', () => {
  const frames = { success: true, data: { frameHealth: { droppedFramePercent: 3.2, droppedFrameCount: 12, worstFrameMs: 84.5 } } };
  assert.deepEqual(frameMetrics(frames), { jankPercent: 3.2, longestFrameMs: 84.5 });
  assert.deepEqual(frameMetrics({ data: { p95FrameMs: 18 } }), { p95FrameMs: 18 });
  assert.deepEqual(memoryMetrics({ data: { sample: { totalPssKb: 307200 } } }), { memoryMb: 300 });
  assert.deepEqual(memoryMetrics({ data: { residentMemoryBytes: 104857600 } }), { memoryMb: 100 });
  assert.deepEqual(memoryMetrics({ data: {} }), {});
});

test('budgets: over, regressed beyond the allowance, pass, and unmeasured never passes', () => {
  const rows = judge({ jankPercent: 5, p95FrameMs: 20, longestFrameMs: 100 }, { jankPercent: 4, longestFrameMs: 120 }, { jankPercent: 3 }, 10);
  assert.deepEqual(rows.map((row) => [row.metric, row.status]), [['jankPercent', 'regressed'], ['p95FrameMs', 'unmeasured'], ['longestFrameMs', 'over']]);
  assert.equal(judge({ memoryMb: 400 }, { memoryMb: 320 }, { memoryMb: 300 }, 10)[0].status, 'pass');
  assert.equal(verdict(rows), 1);
  assert.equal(verdict([{ status: 'pass' }, { status: 'unmeasured' }]), 0);
});
