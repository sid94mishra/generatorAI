import { test, expect } from '../helpers/test';
import { waitForRunStatus, getStageStatuses } from '../helpers/api';

// Phase W6 — Workflow Run: controls, live execution, streaming render,
// and conditional edge routing. Runs really execute (trivial prompts keep
// them fast); assertions are on STATUS + STRUCTURE, never generated text,
// so they are deterministic.

const IMPOSSIBLE = 'IMPOSSIBLE_MARKER_QZX_9183';

// A run starts when it is invoked (`seed.run` is POST /workflow-invocations):
// there is no created-but-not-started run to render or start by hand.

test.describe('Run lifecycle + streaming render', () => {
  test('a two-stage run completes and renders messages', async ({ page, gotoApp, seed }) => {
    // ~40s per live agent stage, so two stages plus UI assertions need more
    // headroom than the previous 180s left.
    test.setTimeout(300_000);
    const def = await seed.workflow({
      name: `W6 Lifecycle ${Date.now()}`,
      stages: [
        { localId: 'a', name: 'First', prompt: 'Reply with the word DONE.' },
        { localId: 'b', name: 'Second', prompt: 'Reply with the word DONE.' },
      ],
      edges: [{ from: 'a', to: 'b', type: 'on_success' }],
    });
    const runId = await seed.run(def);
    const status = await waitForRunStatus(runId, ['completed', 'failed', 'cancelled'], 240_000);
    expect(status).toBe('completed');

    const stages = await getStageStatuses(runId);
    expect(stages['First']).toBe('completed');
    expect(stages['Second']).toBe('completed');

    // UI reflects the persisted/completed run on load (resumability/replay).
    // The run header's D-18 badge says "Succeeded" for a completed run (PW-c).
    await gotoApp(`/workflows/${def}/runs/${runId}`);
    await expect(page.getByTestId('run-status-badge')).toHaveText(/Succeeded/, { timeout: 15_000 });
    await expect(page.getByText('First', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Second', { exact: true }).first()).toBeVisible();

    // Expand the first stage and confirm the prompt replays, and that the
    // stage's output is reachable. A stage-table row's disclosure button is
    // named "<stage>, <status>" (StageRow); its expanded body is the "Stage
    // prompt", the stage transcript, then a chips row whose "Details" button
    // opens the dock's Inspector tab (tabs: Output / Files / Tools / Hooks /
    // Events / History).
    await page.getByRole('button', { name: /^First, / }).click();
    await expect(page.getByText('Stage prompt', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Reply with the word DONE.', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Details', exact: true }).first().click();
    await expect(page.getByRole('tab', { name: 'Inspector' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'Output' })).toBeVisible();
    // Note: a cleanly-completed run shows no Retry control (Retry is for
    // failed/cancelled runs) — verified separately, not asserted here.
  });
});

test.describe('Conditional edge routing', () => {
  test('validation failure routes on_failure, skips on_success, always runs on always', async ({ page, gotoApp, seed }) => {
    // Budget, not staleness: this runs FOUR real agent stages plus a
    // validation retry against the live harness. Measured stage latency in
    // the two-stage test above is ~40s each, so the old 150s wait could not
    // physically pass — it timed out at `last=running` with the run still
    // progressing normally. Raised to fit a real execution.
    test.setTimeout(600_000);
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
        // `always`: a skipped source satisfies it too (a completion edge from a
        // skipped stage is dead, and a dead predecessor skips an all-join).
        { from: 'recovery', to: 'final', type: 'always' },
        { from: 'skip', to: 'final', type: 'always' },
      ],
    });
    const runId = await seed.run(def);
    await waitForRunStatus(runId, ['completed', 'failed', 'cancelled'], 480_000);

    const s = await getStageStatuses(runId);
    expect(s['Setup']).toBe('completed');
    expect(s['ValidateFails']).toBe('failed'); // validation can never pass
    expect(s['Recovery']).toBe('completed'); // on_failure edge taken
    expect(s['SkipBranch']).toBe('skipped'); // on_success edge NOT taken
    expect(s['AlwaysFinal']).toBe('completed'); // always edges fire on any terminal state

    // UI shows the skipped + failed states.
    await gotoApp(`/workflows/${def}/runs/${runId}`);
    await expect(page.getByTestId('run-status-badge')).toHaveText(/Succeeded/, { timeout: 15_000 });
    await expect(page.getByText('skipped', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('failed', { exact: false }).first()).toBeVisible();
  });
});
