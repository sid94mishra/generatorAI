// ────────────────────────────────────────────────────────────────
// D-88 — streaming a large answer and switching view modes, measured.
//
// Needs a sandbox whose Faux harness is scripted from the perf fixture:
//   node agent-tests/perf/fixtures/orchestrator-report.mjs
//   GENERATORAI_SANDBOX_FAUX_SCRIPT=agent-tests/perf/fixtures/orchestrator-report.faux.json \
//     node scripts/redesign/sandbox.mjs --port=<p> --web-port=<w>
//   TARGET_URL=http://localhost:<w> API_URL=http://127.0.0.1:<p>/api \
//     pnpm --filter @generatorai/agent-tests exec playwright test -c perf/playwright.perf.config.ts transcript-stream
//
// One chat streams a ~4,000-word report (12 sections, tables, code, lists)
// after a dozen tool steps; the page counts long tasks while it streams, then
// switches Normal / Verbose / Summary and reads the Event Timing durations of
// the clicks. Prints one JSON line per metric (the numbers are recorded in
// docs/redesign/reviews/desktop-orchestrator-test.md). The assertions are
// generous regression fences, not the targets: frame timing on a shared or
// busy machine is noisy (09 §8.2 — CI runs this reporting-only).
// ────────────────────────────────────────────────────────────────

import { expect, test } from '@playwright/test';
// @ts-expect-error — a plain .mjs fixture module without types.
import { PERF_CHAT_NAME } from './fixtures/orchestrator-report.mjs';

const API = process.env.API_URL || 'http://localhost:3100/api';

test('large streamed answer: long tasks while streaming, mode-switch interaction latency', async ({ page }) => {
  const res = await fetch(`${API}/chats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: PERF_CHAT_NAME, tags: ['perf'] }),
  });
  const chat = (await res.json()) as { id: string };
  expect(chat.id).toBeTruthy();

  await page.goto(`/chats/${chat.id}`);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => {
    const w = window as unknown as { __lt: number[] };
    w.__lt = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__lt.push(Math.round(entry.duration));
    }).observe({ type: 'longtask' });
  });

  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill('Write the final report.');
  await box.press('Enter');
  await expect(page.getByText('Generating response…').or(page.getByText('Generating response...'))).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /12\. Follow-ups/ })).toBeVisible({ timeout: 180_000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Generating response'), null, { timeout: 60_000 });

  const longTasks = await page.evaluate(() => (window as unknown as { __lt: number[] }).__lt);
  const over50 = longTasks.filter((d) => d > 50);
  console.log(JSON.stringify({ metric: 'stream', longTasks: longTasks.length, over50: over50.length, max: Math.max(0, ...longTasks) }));

  // Trusted clicks (Event Timing ignores script-dispatched events): the click → next-paint duration.
  await page.evaluate(() => {
    const w = window as unknown as { __clicks: number[] };
    w.__clicks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'click') w.__clicks.push(Math.round(e.duration));
    }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
  });
  const modes = page.getByRole('radiogroup', { name: 'Transcript view' });
  for (const name of ['Verbose', 'Summary', 'Normal', 'Summary', 'Verbose', 'Normal', 'Verbose', 'Normal', 'Summary', 'Normal']) {
    await modes.getByRole('radio', { name }).click();
    await page.waitForTimeout(400);
  }
  // Clicks under the 16 ms threshold are not reported: count them as 16.
  const reported = await page.evaluate(() => (window as unknown as { __clicks: number[] }).__clicks);
  const durations = [...reported, ...Array(Math.max(0, 10 - reported.length)).fill(16)];
  const sorted = [...durations].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  console.log(JSON.stringify({ metric: 'modeSwitch', clicks: durations.length, p95, max: sorted.at(-1) ?? 0 }));

  // Regression fences (targets: no long task > 50 ms while streaming; < 50 ms p95 interaction).
  expect(over50.length).toBeLessThanOrEqual(10);
  expect(Math.max(0, ...longTasks)).toBeLessThan(500);
  expect(p95).toBeLessThan(200);
});
