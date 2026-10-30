import { test, expect } from '../helpers/test';

// Back / Forward (D-93). The desktop app draws Back / Forward buttons (macOS
// traffic-light row and rail, the Windows/Linux title strip, the Linux native
// sidebar row) and binds ⌘[ / ⌘] · Alt+← / Alt+→, mouse buttons 4/5 and the
// trackpad swipe — covered by the desktop smokes and unit tests. A browser
// tab has its own Back / Forward, so the web draws no buttons and binds no
// keys; the command palette still lists both commands, and they move through
// the same history.

test.describe('Back / Forward (D-93)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('the web draws no Back / Forward buttons (the browser has its own)', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.getByTestId('app-frame')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Forward', exact: true })).toHaveCount(0);
  });

  test('the palette lists Back and Forward and they move through history', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await page.getByTestId('sidebar-nav-chats').click();
    await expect(page).toHaveURL(/\/chats$/);
    await page.getByTestId('sidebar-nav-projects').click();
    await expect(page).toHaveURL(/\/projects$/);

    const run = async (label: 'Back' | 'Forward') => {
      await page.getByTestId('sidebar-search').click();
      const palette = page.getByRole('dialog');
      await palette.getByRole('combobox').fill(label);
      await palette.getByRole('option', { name: new RegExp(`^${label}`) }).click();
    };

    await run('Back');
    await expect(page).toHaveURL(/\/chats$/);
    await run('Forward');
    await expect(page).toHaveURL(/\/projects$/);
    // And the browser's own Back agrees with the same entries.
    await page.goBack();
    await expect(page).toHaveURL(/\/chats$/);
  });
});
