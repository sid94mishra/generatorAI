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
//     openSettings(), which navigates to the routed Settings page
//     (`/settings/<section>`, SettingsPage.tsx). It gets its own test below.
//   • The nav entries are React Router <Link>s (role=link with
//     aria-current="page"), not buttons.
//   • Page titles are the <h1> inside <main>. The header renders a
//     plain-text breadcrumb <span>, not a heading, so there is nothing in
//     the banner to assert against on a routed page.
const PAGES: Array<{ nav: string; urlRe: RegExp; heading: string }> = [
  { nav: 'Dashboard', urlRe: /\/$/, heading: 'Mission Control' },
  { nav: 'Projects', urlRe: /\/projects$/, heading: 'Projects' },
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
    await expect(nav.getByRole('link')).toHaveText(PAGES.map((p) => p.nav));

    for (const p of PAGES) {
      const link = nav.getByRole('link', { name: p.nav, exact: true });
      await link.click();
      await expect(page).toHaveURL(p.urlRe);
      await expect(link).toHaveAttribute('aria-current', 'page');
      await expect(
        page.getByRole('main').getByRole('heading', { name: p.heading, exact: true, level: 1 }),
      ).toBeVisible();
    }
  });

  // Settings used to be a modal that left the URL untouched. It is now a
  // routed page (router.tsx: `settings`, `settings/:section`; SettingsPage.tsx)
  // so the URL changes on purpose, and its Back control returns to wherever
  // the user came from. The button still lives outside the routed <nav>.
  test('Settings opens the settings page and Back returns to the previous page', async ({ page, gotoApp }) => {
    await gotoApp('/chats');
    const aside = page.getByRole('complementary');
    // It is deliberately outside the routed <nav>.
    await expect(
      aside.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }),
    ).toHaveCount(0);
    await expect(aside.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);

    await aside.getByRole('button', { name: 'Settings', exact: true }).click();

    await expect(page).toHaveURL(/\/settings\/general$/);
    const settings = page.getByTestId('settings-page');
    await expect(settings.getByRole('heading', { name: 'Settings', exact: true, level: 2 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();

    await settings.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByTestId('settings-page')).toHaveCount(0);
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
      page.getByRole('complementary').getByRole('navigation').getByRole('link', { name: 'Dashboard', exact: true }),
    ).toBeVisible();
  });
});
