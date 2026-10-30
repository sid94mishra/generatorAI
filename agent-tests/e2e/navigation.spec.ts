import { test, expect } from '../helpers/test';

// Deterministic navigation smoke across every primary page, written against
// the P3 app shell (docs/redesign/06-desktop-and-shell.md §2.6, §9.1;
// 09-verification.md §7.3). No seeded data required.
//
//   • The sidebar is `aside[data-testid="app-sidebar"]` with `data-collapsed`
//     = `full` (232px) or `rail` (48px). Its `<nav aria-label="Main">`
//     (`sidebar-nav`) holds exactly seven React Router links, in D-22 order:
//     Home, Chats, Projects, Agents, Workflows, Automations, Scripts — each
//     also carrying `sidebar-nav-<id>`.
//   • Page titles are the <h1> inside <main> (`main-card`). `/` is Home
//     (P5-10): its H1 is the live headline ("2 need you · 1 running",
//     "Nothing needs you"), matched by HOME_HEADING.
//   • Every page renders its own PageHeader (the legacy Header went in P7).
//   • Settings is the footer gear (`sidebar-settings`, outside the <nav>): a
//     modal addressed by URL (`/settings/<section>`) over the current page (D-26).
//   • The sidebar's own Collapse
//     (`sidebar-toggle`, "Hide sidebar") and the rail's Expand (`rail-expand`,
//     "Show sidebar") are the pair. Below 1200px the rail is forced and
//     Expand opens the `sidebar-flyout` overlay instead.
/** Home's H1 — the attention headline (features/home/homeModel.ts `homeHeadline`). */
const HOME_HEADING = /^(Nothing needs you|\d+ needs? you)( · \d+ running)?$/;

const PAGES: Array<{ id: string; nav: string; urlRe: RegExp; heading: string | RegExp }> = [
  { id: 'home', nav: 'Home', urlRe: /\/$/, heading: HOME_HEADING },
  { id: 'chats', nav: 'Chats', urlRe: /\/chats$/, heading: 'Chats' },
  { id: 'projects', nav: 'Projects', urlRe: /\/projects$/, heading: 'Projects' },
  { id: 'agents', nav: 'Agents', urlRe: /\/agents$/, heading: 'Agents' },
  { id: 'workflows', nav: 'Workflows', urlRe: /\/workflows$/, heading: 'Workflows' },
  { id: 'automations', nav: 'Automations', urlRe: /\/automations$/, heading: 'Automations' },
  { id: 'scripts', nav: 'Scripts', urlRe: /\/scripts$/, heading: 'Scripts' },
];

const SIDEBAR_FULL = '[data-testid="app-sidebar"][data-collapsed="full"]';
const SIDEBAR_RAIL = '[data-testid="app-sidebar"][data-collapsed="rail"]';

test.describe('Navigation & layout', () => {
  // The project's device preset (Desktop Chrome, 1280×720) overrides the
  // config-level viewport, so pin a width well above the 1200px rail
  // breakpoint explicitly.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('sidebar navigates to every primary page', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.getByTestId('app-frame')).toBeVisible();
    await expect(page.locator(SIDEBAR_FULL)).toBeVisible();

    const nav = page.getByTestId('sidebar-nav');
    await expect(nav).toBeVisible();
    await expect(nav).toHaveAttribute('aria-label', 'Main');

    // The nav roster itself is the contract: a route silently dropped from
    // the sidebar would otherwise still pass the per-page walk below via
    // direct URL entry.
    await expect(nav.getByRole('link')).toHaveText(PAGES.map((p) => p.nav));

    for (const p of PAGES) {
      const link = nav.getByRole('link', { name: p.nav, exact: true });
      await expect(link).toHaveAttribute('data-testid', `sidebar-nav-${p.id}`);
      await link.click();
      await expect(page).toHaveURL(p.urlRe);
      await expect(link).toHaveAttribute('aria-current', 'page');
      const main = page.getByRole('main');
      await expect(main).toHaveAttribute('data-testid', 'main-card');
      await expect(main.getByRole('heading', { name: p.heading, exact: true, level: 1 })).toBeVisible();
    }
  });

  // Settings is a modal addressed by URL (D-26, P6-02): the URL now changes to
  // `/settings/<section>` — the pre-P6 "URL untouched" assertion was changed on
  // purpose — while the page it was opened over stays behind it. The gear sits
  // in the sidebar footer, outside the routed <nav>; Close and Escape return to
  // the page.
  test('Settings opens as a modal over the current page and Close returns to it', async ({ page, gotoApp }) => {
    await gotoApp('/chats');
    const nav = page.getByTestId('sidebar-nav');
    await expect(nav.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);

    const gear = page.getByTestId('sidebar-settings');
    await expect(gear).toHaveAccessibleName('Settings');
    await gear.click();

    await expect(page).toHaveURL(/\/settings\/[^/]+$/);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
    // The Chats page is still mounted behind the modal.
    await expect(page.getByRole('heading', { name: 'Chats', includeHidden: true }).first()).toBeAttached();

    await page.getByTestId('settings-modal-close').click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/chats$/);

    // Escape closes it the same way.
    await gear.click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/chats$/);
  });

  test('sidebar collapses to the rail and expands again', async ({ page, gotoApp }) => {
    await gotoApp('/');
    const width = (selector: string) =>
      page.locator(selector).evaluate((el) => Math.round(el.getBoundingClientRect().width));

    await expect(page.locator(SIDEBAR_FULL)).toBeVisible();
    await expect(page.getByTestId('app-frame')).toHaveAttribute('data-sidebar', 'expanded');
    await expect.poll(() => width(SIDEBAR_FULL)).toBe(232);

    // ── Collapse ──
    const collapse = page.getByTestId('sidebar-toggle');
    await expect(collapse).toHaveAccessibleName('Hide sidebar');
    await collapse.click();

    await expect(page.locator(SIDEBAR_RAIL)).toBeVisible();
    await expect(page.locator(SIDEBAR_FULL)).toHaveCount(0);
    await expect(page.getByTestId('app-frame')).toHaveAttribute('data-sidebar', 'rail');
    await expect.poll(() => width(SIDEBAR_RAIL), { message: 'rail is 48px wide' }).toBe(48);
    // The rail keeps every destination reachable (icon links named by label).
    await expect(page.getByTestId('rail-nav').getByRole('link')).toHaveCount(PAGES.length);

    // ── Expand again ──
    const expand = page.getByTestId('rail-expand');
    await expect(expand).toHaveAccessibleName('Show sidebar');
    await expand.click();

    await expect(page.locator(SIDEBAR_FULL)).toBeVisible();
    await expect(page.locator(SIDEBAR_RAIL)).toHaveCount(0);
    await expect.poll(() => width(SIDEBAR_FULL), { message: 'sidebar is 232px wide' }).toBe(232);
    await expect(page.getByTestId('sidebar-flyout')).toHaveCount(0);
    await expect(
      page.getByTestId('sidebar-nav').getByRole('link', { name: 'Home', exact: true }),
    ).toBeVisible();
  });

  test('below 1200px the rail is forced and Expand opens the flyout', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.locator(SIDEBAR_FULL)).toBeVisible();

    // Narrow window: rail even though the saved preference is "expanded".
    await page.setViewportSize({ width: 1100, height: 760 });
    const rail = page.locator(SIDEBAR_RAIL);
    await expect(rail).toBeVisible();
    await expect(page.locator(SIDEBAR_FULL)).toHaveCount(0);
    await expect(page.getByTestId('app-frame')).toHaveAttribute('data-sidebar', 'rail');

    await page.getByTestId('rail-expand').click();
    const flyout = page.getByTestId('sidebar-flyout');
    await expect(flyout).toBeVisible();
    await expect(flyout).toHaveAttribute('role', 'dialog');
    await expect(flyout.getByTestId('sidebar-nav')).toBeVisible();
    await expect(flyout.getByTestId('sidebar-nav').getByRole('link')).toHaveText(PAGES.map((p) => p.nav));

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sidebar-flyout')).toHaveCount(0);
    await expect(rail).toBeVisible();

    // The forced rail never touched the preference: widening restores the sidebar.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(SIDEBAR_FULL)).toBeVisible();
    await expect(page.locator(SIDEBAR_RAIL)).toHaveCount(0);
  });

  test('an unknown URL renders the 404 inside the shell', async ({ page, gotoApp }) => {
    await gotoApp('/definitely-not-a-page');
    await expect(page.getByTestId('app-frame')).toBeVisible();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Page not found', exact: true, level: 1 })).toBeVisible();

    const home = main.getByRole('link', { name: 'Go home', exact: true })
      .or(main.getByRole('button', { name: 'Go home', exact: true }));
    await home.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(main.getByRole('heading', { name: HOME_HEADING, level: 1 })).toBeVisible();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
  });
});
