import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const tap = async (loc) => { const b = await loc.boundingBox({ timeout: 8000 }); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
const visibleButtons = async () => [...new Set(await page.locator('[role=button]:visible, button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean)))];
try {
  await step('Chats › Archived lists the chat', async () => {
    await page.goto(APP_URL + '/chats', { waitUntil: 'domcontentloaded' }); await sleep(4000);
    await page.getByText(/^Archived$/).locator('visible=true').first().click(); await sleep(1500);
    await shot(page, 'archived-tab');
    const t = await body();
    if (!/Renamed again/.test(t)) throw new Error('archived chat missing: ' + t.slice(0, 200));
    return 'listed';
  });
  await step('long-press row → Unarchive', async () => {
    const row = page.getByText(/Renamed again/).locator('visible=true').first();
    const b = await row.boundingBox();
    await page.mouse.move(b.x + 40, b.y + b.height / 2); await page.mouse.down(); await sleep(1000); await page.mouse.up(); await sleep(1000);
    await shot(page, 'archived-row-menu');
    const btns = await visibleButtons();
    console.log('  menu:', JSON.stringify(btns.slice(-6)));
    const un = page.getByRole('button', { name: /unarchive|restore|move to active/i }).locator('visible=true').first();
    if (await un.count()) { await tap(un); await sleep(2500); }
    else {
      // swipe path
      await page.mouse.move(b.x + 300, b.y + b.height / 2); await page.mouse.down();
      for (let i = 1; i <= 8; i++) { await page.mouse.move(b.x + 300 - i * 20, b.y + b.height / 2); await sleep(30); }
      await sleep(300); await shot(page, 'archived-row-swiped');
      const btn = page.getByRole('button', { name: /unarchive|restore|move to active/i }).locator('visible=true').first();
      await page.mouse.up(); await sleep(500);
      if (await btn.count()) { await tap(btn); await sleep(2500); }
    }
    await page.getByText(/^Active$/).locator('visible=true').first().click(); await sleep(1500);
    await shot(page, 'active-after');
    const t = await body();
    if (!/Renamed again/.test(t)) throw new Error('still archived');
    return 'unarchived';
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
