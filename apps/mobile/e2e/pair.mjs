// Pair the web-preview "phone" with the isolated server via the manual code path.
import { launch, step, shot, summary, pairingUrl, APP_URL, sleep } from './lib.mjs';

const { ctx, page, consoleLog } = await launch({ fresh: process.argv.includes('--fresh') });
try {
  await step('open app', async () => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    return page.url();
  });
  await shot(page, 'first-screen');
  const body = await page.locator('body').innerText();
  if (/Pair this device|Pair with this server|Scan a QR|Enter the code/i.test(body)) {
    await step('go to manual entry', async () => {
      const manual = page.getByText(/Enter the code manually/i).first();
      await manual.click({ timeout: 10000 });
      await page.waitForTimeout(500);
    });
    await shot(page, 'manual-entry');
    await step('paste pairing link', async () => {
      const input = page.locator('textarea, input').first();
      await input.fill(pairingUrl());
      await page.getByText(/^Continue$/).first().click();
      await page.waitForTimeout(2500);
    });
    await shot(page, 'consent');
    await step('confirm pairing', async () => {
      await page.getByText(/Pair this device/).first().click();
      await page.waitForTimeout(6000);
      return page.url();
    });
  }
  await shot(page, 'after-pair');
  await step('landed on tabs', async () => {
    const text = await page.locator('body').innerText();
    if (!/Chats|Activity|Home/.test(text)) throw new Error('no tab shell text: ' + text.slice(0, 200));
    return text.slice(0, 120).replace(/\s+/g, ' ');
  });
} finally {
  console.log('\nconsole:', consoleLog.slice(0, 15).join('\n  ') || '(clean)');
  summary();
  await ctx.close();
}
