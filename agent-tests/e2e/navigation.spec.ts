import { test, expect } from '../helpers/test';

// Deterministic navigation smoke across every primary page.
// Uses semantic role selectors (stable) — no seeded data required.
//
// ── Reconciled against the shipped shell (see Sidebar.tsx / Header.tsx) ──
// The spec used to walk eight entries including a 'Templates' one, and to
// expect a heading matching /Dashboard/ on `/` and /Workflow Scripts/ on
// `/scripts`. None of that shipped:
//   • The sidebar <nav> contains exactly seven routed entries. There is no
//     'Templates' nav item and no /templates route (it 404s) — templates are
//     a tab inside the Settings modal, covered by
//     settings-dashboard-templates.spec.ts.
//   • 'Settings' sits in the aside *outside* the <nav> and calls
//     openSettings() — it opens a modal and never changes the URL, so it
//     cannot belong to a URL walk. It gets its own test below.
//   • Page titles are the <h1> inside <main>. The header renders a
//     plain-text breadcrumb <span>, not a heading, so there is nothing in
//     the banner to assert against on a routed page.
const PAGES: Array<{ nav: string; urlRe: RegExp; heading: string }> = [
  { nav: 'Dashboard', urlRe: /\/$/, heading: 'Mission Control' },
  { nav: 'Projects', urlRe: /\/projects$/, heading: 'Manage Projects' },
  { nav: 'Chats', urlRe: /\/chats$/, heading: 'Chats' },
  { nav: 'Agents', urlRe: /\/agents$/, heading: 'Agents' },
  { nav: 'Workflows', urlRe: /\/workflows$/, heading: 'Workflows' },
  { nav: 'Scripts', urlRe: /\/scripts$/, heading: 'Scripts' },
  { nav: 'Automations', urlRe: /\/automations$/, heading: 'Automations' },
];

test.describe('Navigation & layout', () => {
  test('sidebar navigates to every primary page', async ({ page, gotoApp }) => {
    await gotoApp('/');
    // The <nav> is nested inside the sidebar <aside>, so scope through the
    // complementary landmark rather than relying on there being exactly one
    // navigation region on every page.
    const nav = page.getByRole('complementary').getByRole('navigation');
    await expect(nav).toBeVisible();

    // The nav roster itself is the contract: a route silently dropped from
    // the sidebar would otherwise still pass the per-page walk below via
    // direct URL entry.
    await expect(nav.getByRole('button')).toHaveText(PAGES.map((p) => p.nav));

    for (const p of PAGES) {
      await nav.getByRole('button', { name: p.nav, exact: true }).click();
      await expect(page).toHaveURL(p.urlRe);
      await expect(
        page.getByRole('main').getByRole('heading', { name: p.heading, exact: true, level: 1 }),
      ).toBeVisible();
    }
  });

  // Retargeted from the old PAGES entry: 'Settings' is a modal surface, not a
  // route. Asserting it against /\/settings/ was asserting a URL the app has
  // not produced since SettingsRoute became a redirect.
  test('Settings opens the settings modal without leaving the page', async ({ page, gotoApp }) => {
    await gotoApp('/chats');
    const aside = page.getByRole('complementary');
    // It is deliberately outside the routed <nav>.
    await expect(
      aside.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }),
    ).toHaveCount(0);

    await aside.getByRole('button', { name: 'Settings', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Two elements carry the name "Settings" (Radix's sr-only dialog title and
    // the visible banner heading), so pin the visible one.
    await expect(dialog.getByRole('banner').getByRole('heading', { name: 'Settings' })).toBeVisible();
    // A modal, not a navigation: the underlying route is untouched.
    await expect(page).toHaveURL(/\/chats$/);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/chats$/);
  });

  // The affordance is labelled 'Hide sidebar' (not 'Collapse sidebar'), and
  // collapsing swaps it for a *different* button in the header
  // ('Show sidebar'). The old assertion — "some button matching /sidebar/i is
  // still visible" — passed trivially because the sidebar's own toggle stays
  // in the DOM behind the collapsed pane, so it never proved the sidebar
  // actually collapsed or could be brought back.
  test('sidebar collapses and expands', async ({ page, gotoApp }) => {
    await gotoApp('/');
    const aside = page.locator('aside').first();
    const width = () => aside.evaluate((el) => el.getBoundingClientRect().width);

    expect(await width()).toBeGreaterThan(100);
    await expect(page.getByTestId('header-toggle-sidebar')).toHaveCount(0);

    // ── Collapse ──
    const collapse = page.getByTestId('sidebar-toggle');
    await expect(collapse).toHaveAttribute('aria-label', 'Hide sidebar');
    await collapse.click();

    await expect
      .poll(width, { message: 'sidebar should collapse to a sliver' })
      .toBeLessThan(20);
    // The expand affordance only exists while collapsed.
    const expand = page.getByTestId('header-toggle-sidebar');
    await expect(expand).toBeVisible();
    await expect(expand).toHaveAttribute('aria-label', 'Show sidebar');

    // ── Expand again ──
    await expand.click();
    await expect.poll(width, { message: 'sidebar should reopen' }).toBeGreaterThan(100);
    await expect(page.getByTestId('header-toggle-sidebar')).toHaveCount(0);
    await expect(
      page.getByRole('complementary').getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }),
    ).toBeVisible();
  });
});
