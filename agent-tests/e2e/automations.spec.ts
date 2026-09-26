import { test, expect } from '../helpers/test';
import { findAutomationIdByName, apiRequest } from '../helpers/api';

// Phase W3 — Automations list + create form (triggers × input modes).
//
// PW-d (redesign port, 2026-09-27): AutomationsPage/CreateAutomationPage
// moved from `pages/` onto the kit (`features/automations/`) — T-01
// ListPage and an L-02 Wizard (C-17 Stepper) with 4 steps (Basics, Trigger,
// Workflow & permission, Advanced & review) replacing the single long-scroll
// form. Selector renames below:
//   - "New Automation" (title case) → "New automation" (sentence case, F-chats-01 convention)
//   - the trigger picker is a `RadioGroup` of `RadioCard`s (`role="radio"`), not `role="button"`
//   - the trigger/workflow/dataset fields are now split across wizard steps behind "Continue"
//   - the legacy checkbox-gated iteration-mode picker (each_row/group_by/single) is now an
//     always-visible 4-option "Input mode" `ChoiceCardGrid` on the last step: Single run / Each
//     row / Grouped rows / Whole dataset (real labels grounded in the API's dataSchema +
//     iterationMode, replacing this test's old placeholder expectation of "Loop"/"Batch"/"Script",
//     which matched no real automation concept)
//   - "Add a workflow" combobox + "Name *" textbox are unchanged (same kit Select/Field as before)

async function goToStep(page: import('@playwright/test').Page, steps: number) {
  for (let i = 0; i < steps; i++) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
}

test.describe('Automations list', () => {
  test('renders header and New automation action', async ({ page, gotoApp }) => {
    await gotoApp('/automations');
    // Exact + level: on an empty DB the list's empty state adds an h3
    // "No automations yet", which a substring match also hits.
    await expect(page.getByRole('heading', { name: 'Automations', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New automation', exact: true })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Basics', exact: true, level: 2 })).toBeVisible();
    await goToStep(page, 1); // Basics → Trigger
    await expect(page.getByRole('radio', { name: /Manual/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Schedule/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Webhook/ })).toBeVisible();
  });

  test('Schedule trigger reveals a cron field', async ({ page, gotoApp }) => {
    await gotoApp('/automations/new');
    await goToStep(page, 1); // Basics → Trigger
    await page.getByRole('radio', { name: /Schedule/ }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Cron expression/i)).toBeVisible();
  });

  test('exposes the four input-mode choices in the review step', async ({ page, gotoApp }) => {
    await gotoApp('/automations/new');
    await goToStep(page, 3); // Basics → Trigger → Workflow → Advanced & review
    for (const mode of ['Single run', 'Each row', 'Grouped rows', 'Whole dataset']) {
      await expect(page.getByText(mode, { exact: true }).first()).toBeVisible();
    }
  });

  test('submitting an empty form does not create an automation', async ({ page, gotoApp }) => {
    await gotoApp('/automations/new');
    await goToStep(page, 3); // reach the review step, where "Create automation" renders
    await page.getByRole('button', { name: /Create automation/i }).click();
    await page.waitForTimeout(500);
    // Required name + workflow are missing → must stay on the form, not navigate away.
    await expect(page).toHaveURL(/\/automations\/new/);
  });

  test('creates a manual automation end-to-end', async ({ page, gotoApp, seed, tracker }) => {
    const wfName = `W3 Create WF ${Date.now()}`;
    await seed.workflow({ name: wfName, stages: [{ localId: 's', name: 'S', prompt: 'ok' }] });
    const name = `W3 Created ${Date.now()}`;

    await gotoApp('/automations/new');
    // The name input is labelled ("Name *"); "Nightly audit" is only its
    // placeholder, which is not part of the accessible name.
    await page.getByRole('textbox', { name: 'Name *', exact: true }).fill(name);
    await goToStep(page, 2); // Basics → Trigger (Manual, the default) → Workflow

    // The workflow picker is NOT a `<select>`: it is the kit's Base UI
    // Select — a `combobox` named "Add a workflow" that opens a
    // `role="listbox"` of `role="option"`s.
    await page.getByRole('combobox', { name: 'Add a workflow', exact: true }).click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await listbox.getByRole('option', { name: new RegExp(wfName) }).first().click();

    await goToStep(page, 1); // Workflow → Advanced & review
    await page.getByRole('button', { name: /Create automation/i }).click();
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
