import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/test';
import { apiRequest, type ResourceTracker } from '../helpers/api';

// Phase W5 — Workflow Builder: stages, config, validation, save.
// Loading a seeded multi-stage+edge definition in edit mode avoids the
// timing-sensitive drag-to-connect interaction for edge coverage.
//
// PW-b: the builder is on the kit (features/workflows/builder). The stage
// inspector is the `complementary` "Stage inspector" with tabs Prompt ·
// Session · Tools · Output · Policy · Hooks (a tab's name carries its count,
// so tabs are matched by prefix); validation problems are the "Problems"
// region under the canvas.

/**
 * `/workflows/new` is the New workflow page (PW-a): a blank start creates an
 * empty draft and opens it in the builder, which is where these tests begin.
 */
async function openBlankBuilder(page: Page, gotoApp: (path: string) => Promise<void>, tracker: ResourceTracker) {
  await gotoApp('/workflows/new');
  await page.getByRole('radio', { name: /Blank canvas/ }).check();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`W5 Blank ${Date.now()}`);
  await page.getByRole('button', { name: /Create draft and open builder/ }).click();
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}\/edit/, { timeout: 15_000 });
  const id = page.url().split('/workflows/')[1]?.split('/')[0];
  if (id) tracker.track('definition', id);
}

const stageInspector = (page: Page) => page.getByRole('complementary', { name: 'Stage inspector' });

/** Add an agent stage (the Add stage button's main part) and wait for its inspector. */
async function addAgentStage(page: Page) {
  await page.getByRole('button', { name: /Add (first )?stage/i }).first().click();
  await expect(stageInspector(page).getByRole('textbox', { name: 'Name', exact: true })).toBeVisible({ timeout: 10_000 });
}

test.describe('Workflow Builder — authoring', () => {
  test('empty builder shows the core controls', async ({ page, gotoApp, tracker }) => {
    await openBlankBuilder(page, gotoApp, tracker);
    await expect(page.getByRole('textbox', { name: 'Workflow name' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Validate/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add (first )?stage/i }).first()).toBeVisible();
  });

  test('add a stage, name it, add a prompt', async ({ page, gotoApp, tracker }) => {
    await openBlankBuilder(page, gotoApp, tracker);
    await addAgentStage(page);
    await stageInspector(page).getByRole('textbox', { name: 'Name', exact: true }).fill('Analyze');
    await page.getByRole('button', { name: 'Add prompt' }).click();
    const promptBox = page.getByRole('textbox', { name: 'Prompt 1 text' });
    await expect(promptBox).toBeVisible();
    await promptBox.fill('Analyze the input.');
    await expect(page.getByText('1 prompt').first()).toBeVisible();
  });

  test('a guard expression is parsed as it is typed (Policy tab)', async ({ page, gotoApp, tracker }) => {
    await openBlankBuilder(page, gotoApp, tracker);
    await addAgentStage(page);
    await stageInspector(page).getByRole('tab', { name: /^Policy/ }).click();
    const guard = page.getByRole('textbox', { name: 'Guard expression' });
    await expect(guard).toBeVisible();
    await guard.fill('1 == 1');
    await expect(stageInspector(page).getByText('Parses', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('retry policy toggles on and shows its fields (Policy tab)', async ({ page, gotoApp, tracker }) => {
    await openBlankBuilder(page, gotoApp, tracker);
    await addAgentStage(page);
    await stageInspector(page).getByRole('tab', { name: /^Policy/ }).click();
    await page.getByRole('switch', { name: 'Retry on failure' }).click();
    await expect(page.getByRole('textbox', { name: 'Max attempts (including the first)' })).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Workflow Builder — validation', () => {
  test('Validate flags a stage with no prompts', async ({ page, gotoApp, tracker }) => {
    await openBlankBuilder(page, gotoApp, tracker);
    await addAgentStage(page);
    await page.getByRole('button', { name: /^Validate/ }).click();
    const problems = page.getByRole('region', { name: 'Problems' });
    await expect(problems).toBeVisible({ timeout: 5_000 });
    await expect(problems.getByText(/has no prompts and no agent/i)).toBeVisible();
  });

  test('Validate flags an undefined {{variable}} reference, and Declare fixes it', async ({ page, gotoApp, tracker }) => {
    await openBlankBuilder(page, gotoApp, tracker);
    await addAgentStage(page);
    await page.getByRole('button', { name: 'Add prompt' }).click();
    await page.getByRole('textbox', { name: 'Prompt 1 text' }).fill('Use {{undefinedTopic}} here.');
    await page.getByRole('button', { name: /^Validate/ }).click();
    const problems = page.getByRole('region', { name: 'Problems' });
    await expect(problems.getByText(/'undefinedTopic' is not a declared variable/i)).toBeVisible({ timeout: 5_000 });
    await problems.getByRole('button', { name: /Declare/ }).click();
    await expect(problems.getByText(/'undefinedTopic' is not a declared variable/i)).toHaveCount(0, { timeout: 5_000 });
  });
});

test.describe('Workflow Builder — save & load', () => {
  test('saving a valid single-stage workflow persists it', async ({ page, gotoApp, tracker }) => {
    await openBlankBuilder(page, gotoApp, tracker);
    const name = `W5 Save ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Workflow name' }).fill(name);
    await addAgentStage(page);
    await stageInspector(page).getByRole('textbox', { name: 'Name', exact: true }).fill('Only');
    await page.getByRole('button', { name: 'Add prompt' }).click();
    await page.getByRole('textbox', { name: 'Prompt 1 text' }).fill('Reply OK.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 15_000 });
    const id = page.url().split('/workflows/')[1]?.split('/')[0];
    const def = await apiRequest<{ graph: { workflow: { name: string }; stages: unknown[] } }>('GET', `/workflow-definitions/${id}`);
    expect(def.data.graph.workflow.name).toBe(name);
    expect(def.data.graph.stages).toHaveLength(1);
  });

  test('loads a seeded multi-stage DAG (stages + edges render)', async ({ page, gotoApp, seed }) => {
    const name = `W5 Load ${Date.now()}`;
    const defId = await seed.workflow({
      name,
      stages: [
        { localId: 'a', name: 'Build', prompt: 'build' },
        { localId: 'b', name: 'Test', prompt: 'test' },
      ],
      edges: [{ from: 'a', to: 'b', type: 'on_success' }],
    });
    await gotoApp(`/workflows/${defId}/edit`);
    await expect(page.getByTestId('rf__wrapper')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Build', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Test', { exact: true }).first()).toBeVisible();
    // One success edge on the canvas; the legend names its kind.
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect(page.getByText('On success', { exact: true }).first()).toBeVisible();
    // Sanity: the definition really has one edge server-side.
    const def = await apiRequest<{ graph: { edges: unknown[] } }>('GET', `/workflow-definitions/${defId}`);
    expect(def.data.graph.edges).toHaveLength(1);
  });
});
