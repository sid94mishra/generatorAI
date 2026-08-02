import { test, expect } from '../helpers/test';

// Phase W1 — Settings, Dashboard, Templates.
// Authored from a playwright-cli exploration session (codegen + trace).
// Fully deterministic: no AI runs, no seeded data required.

test.describe('Settings', () => {
  test('switches between all four tabs', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    for (const tab of ['General', 'Provider', 'Copilot', 'Advanced']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      // Each tab keeps the tab bar; assert the clicked tab is present/active.
      await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
    }
  });

  test('General tab: theme toggle applies dark mode and persists', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    await page.getByRole('button', { name: 'General', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();

    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem('generatorai-theme'))).toBe('dark');

    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem('generatorai-theme'))).toBe('light');
  });

  test('Advanced tab shows server health info', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await expect(page.getByText(/Server Health|Database|Uptime|Sandbox/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Provider tab shows the active provider', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    await page.getByRole('button', { name: 'Provider', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI Provider' })).toBeVisible();
    await expect(page.getByText(/GitHub Copilot/i).first()).toBeVisible();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  });
});

test.describe('Dashboard', () => {
  test('renders header, quick actions and recent panels', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Chat/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Workflow/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Browse Workflows/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Chats' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Runs' })).toBeVisible();
  });

  test('quick action "New Workflow" navigates to the builder', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await page.getByRole('button', { name: /New Workflow/ }).click();
    await expect(page).toHaveURL(/\/workflows\/new/);
  });

  test('quick action "Browse Workflows" navigates to the list', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await page.getByRole('button', { name: /Browse Workflows/ }).click();
    await expect(page).toHaveURL(/\/workflows$/);
  });
});

test.describe('Templates', () => {
  test('lists templates with a search box and Use Template actions', async ({ page, gotoApp }) => {
    await gotoApp('/templates');
    await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible();
    await expect(page.getByPlaceholder(/Search templates/i)).toBeVisible();
    expect(await page.getByRole('button', { name: 'Use Template' }).count()).toBeGreaterThan(0);
  });

  test('search keeps matching templates visible', async ({ page, gotoApp }) => {
    await gotoApp('/templates');
    await page.getByPlaceholder(/Search templates/i).fill('Code Generation');
    await page.waitForTimeout(300); // debounce settle
    // The matching template stays visible and at least one card remains.
    await expect(page.getByRole('heading', { name: /Code Generation/i }).first()).toBeVisible();
    expect(await page.getByRole('button', { name: 'Use Template' }).count()).toBeGreaterThan(0);
  });

  test('Use Template creates a workflow and opens its detail page', async ({ page, gotoApp, tracker }) => {
    await gotoApp('/templates');
    await page.getByRole('button', { name: 'Use Template' }).first().click();
    // from-template creates a definition and navigates to its detail page.
    await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    // Track the created definition for cleanup.
    const id = page.url().split('/workflows/')[1];
    if (id) tracker.track('definition', id);
    await expect(page.getByTestId('rf__wrapper')).toBeVisible({ timeout: 10_000 });
  });
});
