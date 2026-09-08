import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';
const { ctx, page, consoleLog } = await launch();
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const visibleButtons = async () => [...new Set(await page.locator('[role=button]:visible, button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean)))];
try {
  await step('admin Security shows the request', async () => {
    await page.goto(APP_URL + '/settings/security', { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    await shot(page, 'admin-security');
    const t = await body();
    const i = t.indexOf('Access requests');
    if (i < 0) throw new Error('no Access requests section: ' + t.slice(0, 200));
    console.log('  buttons:', JSON.stringify((await visibleButtons()).filter((x) => /approve|deny|request/i.test(x))));
    return t.slice(i, i + 260);
  });
  await step('Approve → confirm', async () => {
    await page.getByRole('button', { name: /^approve/i }).locator('visible=true').first().click({ timeout: 8000 });
    await sleep(1500);
    await shot(page, 'admin-confirm');
    const b = await visibleButtons();
    console.log('  confirm buttons:', JSON.stringify(b.slice(-8)));
    const confirm = page.getByRole('button', { name: /^(approve|grant|confirm|allow)/i }).locator('visible=true').last();
    await confirm.click({ timeout: 8000 });
    await sleep(3500);
    await shot(page, 'admin-after-approve');
    const t = await body();
    return t.slice(t.indexOf('Access requests'), t.indexOf('Access requests') + 200);
  });
} finally {
  console.log('\nerrors:', consoleLog.filter((l) => /^\[(error|pageerror)\]/.test(l)).slice(0, 8).join('\n  ') || '(none)');
  summary();
  await ctx.close();
}
