// Real-user chat flow: New chat → send prompt → watch streaming → stop/inspect.
import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';

const { ctx, page, consoleLog } = await launch();
const dump = async (label) => {
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log(`  [${label}] ${text.slice(0, 400)}`);
  return text;
};
const buttons = async () => {
  const names = await page.locator('[role=button], button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean));
  console.log('  buttons:', JSON.stringify([...new Set(names)].slice(0, 40)));
};
try {
  await step('open chats tab', async () => {
    await page.goto(APP_URL + '/chats', { waitUntil: 'domcontentloaded' });
    await sleep(3500);
  });
  await step('open New chat sheet', async () => {
    await page.getByRole('button', { name: /new chat/i }).first().click();
    await sleep(1500);
    await shot(page, 'new-chat-sheet');
    await dump('sheet');
    await buttons();
  });
  await step('create chat', async () => {
    const nameField = page.getByPlaceholder(/what is this chat about/i).first();
    if (await nameField.count()) await nameField.fill('Mobile E2E ' + new Date().toISOString().slice(11, 19));
    const create = page.getByRole('button', { name: /^(create|start|start chat|create chat)$/i }).first();
    await create.click({ timeout: 8000 });
    await sleep(5000);
    await shot(page, 'chat-created');
    await dump('chat');
    await buttons();
    return page.url();
  });
  await step('send prompt', async () => {
    const field = page.locator('textarea').last();
    await field.click();
    await field.fill('Reply with exactly three short bullet points about what a mobile client for an agent should do. Do not use any tools.');
    await sleep(300);
    await shot(page, 'typed');
    const send = page.getByRole('button', { name: /^send$/i }).first();
    await send.click({ timeout: 8000 });
    await sleep(2000);
    await shot(page, 'sent');
  });
  await step('watch streaming (up to 90s)', async () => {
    let last = '';
    for (let i = 0; i < 18; i++) {
      await sleep(5000);
      const text = await page.locator('body').innerText();
      if (i % 3 === 0) await shot(page, `stream-${i}`);
      if (/•|- |1\./.test(text) && !/Working…|Thinking…/.test(text) && text !== last && i > 1) { last = text; break; }
      last = text;
    }
    await shot(page, 'final');
    return (await dump('final')).slice(0, 200);
  });
  await step('open pane strip / more', async () => {
    await buttons();
  });
} finally {
  const errs = consoleLog.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log('\nerrors:', errs.slice(0, 12).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
