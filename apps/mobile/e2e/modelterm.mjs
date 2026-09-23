import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const vis = (re) => page.getByRole('button', { name: re }).locator('visible=true').first();
const visibleButtons = async () => [...new Set(await page.locator('[role=button]:visible, button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean)))];
const tap = async (loc) => { const b = await loc.boundingBox({ timeout: 8000 }); if (!b) throw new Error('no box'); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
const safe = async (l, f) => { try { await step(l, f); } catch {} };
try {
  await page.goto(APP_URL + process.argv[2], { waitUntil: 'domcontentloaded' }); await sleep(5000);
  await safe('model sheet → pick Sonnet 5', async () => {
    await tap(page.getByTestId('composer-model').locator('visible=true').first()); await sleep(1500);
    await shot(page, 'model-sheet');
    await tap(page.getByRole('button', { name: /^sonnet 5$/i }).locator('visible=true').first()); await sleep(2500);
    await shot(page, 'model-picked');
    return (await visibleButtons()).filter((x) => /model/i.test(x)).join(', ');
  });
  await safe('turn options → effort/tier visible', async () => {
    await tap(page.getByTestId('composer-options').locator('visible=true').first()); await sleep(1200);
    await shot(page, 'turn-options');
    const t = await body();
    await tap(vis(/^close$/i)); await sleep(600);
    return t.slice(t.indexOf('Turn options'), t.indexOf('Turn options') + 220);
  });
  await safe('terminal: New terminal', async () => {
    await tap(page.getByTestId('workbench-button').locator('visible=true').first()); await sleep(900);
    await tap(page.getByTestId('workbench-tool-terminal').locator('visible=true').first()); await sleep(1500);
    await tap(vis(/^new terminal$/i)); await sleep(6000);
    await shot(page, 'terminal-created');
    return (await body()).slice(0, 160) + ' :: ' + (await visibleButtons()).filter((x) => /terminal|kill|restart|esc|ctrl|tab|find|paste/i.test(x)).slice(0, 12).join(', ');
  });
  await safe('browser: Start', async () => {
    // The tool sheet is already up: its chip strip switches tool in place.
    await tap(page.getByRole('button', { name: /^Browser\./ }).locator('visible=true').first()); await sleep(1500);
    const field = page.locator('input:visible').last();
    await field.click({ force: true }); await field.fill('https://example.com');
    await tap(page.getByRole('button', { name: /^(go|start|navigate|open)/i }).locator('visible=true').first()); await sleep(9000);
    await shot(page, 'browser-started');
    return (await body()).slice(0, 200);
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
