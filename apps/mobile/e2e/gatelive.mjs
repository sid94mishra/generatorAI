// Live gate in-chat: Ask-me permission mode → file-writing prompt → in-chat Allow → Changes pane → Stop mid-turn.
import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const vis = (re) => page.getByRole('button', { name: re }).locator('visible=true').first();
const visibleButtons = async () => [...new Set(await page.locator('[role=button]:visible, button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)).filter(Boolean)))];
const waitFor = async (label, pred, maxSec = 180) => {
  for (let i = 0; i < maxSec / 5; i++) {
    await sleep(5000);
    const b = await visibleButtons();
    const t = await body();
    if (pred(b, t)) return { b, t };
    if (i % 6 === 5) await shot(page, `${label}-wait${i}`);
  }
  await shot(page, `${label}-timeout`);
  throw new Error(`${label}: timeout; text=${(await body()).slice(0, 200)}`);
};
try {
  await step('new chat', async () => {
    await page.goto(APP_URL + '/', { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await vis(/^new chat$/i).click();
    await sleep(1200);
    await page.getByPlaceholder(/what is this chat about/i).first().fill('GateLive ' + new Date().toISOString().slice(11, 19));
    await vis(/^create chat$/i).click();
    await sleep(5000);
    return page.url();
  });
  await step('Turn options → Ask me', async () => {
    await vis(/^turn options$/i).click();
    await sleep(1000);
    await vis(/^ask me$/i).click();
    await sleep(800);
    await shot(page, 'turn-options-ask');
    await vis(/^close$/i).click();
    await sleep(800);
    return (await visibleButtons()).filter((x) => /options|permission/i.test(x)).join(' | ');
  });
  await step('send file-writing prompt', async () => {
    const field = page.locator('textarea:visible').last();
    await field.click();
    await field.fill('Create a file named hello.txt in the workspace containing the single line "hello from mobile". Use your file-writing tool.');
    await vis(/^send$/i).click();
    await sleep(1500);
  });
  await step('in-chat gate card appears', async () => {
    const r = await waitFor('gate', (b) => b.some((x) => /^allow$/i.test(x)), 180);
    await shot(page, 'gate-card-live');
    console.log('  gate buttons:', JSON.stringify(r.b.filter((x) => /allow|deny/i.test(x))));
    return r.t.slice(0, 200);
  });
  await step('Allow in chat', async () => {
    await vis(/^allow$/i).click();
    await sleep(1500);
    const r = await waitFor('done', (b, t) => !b.includes('Stop') && !/Working…|Thinking…/.test(t) && !b.some((x) => /^allow$/i.test(x)), 180);
    await shot(page, 'after-allow-final');
    return r.t.slice(0, 260);
  });
  await step('Changes pane', async () => {
    await vis(/^changes/i).click();
    await sleep(2500);
    await shot(page, 'changes-pane');
    const t = await body();
    return t.slice(0, 260);
  });
  await step('open file diff', async () => {
    const row = page.locator('[role=button]:visible', { hasText: /hello\.txt/ }).first();
    await row.click({ timeout: 8000 });
    await sleep(2500);
    await shot(page, 'file-diff');
    return (await body()).slice(0, 200);
  });
  await step('back to chat, Stop mid-turn', async () => {
    await vis(/^chat$/i).click().catch(() => {});
    await sleep(800);
    const field = page.locator('textarea:visible').last();
    await field.click();
    await field.fill('Count from 1 to 200 slowly, one number per line. No tools.');
    await vis(/^send$/i).click();
    await waitFor('streaming', (b) => b.includes('Stop'), 60);
    await sleep(6000);
    await vis(/^stop$/i).click();
    await sleep(1500);
    await shot(page, 'after-stop-1');
    const r = await waitFor('stopped', (b, t) => !b.includes('Stop') || /Stopped/i.test(t), 60);
    await shot(page, 'after-stop-final');
    return (await visibleButtons()).filter((x) => /stop|send/i.test(x)).join(' | ') + ' :: ' + r.t.slice(-200);
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
