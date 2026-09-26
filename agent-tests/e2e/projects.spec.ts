import { test, expect } from '../helpers/test';

// Phase W4 — Projects list, create, detail tabs. Rewritten for the P5 ports
// (features/projects: T-01 list, T-03 create, T-02 detail with path-segment
// tabs, R-3).

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
  // P5-04: tabs are path segments (R-3). A tab's accessible name may carry
  // its count ("Codebases 0"), hence the anchored regexes. Each tab has to
  // prove its own panel rendered, not only that it was selected.
  const PANELS: Array<{ tab: string; segment: string; assert: (page: import('@playwright/test').Page) => Promise<void> }> = [
    {
      tab: 'Codebases',
      segment: 'codebases',
      assert: async (page) => {
        await expect(page.getByText('Repositories are cloned under the project root.', { exact: false })).toBeVisible();
      },
    },
    {
      tab: 'Chats',
      segment: 'chats',
      assert: async (page) => {
        await expect(page.getByRole('tablist', { name: 'Chat status' })).toBeVisible();
      },
    },
    {
      tab: 'Runs',
      segment: 'runs',
      assert: async (page) => {
        await expect(page.getByText('No runs yet', { exact: true })).toBeVisible();
      },
    },
    {
      // A seeded project has no codebases, so the panel must settle on the
      // empty (or "unavailable") state rather than spin forever.
      tab: 'Pull requests',
      segment: 'pull-requests',
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
      tab: 'Customization',
      segment: 'customization',
      assert: async (page) => {
        await expect(page.getByRole('tablist', { name: 'Customization kind' }).getByRole('tab', { name: /^Skills/ })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Filter skills' })).toBeVisible();
      },
    },
    {
      tab: 'Settings',
      segment: 'settings',
      assert: async (page) => {
        await expect(page.getByRole('heading', { name: 'Worktrees', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible();
      },
    },
  ];

  test('switches between the six tabs, each addressed by its own path segment', async ({ page, gotoApp, seed }) => {
    const id = await seed.project({ name: `W4 Detail ${Date.now()}` });
    await gotoApp(`/projects/${id}`);

    const tablist = page.getByRole('tablist', { name: 'Project sections' });
    await expect(tablist.getByRole('tab')).toHaveText(PANELS.map((p) => new RegExp(`^${p.tab}`)));

    for (const { tab, segment, assert } of PANELS) {
      const t = tablist.getByRole('tab', { name: new RegExp(`^${tab}`) });
      await t.click();
      await expect(t).toHaveAttribute('aria-selected', 'true');
      await expect(page).toHaveURL(new RegExp(`/projects/${id}/${segment}$`));
      await assert(page);
    }

    // A deep link lands on its tab.
    await gotoApp(`/projects/${id}/settings`);
    await expect(tablist.getByRole('tab', { name: /^Settings/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('Codebases tab: Add codebase opens the inline form, gated until valid', async ({ page, gotoApp, seed }) => {
    const id = await seed.project({ name: `W4 Codebases ${Date.now()}` });
    await gotoApp(`/projects/${id}/codebases`);

    await page.getByRole('button', { name: 'Add codebase', exact: true }).first().click();
    const card = page.getByTestId('add-codebase-card');
    await expect(card).toBeVisible();
    const submit = card.getByRole('button', { name: 'Add codebase', exact: true });
    await expect(submit).toBeDisabled();
    await card.getByRole('textbox', { name: 'Alias' }).fill('frontend');
    await card.getByRole('textbox', { name: 'Repository URL' }).fill('https://github.com/org/repo.git');
    await expect(submit).toBeEnabled();
  });
});
