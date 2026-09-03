import { test, expect } from '../helpers/test';

// Phase W1 — Settings, Dashboard, Templates.
// Authored from a playwright-cli exploration session (codegen + trace).
// Fully deterministic: no AI runs, no seeded data required.

test.describe('Settings', () => {
  // These tab names come from SettingsModal's own section list. The spec used
  // to iterate ['General', 'Provider', 'Copilot', 'Advanced'] — of which only
  // 'General' has ever existed — so three quarters of it asserted against a UI
  // that was never shipped.
  test('switches between every settings tab', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    // Two elements render the text "Settings" (the dialog's sr-only title and
    // the visible banner heading), so an unqualified name match is a strict
    // mode violation. Pin the visible one.
    await expect(page.getByRole('banner').getByRole('heading', { name: 'Settings' })).toBeVisible();

    for (const tab of [
      'General',
      'Appearance',
      'Model Providers',
      'Agents',
      'Skills',
      'MCP Servers',
      'Templates',
      'Source Control',
      'Browser & Terminal',
      'Computer Use',
      'Extensions',
      'Security & Devices',
      'Diagnostics',
    ]) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      // Each tab keeps the tab bar; assert the clicked tab is present/active.
      await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
    }
  });

  test('Appearance tab: mode, theme and accent all apply and persist', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();

    // ── Mode ──
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem('generatorai-theme'))).toBe('dark');

    await page.getByRole('radio', { name: 'Light', exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem('generatorai-theme'))).toBe('light');

    // ── Theme ──
    // Asserted on a resolved CSS variable, not on the attribute alone: the
    // attribute proves the provider ran, the variable proves the generated
    // CSS actually matched the selector it emitted.
    await page.getByRole('radio', { name: /^Catppuccin/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'catppuccin');
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
      ),
    ).toBe('#eff1f5'); // Latte base — i.e. the LIGHT variant of the theme we picked

    // ── Accent, scoped to the theme we just chose ──
    await page.getByRole('radio', { name: 'Green', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'green');
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      ),
    ).toBe('#3c9528'); // Catppuccin's green, not GitHub's

    // Survives a reload, and without a flash of the default theme.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'catppuccin');
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'green');
  });

  test('Appearance tab: every registered theme is reachable and readable', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();

    // The picker renders from the registry, so this count is the contract:
    // adding a theme without it appearing here means the group metadata is
    // wrong and the theme is invisible to users.
    const cards = page.locator('[role="radiogroup"][aria-label="Theme"] [role="radio"]');
    expect(await cards.count()).toBeGreaterThanOrEqual(17);
    for (const group of ['Product', 'Editor', 'Low glare']) {
      await expect(page.getByText(group, { exact: true })).toBeVisible();
    }

    // Walk every theme in both modes and measure the SHIPPED CSS. Contrast is
    // already unit-tested against the token data; what this adds is proof that
    // the emitted stylesheet delivers that data to a real document — the
    // selector ladder, the cascade and the pre-paint script included.
    const audit = await page.evaluate(() => {
      const root = document.documentElement;
      const lum = (hex: string) => {
        const b = hex.replace('#', '');
        const [r, g, bl] = [0, 2, 4].map((i) => parseInt(b.slice(i, i + 2), 16) / 255);
        const c = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(bl);
      };
      const ratio = (a: string, b: string) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const themes = [
        ...new Set(
          [...document.styleSheets]
            .flatMap((s) => {
              try {
                return [...(s as CSSStyleSheet).cssRules];
              } catch {
                return [];
              }
            })
            .map((r) => (r as CSSStyleRule).selectorText || '')
            .flatMap((s) => [...s.matchAll(/\[data-theme="([^"]+)"\]/g)].map((m) => m[1])),
        ),
      ];

      const failures: string[] = [];
      for (const theme of themes) {
        for (const mode of ['dark', 'light']) {
          for (const accent of ['blue', 'violet', 'green', 'orange', 'rose', 'teal']) {
            root.className = mode;
            root.setAttribute('data-theme', theme);
            root.setAttribute('data-accent', accent);
            const cs = getComputedStyle(root);
            const g = (n: string) => cs.getPropertyValue(n).trim();
            const id = `${theme}/${mode}/${accent}`;
            if (!g('--background')) failures.push(`${id} produced no tokens`);
            const body = ratio(g('--foreground'), g('--background'));
            const muted = ratio(g('--muted-foreground'), g('--card'));
            const button = ratio(g('--primary-foreground'), g('--primary-emphasis'));
            const link = ratio(g('--primary'), g('--background'));
            if (body < 4.5) failures.push(`${id} body ${body.toFixed(2)}`);
            if (muted < 4.5) failures.push(`${id} muted ${muted.toFixed(2)}`);
            if (button < 4.5) failures.push(`${id} button ${button.toFixed(2)}`);
            if (link < 3) failures.push(`${id} link ${link.toFixed(2)}`);
          }
        }
      }
      return { themeCount: themes.length, failures };
    });

    expect(audit.themeCount).toBeGreaterThanOrEqual(17);
    expect(audit.failures).toEqual([]);
  });

  // The tab is 'Diagnostics', not 'Advanced' — this spec named a tab that has
  // never existed in the shipped SettingsModal (`git show HEAD` has no
  // 'Advanced' either), so it was asserting against an imagined UI.
  test('Diagnostics tab shows server health info', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    await expect(page.getByText(/Server Health|Database|Uptime|Sandbox/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Model Providers tab shows the active provider', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    await page.getByRole('button', { name: 'Model Providers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Model Providers' })).toBeVisible();
    // Both providers this build knows are listed here regardless of which one
    // is primary, so asserting on Copilot's presence is safe under
    // HARNESS_TYPE=claude-agent too.
    await expect(page.getByText(/GitHub Copilot/i).first()).toBeVisible();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  });
});

test.describe('Dashboard', () => {
  // The dashboard's own heading is 'Mission Control' — 'Dashboard' is only the
  // sidebar entry and the header breadcrumb (a <span>, not a heading). The
  // shipped page has no 'Recent Chats' / 'Recent Runs' panels either: the two
  // lists were replaced by a single 'Activity' panel with Today / Running /
  // Needs attention tabs. All three names were asserting a UI that never
  // shipped, so they are retargeted at what actually renders.
  test('renders header, quick actions, stat cards and the activity panel', async ({ page, gotoApp }) => {
    await gotoApp('/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Mission Control', exact: true, level: 1 })).toBeVisible();

    await expect(main.getByRole('button', { name: /New Chat/ })).toBeVisible();
    await expect(main.getByRole('button', { name: /New Workflow/ })).toBeVisible();

    // Stat cards — the row that replaced the old "Browse …" quick actions.
    // Matched on the label <p> specifically so a chat in the activity feed
    // that happens to be called "Workflows" can't satisfy (or break) this.
    for (const label of ['Chats', 'Workflows', 'Automations', 'System Health']) {
      await expect(main.locator('p').filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }

    await expect(main.getByRole('heading', { name: 'Activity', exact: true, level: 2 })).toBeVisible();
    const tabs = main.getByRole('tablist').getByRole('tab');
    await expect(tabs).toHaveCount(3);
    for (const t of ['Today', 'Running', 'Needs attention']) {
      await expect(main.getByRole('tab', { name: new RegExp(`^${t}`) })).toBeVisible();
    }
  });

  test('quick action "New Workflow" navigates to the builder', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await page.getByRole('button', { name: /New Workflow/ }).click();
    await expect(page).toHaveURL(/\/workflows\/new/);
  });

  // There is no 'Browse Workflows' button — that quick action was never built.
  // The dashboard affordance that actually reaches the workflow list is the
  // 'Workflows' stat card (DashboardPage.tsx -> navigate('/workflows')), so
  // the test is retargeted there rather than dropped.
  //
  // NOTE (app issue, not fixed here): StatCard renders a plain <div> with an
  // onClick — no role="button", no tabindex, no key handler — so the card is
  // unreachable by role and by keyboard. Hence the click goes through the
  // label text, which bubbles to the card's handler.
  test('the "Workflows" stat card navigates to the workflow list', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await page.getByRole('main').locator('p').filter({ hasText: /^Workflows$/ }).click();
    await expect(page).toHaveURL(/\/workflows$/);
    await expect(page.getByRole('main').getByRole('heading', { name: 'Workflows', exact: true, level: 1 })).toBeVisible();
  });
});

// ── Templates ──
// /templates is a 404: that route does not exist and never did (see
// apps/web/src/router.tsx). Templates ship as a tab inside the Settings modal
// (Catalogs.tsx -> TemplatesSection). Every test below is retargeted at that
// real surface, which preserves the original intent — list, search, and
// create-from-template — instead of skipping it.
test.describe('Templates (Settings → Templates tab)', () => {
  async function openTemplatesTab(page: import('@playwright/test').Page, gotoApp: (p: string) => Promise<void>) {
    await gotoApp('/settings');
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Templates', exact: true, level: 2 })).toBeVisible();
    // Wait for the list itself, not just the section header. The list header
    // reads "Workflow templates" while `useTemplates()` has no data and only
    // becomes "<n> templates" once it resolves — so this is the load gate.
    // Without it a slow/failed templates fetch surfaced as an opaque
    // "waiting for button 'Use'" click timeout.
    await expect(dialog.getByRole('heading', { level: 3 })).toHaveText(/^\d+ templates$/, {
      timeout: 20_000,
    });
    return dialog;
  }

  test('lists templates with a search box and Use actions', async ({ page, gotoApp }) => {
    const dialog = await openTemplatesTab(page, gotoApp);
    // The button is labelled 'Use', not 'Use Template'.
    await expect(dialog.getByPlaceholder(/Search templates/i)).toBeVisible();
    const uses = dialog.getByRole('button', { name: 'Use', exact: true });
    const count = await uses.count();
    expect(count).toBeGreaterThan(0);
    // The list header states the count, so the two must agree — a rendering
    // bug that dropped cards would otherwise slip past a `> 0` check.
    await expect(dialog.getByRole('heading', { name: `${count} templates`, exact: true })).toBeVisible();
  });

  test('search filters the list down to matching templates', async ({ page, gotoApp }) => {
    const dialog = await openTemplatesTab(page, gotoApp);
    const search = dialog.getByPlaceholder(/Search templates/i);
    const uses = dialog.getByRole('button', { name: 'Use', exact: true });
    const total = await uses.count();

    await search.fill('Code Generation');
    // Matching template stays; non-matching ones are gone — the original only
    // checked that *something* remained, which a broken filter also satisfies.
    await expect(dialog.getByText('Code Generation Workflow', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Code Review Workflow', { exact: true })).toHaveCount(0);
    expect(await uses.count()).toBeLessThan(total);

    await search.fill('zzz-no-such-template');
    await expect(dialog.getByText('No templates found.')).toBeVisible();

    await search.fill('');
    await expect(uses).toHaveCount(total);
  });

  test('Use creates a workflow and opens its detail page', async ({ page, gotoApp, tracker }) => {
    const dialog = await openTemplatesTab(page, gotoApp);
    await dialog.getByRole('button', { name: 'Use', exact: true }).first().click();

    // from-template creates a definition, closes settings and navigates to the
    // new definition's detail page.
    await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const id = page.url().split('/workflows/')[1];
    if (id) tracker.track('definition', id);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('rf__wrapper')).toBeVisible({ timeout: 10_000 });
  });
});
