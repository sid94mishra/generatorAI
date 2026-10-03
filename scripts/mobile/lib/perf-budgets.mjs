// Pure parts of the mobile perf check (08 §4.7, M10-03, MD-194): reading agent-device's `perf frames --json` /
// `perf memory sample --json` output, and judging metrics against apps/mobile/perf/budgets.json and the previous
// batch. Node tests: perf-budgets.test.mjs.

/** Depth-first search for the first finite number under any of the keys. */
function findNumber(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return undefined;
  for (const key of keys) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findNumber(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Frame metrics from `agent-device perf frames --json`: janky share (frames over the deadline, agent-device's
 * `droppedFramePercent`), longest frame, and p95 frame time when the platform reports it.
 */
export function frameMetrics(json) {
  const metrics = {};
  const jank = findNumber(json, ['droppedFramePercent', 'jankyFramePercent', 'jankPercent']);
  if (jank !== undefined) metrics.jankPercent = jank;
  const longest = findNumber(json, ['worstFrameMs', 'maxFrameMs', 'longestFrameMs']);
  if (longest !== undefined) metrics.longestFrameMs = longest;
  const p95 = findNumber(json, ['p95FrameMs', 'frameTimeP95Ms', 'p95Ms']);
  if (p95 !== undefined) metrics.p95FrameMs = p95;
  return metrics;
}

/** Resident memory in MB from `agent-device perf memory sample --json` (Android PSS, iOS resident footprint). */
export function memoryMetrics(json) {
  const kb = findNumber(json, ['totalPssKb', 'residentMemoryKb', 'rssKb']);
  if (kb !== undefined) return { memoryMb: Math.round((kb / 1024) * 10) / 10 };
  const bytes = findNumber(json, ['residentMemoryBytes', 'physFootprintBytes']);
  return bytes === undefined ? {} : { memoryMb: Math.round((bytes / 1048576) * 10) / 10 };
}

/**
 * Every budgeted metric of a scenario: `pass` / `over` against the budget, `regressed` when it is more than
 * `regressionPercent` worse than the previous batch, `unmeasured` when the driver did not report it (never a pass).
 */
export function judge(budgets, measured, previous = {}, regressionPercent = 10) {
  return Object.entries(budgets).map(([metric, budget]) => {
    const value = measured[metric];
    if (value === undefined) return { metric, budget, status: 'unmeasured' };
    const before = previous[metric];
    const regressed = before !== undefined && before > 0 && value > before * (1 + regressionPercent / 100);
    return { metric, budget, value, ...(before !== undefined ? { previous: before } : {}), status: value > budget ? 'over' : regressed ? 'regressed' : 'pass' };
  });
}

/** Exit 1 when any metric is over budget or regressed; unmeasured metrics are reported but do not fail. */
export function verdict(rows) {
  return rows.some((row) => row.status === 'over' || row.status === 'regressed') ? 1 : 0;
}
