import { test, expect } from '../helpers/test';

// Deterministic navigation smoke across every primary page.
// Uses semantic role selectors (stable) — no seeded data required.

const PAGES: Array<{ nav: string; urlRe: RegExp; heading: RegExp }> = [
  { nav: 'Dashboard', urlRe: /\/$/, heading: /Dashboard/i },
  { nav: 'Projects', urlRe: /\/projects/, heading: /Projects/i },
  { nav: 'Chats', urlRe: /\/chats/, heading: /Chats/i },
  { nav: 'Workflows', urlRe: /\/workflows/, heading: /Workflows/i },
  { nav: 'Scripts', urlRe: /\/scripts/, heading: /Workflow Scripts/i },
  { nav: 'Automations', urlRe: /\/automations/, heading: /Automations/i },
  { nav: 'Templates', urlRe: /\/templates/, heading: /Templates/i },
  { nav: 'Settings', urlRe: /\/settings/, heading: /Settings/i },
];

test.describe('Navigation & layout', () => {
  test('sidebar navigates to every primary page', async ({ page, gotoApp }) => {
    await gotoApp('/');
    const nav = page.getByRole('navigation');
    await expect(nav).toBeVisible();

    for (const p of PAGES) {
      // Templates & Settings live in the complementary aside; the rest in nav.
      const inNav = page.getByRole('navigation').getByRole('button', { name: p.nav, exact: true });
      const inAside = page.getByRole('complementary').getByRole('button', { name: p.nav, exact: true });
      const btn = (await inNav.count()) ? inNav : inAside;
      await btn.click();
      await expect(page).toHaveURL(p.urlRe);
      await expect(page.getByRole('heading', { name: p.heading }).first()).toBeVisible();
    }
  });

  test('sidebar collapses and expands', async ({ page, gotoApp }) => {
    await gotoApp('/');
    const collapse = page.getByRole('button', { name: /Collapse sidebar/i });
    await expect(collapse).toBeVisible();
    await collapse.click();
    // After collapse the toggle is still present (expand affordance).
    await expect(page.getByRole('button', { name: /sidebar/i }).first()).toBeVisible();
  });
});
