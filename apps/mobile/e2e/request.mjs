import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const net = [];
page.on('response', async (r) => { if (r.url().includes('scope-requests')) { let b = ''; try { b = (await r.text()).slice(0, 160); } catch {} net.push(`${r.status()} ${r.request().method()} ${b}`); } });
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const visibleButtons = async () => [...new Set(await page.locator('[role=button]:visible, button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean)))];
try {
  await step('pick terminal + send request', async () => {
    await page.goto(APP_URL + '/scope-request', { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await page.getByRole('switch', { name: /run terminal commands/i }).locator('visible=true').first().click();
    await sleep(600);
    const b = await visibleButtons();
    console.log('  buttons after pick:', JSON.stringify(b));
    await page.getByRole('button', { name: /request/i }).locator('visible=true').last().click({ timeout: 8000 });
    await sleep(3500);
    await shot(page, 'request-sent');
    return (await body()).slice(0, 200) + ' :: ' + net.join(' | ');
  });
  await step('Security shows pending request', async () => {
    await page.goto(APP_URL + '/settings/security', { waitUntil: 'domcontentloaded' });
    await sleep(4500);
    await shot(page, 'security-pending');
    const t = await body();
    if (!/pending|waiting|requested/i.test(t)) throw new Error('no pending row: ' + t.slice(0, 300));
    return t.match(/.{0,80}(pending|Pending|waiting)[^.]{0,120}/)?.[0] ?? t.slice(0, 200);
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
