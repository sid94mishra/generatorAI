import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
try {
  await step('phone: check for new permissions', async () => {
    await page.goto(APP_URL + '/settings/security', { waitUntil: 'domcontentloaded' });
    await sleep(4500);
    await page.getByRole('button', { name: /check for new permissions/i }).locator('visible=true').first().click({ timeout: 8000 });
    await sleep(3000);
    await shot(page, 'phone-security-after');
    const t = await body();
    if (!/Run terminal commands on your machine/.test(t.slice(0, t.indexOf('Pending') > 0 ? t.indexOf('Pending') : t.length))) return 'terminal scope text: ' + (t.includes('Run terminal commands') ? 'present' : 'absent');
    return 'terminal scope listed';
  });
  await step('phone: Terminal pane unlocked', async () => {
    await page.goto(APP_URL + process.argv[2], { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    await page.getByText(/^Terminal$/).locator('visible=true').first().click();
    await sleep(2500);
    await shot(page, 'phone-terminal-unlocked');
    const t = await body();
    if (/Terminal is not enabled/.test(t)) throw new Error('still locked');
    return t.match(/(No terminal open|New terminal|Confirm it.s you)[^.]{0,80}/)?.[0] ?? t.slice(0, 200);
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
