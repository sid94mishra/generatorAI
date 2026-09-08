import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const vis = (re) => page.getByRole('button', { name: re }).locator('visible=true').first();
try {
  await step('switch to Light', async () => {
    await page.goto(APP_URL + '/settings/appearance', { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await page.getByText(/^Light$/).locator('visible=true').first().click();
    await sleep(1200);
    await shot(page, 'appearance-light');
  });
  for (const [n, r] of [['home', '/'], ['chats', '/chats'], ['work', '/runs'], ['chat', process.argv[2]], ['security', '/settings/security']]) {
    await step(n, async () => { await page.goto(APP_URL + r, { waitUntil: 'domcontentloaded' }); await sleep(4000); await shot(page, 'light-' + n); });
  }
  await step('switch to a different theme (Catppuccin) + accent', async () => {
    await page.goto(APP_URL + '/settings/appearance', { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await page.getByText(/Catppuccin/i).locator('visible=true').first().click().catch(() => {});
    await sleep(1200);
    await shot(page, 'appearance-catppuccin');
    await page.goto(APP_URL + process.argv[2], { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await shot(page, 'catppuccin-chat');
  });
  await step('back to System dark + GitHub', async () => {
    await page.goto(APP_URL + '/settings/appearance', { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await page.getByText(/^GitHub$/i).locator('visible=true').first().click().catch(() => {});
    await sleep(600);
    await page.getByText(/^Dark$/).locator('visible=true').first().click();
    await sleep(800);
  });
} finally {
  console.log('errors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 5).join(' | ') || '(none)');
  summary();
  await ctx.close();
}
