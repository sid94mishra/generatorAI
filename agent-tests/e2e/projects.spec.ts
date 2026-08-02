import { test, expect } from '../helpers/test';

// Phase W4 — Projects list, create, detail tabs.

test.describe('Projects list', () => {
  test('renders header, search and New Project action', async ({ page, gotoApp }) => {
    await gotoApp('/projects');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Project/i }).first()).toBeVisible();
    await expect(page.getByPlaceholder(/Search/i).first()).toBeVisible();
  });

  test('seeded project appears in the list', async ({ page, gotoApp, seed }) => {
    const name = `W4 Project ${Date.now()}`;
    await seed.project({ name });
    await gotoApp('/projects');
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Create project', () => {
  test('Create is gated on a name, then creates and navigates to detail', async ({ page, gotoApp, tracker }) => {
    await gotoApp('/projects/new');
    await expect(page.getByRole('heading', { name: 'Create Project' })).toBeVisible();

    const create = page.getByRole('button', { name: 'Create Project', exact: true });
    await expect(create).toBeDisabled();

    const name = `W4 Created ${Date.now()}`;
    await page.getByPlaceholder(/E-Commerce Platform/i).fill(name);
    await expect(create).toBeEnabled();
    await create.click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const id = page.url().split('/projects/')[1]?.split(/[/?#]/)[0];
    if (id) tracker.track('project', id);
  });
});

test.describe('Project detail', () => {
  test('switches between Codebases, Project Customization and Settings tabs', async ({ page, gotoApp, seed }) => {
    const id = await seed.project({ name: `W4 Detail ${Date.now()}` });
    await gotoApp(`/projects/${id}`);

    for (const tab of ['Codebases', 'Project Customization', 'Settings']) {
      await page.getByRole('button', { name: tab, exact: true }).first().click();
      await page.waitForTimeout(200);
      await expect(page.getByRole('button', { name: tab, exact: true }).first()).toBeVisible();
    }
  });

  test('Codebases tab exposes a Link Codebase action', async ({ page, gotoApp, seed }) => {
    const id = await seed.project({ name: `W4 Codebases ${Date.now()}` });
    await gotoApp(`/projects/${id}`);
    await page.getByRole('button', { name: 'Codebases', exact: true }).first().click();
    await expect(page.getByRole('button', { name: /Link Codebase/i }).first()).toBeVisible({ timeout: 10_000 });
  });
});
