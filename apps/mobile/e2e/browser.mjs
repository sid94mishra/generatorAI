import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const net = [];
page.on('response', async (r) => { if (/\/browser/.test(r.url())) { let b = ''; try { if (r.status() >= 400) b = (await r.text()).slice(0, 150); } catch {} net.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://127.0.0.1:3111', '').slice(0, 70)} ${b}`); } });
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const tap = async (loc) => { const b = await loc.boundingBox({ timeout: 8000 }); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
try {
  await step('browser: Start example.com', async () => {
    await page.goto(APP_URL + process.argv[2], { waitUntil: 'domcontentloaded' }); await sleep(5000);
    await page.getByText(/^Browser$/).locator('visible=true').first().click(); await sleep(1500);
    const field = page.locator('input:visible').last();
    await field.click({ force: true }); await field.fill('https://example.com'); await sleep(300);
    const btns = [...new Set(await page.locator('[role=button]:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || '').trim()).filter(Boolean)))];
    console.log('  browser buttons:', JSON.stringify(btns.filter((x) => /go|start|navigate|open|back|forward|reload|stop|capture|inspect|control/i.test(x))));
    await tap(page.getByRole('button', { name: /^(go|start|navigate|open|load)/i }).locator('visible=true').first()); await sleep(12000);
    await shot(page, 'browser-after-start');
    return (await body()).slice(0, 200) + ' :: ' + net.slice(0, 6).join(' | ');
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 6).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
