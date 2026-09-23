// Workbench (header button → tool index → tool sheet) + Stop on an existing chat. Usage: MSYS_NO_PATHCONV=1 node panes.mjs /chats/<id>
import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const vis = (re) => page.getByRole('button', { name: re }).locator('visible=true').first();
const visibleButtons = async () => [...new Set(await page.locator('[role=button]:visible, button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)).filter(Boolean)))];
// Open a tool: the header's Workbench button slides the index in from the
// right; picking a row raises that tool as a sheet. When a tool sheet is
// already up, its chip strip switches tool in place.
const tool = async (id, label) => {
  const chip = page.getByRole('button', { name: new RegExp(`^${label}\\.`) }).locator('visible=true').first();
  if (await chip.count()) { await chip.click({ timeout: 8000 }); await sleep(2000); return; }
  await page.getByTestId('workbench-button').locator('visible=true').first().click({ timeout: 8000 });
  await sleep(900);
  await page.getByTestId(`workbench-tool-${id}`).locator('visible=true').first().click({ timeout: 8000 });
  await sleep(2000);
};
const closeSheet = async () => { await vis(/^close$/i).click().catch(() => {}); await sleep(800); };
try {
  await step('open chat', async () => {
    await page.goto(APP_URL + process.argv[2], { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    return (await body()).slice(0, 100);
  });
  await step('Changes pane', async () => {
    await vis(/^review changes/i).click();
    await sleep(2000);
    await shot(page, 'changes-pane');
    return (await body()).slice(0, 220);
  });
  await step('open hello.txt diff', async () => {
    await vis(/^added hello\.txt/i).click();
    await sleep(2000);
    await shot(page, 'file-inline');
    await vis(/^open hello\.txt full screen/i).click();
    await sleep(2500);
    await shot(page, 'file-diff');
    return (await body()).slice(0, 220);
  });
  await step('Terminal tool', async () => {
    await tool('terminal', 'Terminal');
    await sleep(2000);
    await shot(page, 'terminal-pane');
    return (await body()).slice(0, 200) + ' | ' + (await visibleButtons()).slice(0, 12).join(', ');
  });
  await step('Browser tool', async () => {
    await tool('browser', 'Browser');
    await sleep(2000);
    await shot(page, 'browser-pane');
    return (await body()).slice(0, 200);
  });
  await step('Workbench: Files / Plan / Session', async () => {
    for (const [id, label] of [['files', 'Files'], ['plan', 'Plan'], ['session', 'Session']]) {
      await tool(id, label).catch(() => {});
      await shot(page, `tool-${id}`);
    }
    const t = (await body()).slice(-300);
    await closeSheet();
    return t;
  });
  await step('Stop mid-turn', async () => {
    const field = page.locator('textarea:visible').last();
    await field.click();
    await field.fill('Count from 1 to 300 slowly, one number per line. No tools.');
    await vis(/^send$/i).click();
    for (let i = 0; i < 12; i++) { await sleep(5000); if ((await visibleButtons()).includes('Stop')) break; }
    await sleep(8000);
    await shot(page, 'streaming');
    await vis(/^stop$/i).click();
    await sleep(1500);
    await shot(page, 'after-stop-1');
    for (let i = 0; i < 12; i++) { await sleep(5000); const b = await visibleButtons(); if (!b.includes('Stop')) break; }
    await shot(page, 'after-stop-final');
    return (await visibleButtons()).filter((x) => /stop|send/i.test(x)).join(' | ') + ' :: ' + (await body()).slice(-220);
  });
  await step('long-press a row → context menu', async () => {
    const row = page.getByText(/Count from 1 to 300/).locator('visible=true').first();
    const box = await row.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await sleep(900);
    await page.mouse.up();
    await sleep(1000);
    await shot(page, 'context-menu');
    return (await visibleButtons()).slice(-8).join(', ');
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
