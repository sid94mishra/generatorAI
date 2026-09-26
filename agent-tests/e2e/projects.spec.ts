import { test, expect } from '../helpers/test';

// Phase W4 — Projects list, create, detail tabs.

test.describe('Projects list', () => {
  // P5-02: the kit ListPage — PageTitle h1 "Projects", "New project",
  // SearchInput "Search projects", Active/Archived scope tabs.
  test('renders header, search, scope and the New project action', async ({ page, gotoApp }) => {
    await gotoApp('/projects');
    await expect(page.getByRole('heading', { name: 'Projects', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search projects' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Active/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('seeded project appears in the table and opens its detail page', async ({ page, gotoApp, seed }) => {
    const name = `W4 Project ${Date.now()}`;
    const id = await seed.project({ name });
    await gotoApp('/projects');
    const table = page.getByRole('table', { name: 'Projects' });
    await table.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${id}`));
  });
});

test.describe('Create project', () => {
  // P5-03: T-03 FormWithAside — h1 "New project", Name field, ActionBar
  // primary "Create project" (gated on a name).
  test('Create is gated on a name, then creates and navigates to detail', async ({ page, gotoApp, tracker }) => {
    await gotoApp('/projects/new');
    await expect(page.getByRole('heading', { name: 'New project', level: 1 })).toBeVisible();

    const create = page.getByRole('button', { name: 'Create project', exact: true });
    await expect(create).toBeDisabled();

    const name = `W4 Created ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await expect(create).toBeEnabled();
    await create.click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const id = page.url().split('/projects/')[1]?.split(/[/?#]/)[0];
    if (id) tracker.track('project', id);
  });
});

test.describe('Project detail', () => {
  // The tab strip is a real <Tabs> widget: role=tablist / role=tab with
  // aria-selected — not the buttons this spec used to look for, which is why
  // every click here timed out. It also used to "assert" only that the tab it
  // had just clicked was still visible, which is true whether or not the tab
  // did anything; each tab now has to prove its own panel rendered.
  const PANELS: Array<{ tab: string; assert: (page: import('@playwright/test').Page) => Promise<void> }> = [
    {
      tab: 'Codebases',
      assert: async (page) => {
        await expect(page.getByRole('heading', { name: 'Linked Repositories', exact: true })).toBeVisible();
      },
    },
    {
      tab: 'Project Customization',
      assert: async (page) => {
        await expect(page.getByPlaceholder('Search skills…')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Custom Agents', exact: true })).toBeVisible();
      },
    },
    {
      // Added with the SCM work (ProjectDetailPage → ProjectPullRequestsTab).
      // A seeded project has no codebases, so the panel must render its
      // Open/Closed/All filter and settle on the empty (or "unavailable")
      // state rather than spin forever.
      tab: 'Pull requests',
      assert: async (page) => {
        const panel = page.getByTestId('project-pull-requests');
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('tab', { name: 'Open', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(panel.getByTestId('pr-empty').or(panel.getByTestId('pr-unavailable'))).toBeVisible({
          timeout: 15_000,
        });
      },
    },
    {
      tab: 'Settings',
      assert: async (page) => {
        await expect(page.getByRole('heading', { name: 'Project Settings', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save Settings', exact: true })).toBeVisible();
      },
    },
  ];

  test('switches between Codebases, Project Customization, Pull requests and Settings tabs', async ({ page, gotoApp, seed }) => {
    const id = await seed.project({ name: `W4 Detail ${Date.now()}` });
    await gotoApp(`/projects/${id}`);

    // The Pull requests panel renders its own (nested) state tablist, so pin
    // the page-level one by its first tab.
    const tablist = page
      .getByRole('tablist')
      .filter({ has: page.getByRole('tab', { name: 'Codebases', exact: true }) });
    await expect(tablist.getByRole('tab')).toHaveText(PANELS.map((p) => p.tab));

    for (const { tab, assert } of PANELS) {
      const t = tablist.getByRole('tab', { name: tab, exact: true });
      await t.click();
      await expect(t).toHaveAttribute('aria-selected', 'true');
      await assert(page);
    }
  });

  // Feature present but RENAMED: there is no "Link Codebase" control anywhere
  // in the shipped app — the Codebases tab exposes "Add Repository", which
  // reveals the inline link-a-codebase form (alias / type / URL). Retargeted
  // rather than deleted, and strengthened to open the form so the assertion
  // covers the action rather than only the button's existence.
  test('Codebases tab exposes an Add Repository action that opens the link form', async ({ page, gotoApp, seed }) => {
    const id = await seed.project({ name: `W4 Codebases ${Date.now()}` });
    await gotoApp(`/projects/${id}`);
    await page.getByRole('tab', { name: 'Codebases', exact: true }).click();

    // Only one "Add Repository" button exists until the form opens — after it
    // opens the form's own submit button shares the label, hence .first().
    const addRepo = page.getByRole('button', { name: 'Add Repository', exact: true });
    await expect(addRepo).toHaveCount(1);
    await addRepo.click();

    await expect(page.getByRole('heading', { name: 'Add New Repository', exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('frontend')).toBeVisible();
    await expect(page.getByPlaceholder('https://github.com/org/repo.git')).toBeVisible();
    // Submit is gated until the form is valid.
    await expect(page.getByRole('button', { name: 'Add Repository', exact: true }).last()).toBeDisabled();
  });
});
