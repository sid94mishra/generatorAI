import { test, expect } from '../helpers/test';
import { apiRequest } from '../helpers/api';

// Phase W1 — Settings, Home, Templates.
// Authored from a playwright-cli exploration session (codegen + trace).
// Fully deterministic: no AI runs, no seeded data required.

// Settings is a modal addressed by URL (`/settings/:section`, D-26): the
// dialog is named "Settings", its section nav is
// `nav[aria-label="Settings sections"]` (labels from SETTINGS_NAV in
// @generatorai/shared/ui-contract) and it closes with the `settings-modal-close` button.
function settingsDialog(page: import('@playwright/test').Page) {
  return page.getByRole('dialog', { name: 'Settings' });
}

function settingsNav(page: import('@playwright/test').Page) {
  return settingsDialog(page).getByRole('navigation', { name: 'Settings sections' });
}

async function openSection(page: import('@playwright/test').Page, label: string) {
  const entry = settingsNav(page).getByRole('link', { name: label, exact: true });
  await entry.click();
  await expect(entry).toHaveAttribute('aria-current', 'page');
}

test.describe('Settings', () => {
  // These section names and ids come from SETTINGS_NAV
  // (packages/shared/src/ui-contract/settings.ts). The spec used to iterate ['General', 'Provider', 'Copilot',
  // 'Advanced'] — of which only 'General' has ever existed.
  test('switches between every settings tab', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    await expect(settingsDialog(page)).toBeVisible();

    for (const [tab, id] of [
      ['General', 'general'],
      ['Appearance', 'appearance'],
      ['Model providers', 'providers'],
      ['Agents', 'agents'],
      ['Skills', 'skills'],
      ['MCP servers', 'mcp'],
      ['Templates', 'templates'],
      ['Source control', 'source-control'],
      ['Browser & terminal', 'browser-terminal'],
      ['Computer use', 'computer-use'],
      ['Audio', 'audio'],
      ['Extensions', 'extensions'],
      ['Security & devices', 'security'],
      ['Storage', 'storage'],
      ['Diagnostics', 'diagnostics'],
    ]) {
      // The clicked entry becomes the current one and the URL addresses it.
      // Bare `/settings` already IS General (settingsSectionFromPath), so clicking the
      // current entry is a no-op and the URL may stay bare.
      await openSection(page, tab);
      await expect(page).toHaveURL(new RegExp(id === 'general' ? '/settings(/general)?$' : `/settings/${id}$`));
    }
    // Exactly one section is current at a time.
    await expect(settingsNav(page).locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('Appearance tab: mode, theme and accent all apply and persist', async ({ page, gotoApp }) => {
    await gotoApp('/settings');
    await openSection(page, 'Appearance');
    await expect(page.getByRole('heading', { name: 'Appearance', exact: true, level: 2 })).toBeVisible();

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
    // The gallery shows one group at a time (Product / Editor / Low glare tabs).
    await page.getByRole('tab', { name: /^Editor/ }).click();
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
    await openSection(page, 'Appearance');

    // The picker renders from the registry, so this count is the contract:
    // adding a theme without it appearing here means the group metadata is
    // wrong and the theme is invisible to users.
    // Wait for the picker before counting: `count()` does not auto-wait, and
    // the routed section can still be mounting right after the click.
    // The gallery shows one group at a time: sum the tiles across the three tabs.
    const themeGroup = page.getByRole('radiogroup', { name: 'Theme', exact: true });
    await expect(themeGroup).toBeVisible();
    let tiles = 0;
    for (const group of ['Product', 'Editor', 'Low glare']) {
      await page.getByRole('tab', { name: new RegExp(`^${group}`) }).click();
      await expect(themeGroup.getByRole('radio').first()).toBeVisible();
      tiles += await themeGroup.getByRole('radio').count();
    }
    expect(tiles).toBeGreaterThanOrEqual(17);

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
          for (const accent of ['ink', 'blue', 'violet', 'green', 'orange', 'rose', 'teal']) {
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
    await openSection(page, 'Diagnostics');
    await expect(page.getByText(/Server Health|Database|Uptime|Sandbox/i).first()).toBeVisible({ timeout: 10_000 });
  });

  // The section no longer says "Active": every connected provider is usable at
  // once, and the server's primary is marked with a "Default" badge next to a
  // live connection pill. Asserted against the registry the page renders from,
  // so it holds whichever provider is primary and whichever ones this machine
  // has signed in to.
  test('Model Providers tab marks the default provider and the connected count', async ({ page, gotoApp }) => {
    const reg = await apiRequest<{ primary: string; providers: Array<{ type: string; label: string; ready: boolean }> }>(
      'GET',
      '/harness/providers',
    );
    expect(reg.ok).toBe(true);
    const primary = reg.data.providers.find((p) => p.type === reg.data.primary);
    expect(primary, 'the primary provider must be listed in the registry').toBeTruthy();
    const readyCount = reg.data.providers.filter((p) => p.ready).length;

    await gotoApp('/settings');
    await openSection(page, 'Model providers');
    await expect(page.getByRole('heading', { name: 'Model Providers', exact: true, level: 2 })).toBeVisible();

    const main = settingsDialog(page);
    for (const p of reg.data.providers) {
      await expect(main.getByText(p.label, { exact: true })).toBeVisible();
    }
    await expect(main.getByText(`${readyCount} of ${reg.data.providers.length} connected`, { exact: true })).toBeVisible();
    // Exactly one "Default" badge, on the primary provider's row.
    await expect(main.getByText('Default', { exact: true })).toHaveCount(1);
    const esc = primary!.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(main.getByRole('button', { name: new RegExp(`^${esc} Default `) })).toBeVisible();
  });
});

test.describe('Home', () => {
  // `/` is Home (P5-10, L-01) — it replaced the Dashboard "Mission Control".
  // Its H1 is the live attention headline ("2 need you · 1 running",
  // "Nothing needs you"); sections without items are not drawn (D-36), so
  // only the always-present parts are asserted here.
  const HOME_HEADING = /^(Nothing needs you|\d+ needs? you)( · \d+ running)?$/;

  test('renders the headline, quick composer, header actions and the aside cards', async ({ page, gotoApp }) => {
    await gotoApp('/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: HOME_HEADING, level: 1 })).toBeVisible();

    await expect(main.getByRole('button', { name: 'Run workflow', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'New workflow', exact: true })).toBeVisible();

    await expect(main.getByRole('textbox', { name: 'New chat task' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Start chat' })).toBeDisabled();
    await expect(main.getByRole('button', { name: 'More options', exact: true })).toBeVisible();

    const system = page.getByTestId('home-system');
    await expect(system.getByText('System', { exact: true })).toBeVisible();
    await expect(system.getByRole('button', { name: 'Diagnostics', exact: true })).toBeVisible();
    await expect(page.getByTestId('home-this-week').getByText('This week', { exact: true })).toBeVisible();

    const shortcuts = main.getByRole('navigation', { name: 'Shortcuts' });
    for (const label of ['Projects', 'Agents', 'Automations', 'Scripts']) {
      await expect(shortcuts.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
    }
  });

  test('header action "New workflow" navigates to the new-workflow page', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await page.getByRole('main').getByRole('button', { name: 'New workflow', exact: true }).click();
    await expect(page).toHaveURL(/\/workflows\/new/);
  });

  // "Run workflow" opens the workflow list until the Workflow Overhaul's
  // RunDialog exists (F-home-01, 04 R-5).
  test('header action "Run workflow" navigates to the workflow list', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await page.getByRole('main').getByRole('button', { name: 'Run workflow', exact: true }).click();
    await expect(page).toHaveURL(/\/workflows$/);
    await expect(page.getByRole('main').getByRole('heading', { name: 'Workflows', exact: true, level: 1 })).toBeVisible();
  });
});

// ── Templates ──
// /templates is a 404: that route does not exist and never did (see
// apps/web/src/app/routes). Templates ship as a section of the Settings
// modal, `/settings/templates` (Catalogs.tsx -> TemplatesSection). Every test below is retargeted at that
// real surface, which preserves the original intent — list, search, and
// create-from-template — instead of skipping it.
test.describe('Templates (Settings → Templates tab)', () => {
  async function openTemplatesTab(page: import('@playwright/test').Page, gotoApp: (p: string) => Promise<void>) {
    await gotoApp('/settings');
    await openSection(page, 'Templates');
    await expect(page).toHaveURL(/\/settings\/templates$/);
    const dialog = settingsDialog(page);
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

    // from-template creates a definition, leaves Settings and navigates to the
    // new definition's detail page.
    await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const id = page.url().split('/workflows/')[1];
    if (id) tracker.track('definition', id);

    await expect(settingsDialog(page)).toHaveCount(0);
    await expect(page.getByTestId('workflow-stages')).toBeVisible({ timeout: 10_000 });
  });
});
