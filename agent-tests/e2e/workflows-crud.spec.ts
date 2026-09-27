import { test, expect } from '../helpers/test';
import { apiRequest } from '../helpers/api';

// Workflow list/CRUD using API-seeded data (deterministic — no AI runs).

test.describe('Workflows page (CRUD over seeded data)', () => {
  test('seeded workflow appears in the list and is searchable', async ({ page, gotoApp, seed }) => {
    const unique = `E2E List WF ${Date.now()}`;
    await seed.workflow({
      name: unique,
      stages: [{ localId: 's1', name: 'Analyze', prompt: 'Reply OK' }],
    });

    await gotoApp('/workflows');
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();

    // The seeded definition should render somewhere in the user list.
    await expect(page.getByText(unique, { exact: false }).first()).toBeVisible({ timeout: 10_000 });

    // Search narrows to it.
    const search = page.getByPlaceholder(/Search workflows/i);
    await search.fill(unique);
    await page.waitForTimeout(300); // debounce settle
    await expect(page.getByText(unique, { exact: false }).first()).toBeVisible();
  });

  test('open a seeded workflow detail and see its stages', async ({ page, gotoApp, seed }) => {
    const unique = `E2E Detail WF ${Date.now()}`;
    const defId = await seed.workflow({
      name: unique,
      stages: [
        { localId: 'a', name: 'First', prompt: 'Reply A' },
        { localId: 'b', name: 'Second', prompt: 'Reply B' },
      ],
      edges: [{ from: 'a', to: 'b', type: 'on_success' }],
    });

    await gotoApp(`/workflows/${defId}`);
    await expect(page.getByRole('heading', { name: unique })).toBeVisible({ timeout: 10_000 });
    // The Stages card lists the working graph (it replaced the read-only DAG canvas).
    const stages = page.getByTestId('workflow-stages');
    await expect(stages).toBeVisible({ timeout: 10_000 });
    await expect(stages.getByText('First', { exact: true })).toBeVisible();
    await expect(stages.getByText('Second', { exact: true })).toBeVisible();
  });

  test('create-from-template button list is present', async ({ page, gotoApp }) => {
    await gotoApp('/workflows');
    // The page exposes the primary creation affordances (PW-a names: "New workflow",
    // "Import JSON"; the sample document moved into the header's More menu).
    await expect(page.getByRole('button', { name: 'New workflow', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import JSON', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'More workflow actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Download sample JSON' })).toBeVisible();
  });

  test('deleting a seeded workflow via API removes it from the list', async ({ page, gotoApp, seed }) => {
    const unique = `E2E Delete WF ${Date.now()}`;
    const defId = await seed.workflow({
      name: unique,
      stages: [{ localId: 's1', name: 'Only', prompt: 'Reply OK' }],
    });

    await gotoApp('/workflows');
    await expect(page.getByText(unique, { exact: false }).first()).toBeVisible({ timeout: 10_000 });

    const del = await apiRequest('DELETE', `/workflow-definitions/${defId}`);
    expect(del.ok).toBeTruthy();

    await page.reload();
    await page.waitForLoadState('load');
    await expect(page.getByText(unique, { exact: false })).toHaveCount(0, { timeout: 10_000 });
  });
});
