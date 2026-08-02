import { test, expect } from '../helpers/test';
import { startRun, waitForRunStatus, getStageStatuses } from '../helpers/api';

// Phase W6 — Workflow Run: controls, live execution, streaming render,
// and conditional edge routing. Runs really execute (trivial prompts keep
// them fast); assertions are on STATUS + STRUCTURE, never generated text,
// so they are deterministic.

const IMPOSSIBLE = 'IMPOSSIBLE_MARKER_QZX_9183';

test.describe('Run controls', () => {
  test('a created (not started) run shows the Start control', async ({ page, gotoApp, seed }) => {
    const def = await seed.workflow({
      name: `W6 Created ${Date.now()}`,
      stages: [{ localId: 's', name: 'Only', prompt: 'Reply DONE' }],
    });
    const runId = await seed.run(def);
    await gotoApp(`/workflows/${def}/runs/${runId}`);
    await expect(page.getByText('Created', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  });
});

test.describe('Run lifecycle + streaming render', () => {
  test('a two-stage run completes and renders messages', async ({ page, gotoApp, seed }) => {
    test.setTimeout(180_000);
    const def = await seed.workflow({
      name: `W6 Lifecycle ${Date.now()}`,
      stages: [
        { localId: 'a', name: 'First', prompt: 'Reply with the word DONE.' },
        { localId: 'b', name: 'Second', prompt: 'Reply with the word DONE.' },
      ],
      edges: [{ from: 'a', to: 'b', type: 'on_success' }],
    });
    const runId = await seed.run(def);
    await startRun(runId);
    const status = await waitForRunStatus(runId, ['completed', 'failed', 'cancelled'], 150_000);
    expect(status).toBe('completed');

    const stages = await getStageStatuses(runId);
    expect(stages['First']).toBe('completed');
    expect(stages['Second']).toBe('completed');

    // UI reflects the persisted/completed run on load (resumability/replay).
    await gotoApp(`/workflows/${def}/runs/${runId}`);
    await expect(page.getByText('Completed', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('First', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Second', { exact: true }).first()).toBeVisible();

    // Expand the first stage and confirm prompt/response blocks replay.
    await page.getByRole('button', { name: /First/ }).last().click();
    await page.waitForTimeout(600);
    await expect(page.getByText('Prompt', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Response', { exact: false }).first()).toBeVisible();
    // Note: a cleanly-completed run shows no Retry control (Retry is for
    // failed/cancelled runs) — verified separately, not asserted here.
  });
});

test.describe('Conditional edge routing', () => {
  test('validation failure routes on_failure, skips on_success, always runs on_completion', async ({ page, gotoApp, seed }) => {
    test.setTimeout(180_000);
    const def = await seed.workflow({
      name: `W6 Routing ${Date.now()}`,
      stages: [
        { localId: 'setup', name: 'Setup', prompt: 'Reply OK' },
        {
          localId: 'validate',
          name: 'ValidateFails',
          prompt: 'Reply with a short sentence.',
          resultValidation: [{ type: 'contains', value: IMPOSSIBLE, message: 'must contain impossible marker' }],
          noRetry: true,
        },
        { localId: 'recovery', name: 'Recovery', prompt: 'Reply RECOVERED' },
        { localId: 'skip', name: 'SkipBranch', prompt: 'Reply SHOULD_SKIP' },
        { localId: 'final', name: 'AlwaysFinal', prompt: 'Reply FINAL' },
      ],
      edges: [
        { from: 'setup', to: 'validate', type: 'on_success' },
        { from: 'validate', to: 'recovery', type: 'on_failure' },
        { from: 'validate', to: 'skip', type: 'on_success' },
        { from: 'recovery', to: 'final', type: 'on_completion' },
        { from: 'skip', to: 'final', type: 'on_completion' },
      ],
    });
    const runId = await seed.run(def);
    await startRun(runId);
    await waitForRunStatus(runId, ['completed', 'failed', 'cancelled'], 150_000);

    const s = await getStageStatuses(runId);
    expect(s['Setup']).toBe('completed');
    expect(s['ValidateFails']).toBe('failed'); // validation can never pass
    expect(s['Recovery']).toBe('completed'); // on_failure edge taken
    expect(s['SkipBranch']).toBe('skipped'); // on_success edge NOT taken
    expect(s['AlwaysFinal']).toBe('completed'); // on_completion always runs

    // UI shows the skipped + failed states.
    await gotoApp(`/workflows/${def}/runs/${runId}`);
    await expect(page.getByText('Completed', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('skipped', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('failed', { exact: false }).first()).toBeVisible();
  });
});
