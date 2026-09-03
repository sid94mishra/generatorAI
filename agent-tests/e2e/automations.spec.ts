import { test, expect } from '../helpers/test';
import { findAutomationIdByName, apiRequest } from '../helpers/api';

// Phase W3 — Automations list + create form (triggers × input modes).

test.describe('Automations list', () => {
  test('renders header and New Automation action', async ({ page, gotoApp }) => {
    await gotoApp('/automations');
    await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Automation/i })).toBeVisible();
  });

  test('seeded automation appears in the list', async ({ page, gotoApp, seed }) => {
    const wf = await seed.workflow({ name: `W3 WF ${Date.now()}`, stages: [{ localId: 's', name: 'S', prompt: 'ok' }] });
    const name = `W3 Auto ${Date.now()}`;
    await seed.automation({ name, workflowIds: [wf] });
    await gotoApp('/automations');
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Create automation form', () => {
  test('shows all three trigger types', async ({ page, gotoApp }) => {
    await gotoApp('/automations/new');
    await expect(page.getByRole('heading', { name: 'Create Automation' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Manual/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Schedule/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Webhook/ })).toBeVisible();
  });

  test('Schedule trigger reveals a cron field', async ({ page, gotoApp }) => {
    await gotoApp('/automations/new');
    await page.getByRole('button', { name: /Schedule Run on a cron/i }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Cron Expression/i)).toBeVisible();
  });

  test('exposes all four input modes', async ({ page, gotoApp }) => {
    await gotoApp('/automations/new');
    for (const mode of ['Single', 'Loop', 'Batch', 'Script']) {
      await expect(page.getByText(mode, { exact: true }).first()).toBeVisible();
    }
  });

  test('submitting an empty form does not create an automation', async ({ page, gotoApp }) => {
    await gotoApp('/automations/new');
    await page.getByRole('button', { name: /Create Automation/i }).click();
    await page.waitForTimeout(500);
    // Required name + workflow are missing → must stay on the form, not navigate away.
    await expect(page).toHaveURL(/\/automations\/new/);
  });

  test('creates a manual automation end-to-end', async ({ page, gotoApp, seed, tracker }) => {
    const wfName = `W3 Create WF ${Date.now()}`;
    await seed.workflow({ name: wfName, stages: [{ localId: 's', name: 'S', prompt: 'ok' }] });
    const name = `W3 Created ${Date.now()}`;

    await gotoApp('/automations/new');
    await page.getByRole('textbox', { name: /My Automation/i }).fill(name);

    // Manual is the default trigger. The workflow picker is NOT a `<select>`:
    // it is an "+ Add a workflow…" button that opens a `role="listbox"`. This
    // test previously drove `page.locator('select').nth(1)` with
    // `selectOption({label: RegExp})` — a `<select>` that is not the workflow
    // picker, and an option shape `selectOption` does not accept (label must
    // be a string). Both failures were swallowed by a `.catch()`, so the form
    // submitted with nothing selected and failed its own "Select at least one
    // workflow" validation.
    await page.getByRole('button', { name: /Add a workflow/i }).click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await listbox.getByRole('option', { name: new RegExp(wfName) }).first().click();
    // The picker must actually have registered the choice before we submit.
    await expect(page.getByText(/Select at least one workflow/i)).toBeHidden();

    await page.getByRole('button', { name: /Create Automation/i }).click();
    // On success the app leaves the create form (to list or detail).
    await expect(page).not.toHaveURL(/\/automations\/new/, { timeout: 15_000 });

    // Verify server-side and clean up.
    const id = await findAutomationIdByName(name);
    expect(id, 'automation should exist server-side after create').toBeTruthy();
    if (id) {
      tracker.track('automation', id);
      await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    }
  });
});
