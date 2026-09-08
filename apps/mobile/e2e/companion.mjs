// Companion-scope device: stream must connect (read:activity), panes lock honestly, request-access round-trips.
import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const net = [];
page.on('response', async (r) => { const u = r.url(); if (/\/api\/(stream|auth\/devices\/me\/scope-requests)/.test(u)) { let b = ''; try { if (r.request().method() !== 'GET' || r.status() >= 400) b = (await r.text()).slice(0, 200); } catch {} net.push(`${r.status()} ${r.request().method()} ${u.replace('http://127.0.0.1:3111', '').replace(/ticket=[^&]+/, 'ticket=…').slice(0, 80)} ${b}`); } });
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const vis = (re) => page.getByRole('button', { name: re }).locator('visible=true').first();
const visibleButtons = async () => [...new Set(await page.locator('[role=button]:visible, button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean)))];
try {
  await step('Home streams without 403', async () => {
    await page.goto(APP_URL + '/', { waitUntil: 'domcontentloaded' });
    await sleep(12000);
    await shot(page, 'companion-home');
    const t = await body();
    if (/needs the .read:activity|Retry/i.test(t)) throw new Error('strip shows rejected scope: ' + t.slice(0, 200));
    return net.join(' | ');
  });
  await step('chat: Terminal pane locked with reason', async () => {
    await page.goto(APP_URL + process.argv[2], { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    await page.getByText(/^Terminal$/).locator('visible=true').first().click();
    await sleep(2000);
    await shot(page, 'companion-terminal-locked');
    const t = await body();
    if (!/request access|withheld|not enabled|permission/i.test(t)) throw new Error('no lock reason: ' + t.slice(0, 200));
    return (await visibleButtons()).filter((x) => /request/i.test(x)).join(', ');
  });
  await step('request access sheet → send request', async () => {
    await page.goto(APP_URL + '/scope-request', { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await shot(page, 'companion-scope-request');
    const b = await visibleButtons();
    console.log('  buttons:', JSON.stringify(b.slice(0, 16)));
    const send = page.getByRole('button', { name: /request access|send request|request/i }).locator('visible=true').last();
    await send.click({ timeout: 8000 });
    await sleep(3500);
    await shot(page, 'companion-scope-request-sent');
    return (await body()).slice(0, 220) + ' :: ' + net.filter((l) => /scope-requests/.test(l)).join(' | ');
  });
  await step('Security shows pending request', async () => {
    await page.goto(APP_URL + '/settings/security', { waitUntil: 'domcontentloaded' });
    await sleep(4500);
    await shot(page, 'companion-security');
    return (await body()).replace(/.*What this device/, '').slice(0, 300);
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
