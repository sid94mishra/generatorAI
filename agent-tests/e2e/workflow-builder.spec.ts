import { test, expect } from '../helpers/test';
import { apiRequest } from '../helpers/api';

// Phase W5 — Workflow Builder: stages, config, validation, save.
// Loading a seeded multi-stage+edge definition in edit mode avoids the
// timing-sensitive drag-to-connect interaction for edge coverage.

test.describe('Workflow Builder — authoring', () => {
  test('empty builder shows the core controls', async ({ page, gotoApp }) => {
    await gotoApp('/workflows/new');
    await expect(page.getByRole('textbox', { name: 'Untitled Workflow' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Validate' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add (First )?Stage/ }).first()).toBeVisible();
  });

  test('add a stage, name it, add a prompt', async ({ page, gotoApp }) => {
    await gotoApp('/workflows/new');
    await page.getByRole('button', { name: /Add (First )?Stage/ }).first().click();
    const nameInput = page.getByRole('textbox', { name: 'Stage Name' });
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill('Analyze');
    await page.getByRole('button', { name: 'Add Prompt' }).click();
    const promptBox = page.getByRole('textbox', { name: /Enter prompt text/ });
    await expect(promptBox).toBeVisible();
    await promptBox.fill('Analyze the input.');
    await expect(page.getByText('1 prompt').first()).toBeVisible();
  });

  test('run-condition dropdown offers all options incl. custom expression', async ({ page, gotoApp }) => {
    await gotoApp('/workflows/new');
    await page.getByRole('button', { name: /Add (First )?Stage/ }).first().click();
    await expect(page.getByRole('textbox', { name: 'Stage Name' })).toBeVisible();
    await page.getByRole('tab', { name: 'Execution' }).click();
    await page.getByRole('button', { name: 'Always run' }).click();
    await expect(page.getByRole('option', { name: 'On upstream success' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'On upstream failure' })).toBeVisible();
    await page.getByRole('option', { name: 'Custom expression' }).click();
    await expect(page.getByRole('textbox', { name: /stages\.build\.status/ })).toBeVisible();
  });

  test('retry policy expands and toggles on (collapsed section must be opened first)', async ({ page, gotoApp }) => {
    await gotoApp('/workflows/new');
    await page.getByRole('button', { name: /Add (First )?Stage/ }).first().click();
    await expect(page.getByRole('textbox', { name: 'Stage Name' })).toBeVisible();
    await page.getByRole('tab', { name: 'Execution' }).click();
    // Retry Policy section is collapsed by default — expand via its header.
    await page.getByRole('button', { name: /^Retry Policy/ }).first().click();
    await page.getByRole('switch', { name: 'Retry on failure' }).click();
    // Sub-controls appear once enabled.
    await expect(page.getByText('Max Retries')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Workflow Builder — validation', () => {
  test('Validate flags a stage with no prompts', async ({ page, gotoApp }) => {
    await gotoApp('/workflows/new');
    await page.getByRole('textbox', { name: 'Untitled Workflow' }).fill(`W5 NoPrompt ${Date.now()}`);
    await page.getByRole('button', { name: /Add (First )?Stage/ }).first().click();
    await expect(page.getByRole('textbox', { name: 'Stage Name' })).toBeVisible();
    await page.getByRole('button', { name: 'Validate' }).click();
    // Stale text: the builder's message became "has no prompts or agent
    // configured" when agent-mode stages landed
    // (workflowBuilderStore.ts) — the old /has no prompts configured/
    // matched nothing. Also assert the error summary, so a validator that
    // stops emitting the count regresses visibly.
    await expect(page.getByText('1 validation error')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/has no prompts or agent configured/i)).toBeVisible();
  });

  test('Validate flags an undefined {{variable}} reference (regression for the interpolation guard)', async ({ page, gotoApp }) => {
    await gotoApp('/workflows/new');
    await page.getByRole('textbox', { name: 'Untitled Workflow' }).fill(`W5 UndefVar ${Date.now()}`);
    await page.getByRole('button', { name: /Add (First )?Stage/ }).first().click();
    await expect(page.getByRole('textbox', { name: 'Stage Name' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Prompt' }).click();
    await page.getByRole('textbox', { name: /Enter prompt text/ }).fill('Use {{undefinedTopic}} here.');
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByText(/references undefined variable/i)).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Workflow Builder — save & load', () => {
  test('saving a valid single-stage workflow persists it', async ({ page, gotoApp, tracker }) => {
    await gotoApp('/workflows/new');
    const name = `W5 Save ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Untitled Workflow' }).fill(name);
    await page.getByRole('button', { name: /Add (First )?Stage/ }).first().click();
    await expect(page.getByRole('textbox', { name: 'Stage Name' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Stage Name' }).fill('Only');
    await page.getByRole('button', { name: 'Add Prompt' }).click();
    await page.getByRole('textbox', { name: /Enter prompt text/ }).fill('Reply OK.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}\/edit/, { timeout: 15_000 });
    const id = page.url().split('/workflows/')[1]?.split('/')[0];
    if (id) tracker.track('definition', id);
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
    // Edge label reflects the on_success type.
    await expect(page.getByText('Success', { exact: true }).first()).toBeVisible();
    // Sanity: the definition really has one edge server-side.
    const def = await apiRequest<{ edges: unknown[] }>('GET', `/workflow-definitions/${defId}`);
    expect(Array.isArray(def.data.edges) ? def.data.edges.length : 0).toBe(1);
  });
});
