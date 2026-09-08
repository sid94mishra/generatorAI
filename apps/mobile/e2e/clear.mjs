// Deny every stale pending gate from the Approvals sheet (also exercises Deny + optimistic removal).
import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
try {
  await step('open approvals', async () => {
    await page.goto(APP_URL + '/approvals', { waitUntil: 'domcontentloaded' });
    await sleep(4500);
    await shot(page, 'approvals-before');
    return (await body()).slice(0, 120);
  });
  for (let i = 0; i < 6; i++) {
    const deny = page.getByRole('button', { name: /^deny$/i }).locator('visible=true').first();
    if (!(await deny.count())) break;
    await step(`deny #${i + 1}`, async () => {
      await deny.click({ timeout: 8000 });
      await sleep(2500);
      return (await body()).slice(0, 100);
    });
  }
  await shot(page, 'approvals-after');
  await step('none left', async () => {
    const t = await body();
    if (!/Nothing is waiting/i.test(t)) throw new Error('still waiting: ' + t.slice(0, 200));
    return 'clear';
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
