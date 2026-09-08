import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const vis = (re) => page.getByRole('button', { name: re }).locator('visible=true').first();
const visibleButtons = async () => [...new Set(await page.locator('[role=button]:visible, button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)).filter(Boolean)))];
try {
  await step('open chat', async () => { await page.goto(APP_URL + process.argv[2], { waitUntil: 'domcontentloaded' }); await sleep(5000); });
  await step('send second file prompt', async () => {
    const field = page.locator('textarea:visible').last();
    await field.click();
    await field.fill('Create another file named second.txt containing the word two. Use your file-writing tool.');
    await vis(/^send$/i).click();
    for (let i = 0; i < 36; i++) { await sleep(5000); if ((await visibleButtons()).some((x) => /^allow$/i.test(x))) break; }
    await shot(page, 'gate-pending');
    return (await visibleButtons()).filter((x) => /allow|deny|stop/i.test(x)).join(', ');
  });
  await step('Stop while gate pending (two-phase)', async () => {
    await vis(/^stop$/i).click();
    await sleep(1200);
    await shot(page, 'after-stop-press-1');
    const b1 = await visibleButtons();
    const second = b1.find((x) => /stop|force|now/i.test(x));
    for (let i = 0; i < 12; i++) { await sleep(5000); const b = await visibleButtons(); if (!b.includes('Stop') && !b.some((x) => /^allow$/i.test(x))) break; }
    await shot(page, 'after-stop-final');
    return `after first press: ${second ?? '(no stop control)'} :: ${(await body()).slice(-260)}`;
  });
  await step('long-press user message → context menu', async () => {
    const row = page.getByText(/Create another file named second/).locator('visible=true').first();
    const box = await row.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await sleep(900); await page.mouse.up();
    await sleep(1200);
    await shot(page, 'context-menu');
    return (await body()).slice(-200);
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
