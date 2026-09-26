// ────────────────────────────────────────────────────────────────
// Playwright test fixture for deterministic Web UI E2E.
//   - `tracker`  : auto-cleans every resource seeded during a test
//   - `seed`     : API seeders bound to the tracker
//   - `gotoApp`  : navigate + waitForLoadState('load') (NEVER networkidle —
//                  SSE keeps the connection open so networkidle never fires)
//   - `mockAiRun`: intercept run/stream endpoints to replay a fixed SSE
//                  sequence so streaming/state assertions are deterministic
//                  and cost-free. See TEST_PLAN.md §2.
// ────────────────────────────────────────────────────────────────

import { test as base, type Page, expect } from '@playwright/test';
import {
  ResourceTracker,
  seedWorkflowDefinition,
  seedChat,
  seedProject,
  seedAutomation,
  startRun,
  WEB_BASE,
} from './api';

export interface SeedApi {
  workflow: typeof seedWorkflowDefinition extends (t: ResourceTracker, o: infer O) => infer R
    ? (opts: O) => R
    : never;
  chat: (opts: { name: string; model?: string; tags?: string[] }) => Promise<string>;
  project: (opts: { name: string; description?: string }) => Promise<string>;
  automation: (opts: {
    name: string;
    workflowIds: string[];
    triggerType?: 'manual' | 'schedule' | 'webhook';
    inputMode?: 'single' | 'loop' | 'batch' | 'script';
    cronExpression?: string;
  }) => Promise<string>;
  run: (definitionId: string, variables?: Record<string, unknown>) => Promise<string>;
}

interface Fixtures {
  tracker: ResourceTracker;
  seed: SeedApi;
  gotoApp: (path: string) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  tracker: async ({}, use) => {
    const tracker = new ResourceTracker();
    await use(tracker);
    await tracker.cleanup();
  },

  seed: async ({ tracker }, use) => {
    await use({
      workflow: (opts) => seedWorkflowDefinition(tracker, opts),
      chat: (opts) => seedChat(tracker, opts),
      project: (opts) => seedProject(tracker, opts),
      automation: (opts) => seedAutomation(tracker, opts),
      run: (definitionId, variables) => startRun(tracker, definitionId, variables),
    });
  },

  gotoApp: async ({ page }, use) => {
    await use(async (path: string) => {
      await page.goto(`${WEB_BASE}${path}`);
      // DOMContentLoaded, not network idle — long-lived SSE never settles.
      await page.waitForLoadState('load');
    });
  },
});

export { expect };

// ── Deterministic AI-run mocking ────────────────────────────────

export interface MockStreamEvent {
  kind: string;
  data?: Record<string, unknown>;
}

/**
 * Replay a fixed SSE event sequence for a run's stream endpoint so the UI
 * renders deterministic streaming output without invoking a real model.
 * Call BEFORE navigating to the run page.
 */
export async function mockAiStream(page: Page, runId: string, events: MockStreamEvent[]): Promise<void> {
  await page.route(`**/api/stream**`, async (route) => {
    const url = route.request().url();
    if (!url.includes(runId)) {
      return route.continue();
    }
    let seq = 1;
    const body = events
      .map((e) => `id: ${seq++}\nevent: message\ndata: ${JSON.stringify({ ...e, sequenceId: seq })}\n\n`)
      .join('');
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
      body,
    });
  });
}

/** A canonical happy-path stream for one stage: token stream → tool call → complete. */
export function stageStreamEvents(stageRunId: string, workflowRunId: string): MockStreamEvent[] {
  const base = { stageRunId, workflowRunId };
  return [
    { kind: 'stage_run.running', data: base },
    { kind: 'harness.token', data: { ...base, text: 'Working' } },
    { kind: 'harness.token', data: { ...base, text: ' on it.' } },
    { kind: 'harness.tool_start', data: { ...base, tool: 'create', args: { path: 'src/x.ts' }, callId: 'c1' } },
    { kind: 'harness.tool_complete', data: { ...base, tool: 'create', result: 'ok', callId: 'c1', success: true } },
    { kind: 'harness.message_complete', data: { ...base, content: 'Done.' } },
    { kind: 'stage_run.completed', data: base },
  ];
}
