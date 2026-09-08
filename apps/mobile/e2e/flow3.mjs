// Composer surfaces, rename, model pick, terminal create (web: no WebView), agents, accessibility, chat swipe.
import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const vis = (re) => page.getByRole('button', { name: re }).locator('visible=true').first();
const visibleButtons = async () => [...new Set(await page.locator('[role=button]:visible, button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean)))];
const chat = process.argv[2];
// Sheet items keep moving for a moment under Reanimated's spring, which trips Playwright's
// actionability check even though a real tap lands fine — so tap by coordinates.
const tap = async (loc, timeout = 8000) => { const box = await loc.boundingBox({ timeout }); if (!box) throw new Error('no box'); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); };
const safe = async (label, fn) => { try { await step(label, fn); } catch (e) { /* recorded by step */ } };
try {
  await safe('rename via chat menu', async () => {
    await page.goto(APP_URL + chat, { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    await vis(/^chat menu$/i).click(); await sleep(1000);
    await shot(page, 'chat-menu');
    await tap(page.getByRole('button', { name: /^rename$/i }).locator('visible=true').last()); await sleep(1000);
    await shot(page, 'rename-sheet');
    const input = page.locator('input:visible').first();
    await input.click({ force: true }); await input.fill('Renamed again ' + new Date().toISOString().slice(14, 19));
    await tap(page.getByRole('button', { name: /^(save|rename|done)$/i }).locator('visible=true').last());
    await sleep(2500);
    return (await body()).slice(0, 60);
  });
  await safe('slash strip', async () => {
    const field = page.locator('textarea:visible').last();
    await field.click(); await field.fill('/');
    await sleep(1200);
    await shot(page, 'slash-strip');
    const t = await body();
    await field.fill('');
    return t.match(/(plan|browser|terminal|changes|files)[^|]{0,120}/i)?.[0] ?? t.slice(0, 120);
  });
  await safe('@ mention strip', async () => {
    const field = page.locator('textarea:visible').last();
    await field.fill('@hel');
    await sleep(1500);
    await shot(page, 'mention-strip');
    const t = await body();
    await field.fill('');
    return t.includes('hello.txt') ? 'hello.txt suggested' : 'no file suggestion; ' + t.slice(0, 100);
  });
  await safe('attach menu', async () => {
    await vis(/^add attachment$/i).click(); await sleep(1000);
    await shot(page, 'attach-menu');
    const b = (await visibleButtons()).slice(-8).join(', ');
    await tap(vis(/^cancel$/i)).catch(() => {});
    await sleep(500);
    return b;
  });
  await safe('model sheet → pick Sonnet 5', async () => {
    await vis(/^choose model$/i).click(); await sleep(1200);
    await shot(page, 'model-sheet');
    await tap(page.getByRole('button', { name: /^sonnet 5$/i }).locator('visible=true').first());
    await sleep(2000);
    await shot(page, 'model-picked');
    return (await visibleButtons()).filter((x) => /model/i.test(x)).join(', ');
  });
  await safe('terminal: New terminal (web has no WebView)', async () => {
    await page.getByText(/^Terminal$/).locator('visible=true').first().click(); await sleep(1500);
    await tap(vis(/^new terminal$/i)); await sleep(5000);
    await shot(page, 'terminal-created');
    return (await body()).slice(0, 200) + ' :: ' + (await visibleButtons()).filter((x) => /terminal|kill|restart|esc|ctrl/i.test(x)).slice(0, 10).join(', ');
  });
  await safe('Projects › Agents detail', async () => {
    await page.goto(APP_URL + '/projects?segment=agents', { waitUntil: 'domcontentloaded' }); await sleep(4000);
    await shot(page, 'agents');
    const first = page.locator('[role=button]:visible').filter({ hasText: /agent|reviewer|planner|coder|explore/i }).first();
    await tap(first); await sleep(1500);
    await shot(page, 'agent-detail');
    return (await body()).slice(0, 200);
  });
  await safe('Accessibility: Reduced motion on, then System', async () => {
    await page.goto(APP_URL + '/settings/accessibility', { waitUntil: 'domcontentloaded' }); await sleep(4000);
    await page.getByText(/^Reduced$/).locator('visible=true').first().click(); await sleep(800);
    await shot(page, 'reduced-motion');
    await page.goto(APP_URL + '/chats', { waitUntil: 'domcontentloaded' }); await sleep(3500);
    await page.goto(APP_URL + '/settings/accessibility', { waitUntil: 'domcontentloaded' }); await sleep(3500);
    await page.getByText(/^System$/).locator('visible=true').first().click(); await sleep(500);
    return 'ok';
  });
  await safe('Chats: swipe a row for actions', async () => {
    await page.goto(APP_URL + '/chats', { waitUntil: 'domcontentloaded' }); await sleep(4000);
    const row = page.getByText(/Renamed again/).locator('visible=true').first();
    const box = await row.boundingBox();
    await page.mouse.move(box.x + 300, box.y + box.height / 2); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(box.x + 300 - i * 20, box.y + box.height / 2); await sleep(30); }
    await sleep(400);
    await shot(page, 'chat-swiped');
    await page.mouse.up(); await sleep(800);
    await shot(page, 'chat-swiped-released');
    return (await visibleButtons()).filter((x) => /archive|delete/i.test(x)).join(', ') || 'no swipe actions exposed';
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
