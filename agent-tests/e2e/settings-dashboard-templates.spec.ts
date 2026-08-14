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
