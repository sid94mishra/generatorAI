import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const assets = resolve(import.meta.dirname, '../../templates/system/extensions/genai.web-designer/ui');
test.use({ video: 'off' });

test('designer remains usable in a docked pane and a wide workspace', async ({ page }) => {
  await page.route('http://widget-audit.test/**', async (route) => {
    const filename = new URL(route.request().url()).pathname.slice(1) || 'designer.html';
    if (!['designer.html', 'app.js', 'styles.css'].includes(filename)) return route.abort();
    await route.fulfill({
      body: await readFile(resolve(assets, filename)),
      contentType: filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : 'text/html',
    });
  });
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto('http://widget-audit.test/');
  await page.evaluate(() => {
    const version = { id: 'v_test', html: '<h1>Release review</h1><button>Review case</button>', summary: 'Initial risk review', ts: Date.now() };
    window.postMessage({ type: 'widget:init', state: { current: version, history: [version], activity: [], requirement: '' } }, '*');
  });
  const preview = page.frameLocator('iframe[title="Design preview"]');
  await expect(preview.getByRole('heading', { name: 'Release review' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  expect((await page.locator('iframe').boundingBox())!.width).toBeGreaterThan(300);

  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  await expect(page.getByRole('button', { name: /Initial risk review/ })).toBeVisible();
  await expect(page.locator('#canvasCol')).toBeHidden();
  await page.getByRole('button', { name: /Initial risk review/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Restored: Initial risk review/ })).toBeVisible();

  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Design feedback' })).toBeVisible();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.locator('.code-view')).toContainText('<h1>Release review</h1>');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Review case' })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#compactTabs')).toBeHidden();
  await expect(page.locator('#historyPane')).toBeVisible();
  await expect(page.locator('#chatPane')).toBeVisible();
  await expect(page.locator('#canvasCol')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
});
