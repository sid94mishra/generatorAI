// Walk every surface of the v2 app and screenshot it, collecting console errors.
import { launch, step, shot, summary, APP_URL, sleep } from './lib.mjs';

const { ctx, page, consoleLog } = await launch();
const routes = [
  ['home', '/'],
  ['chats', '/chats'],
  ['work-workflows', '/runs?segment=workflows'],
  ['work-runs', '/runs?segment=runs'],
  ['work-automations', '/runs?segment=automations'],
  ['work-scripts', '/runs?segment=scripts'],
  ['projects', '/projects'],
  ['projects-agents', '/projects?segment=agents'],
  ['approvals', '/approvals'],
  ['scope-request', '/scope-request'],
  ['settings', '/settings'],
  ['settings-security', '/settings/security'],
  ['settings-accessibility', '/settings/accessibility'],
  ['settings-appearance', '/settings/appearance'],
  ['settings-notifications', '/settings/notifications'],
  ['settings-capabilities', '/settings/capabilities'],
  ['settings-providers', '/settings/providers'],
  ['settings-diagnostics', '/settings/diagnostics'],
  ['settings-about', '/settings/about'],
];
const perRoute = {};
try {
  for (const [name, route] of routes) {
    const before = consoleLog.length;
    await step(name, async () => {
      await page.goto(APP_URL + route, { waitUntil: 'domcontentloaded' });
      await sleep(3500);
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160);
      await shot(page, name);
      perRoute[name] = consoleLog.slice(before).filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
      return text;
    });
  }
} finally {
  console.log('\nerrors per route:');
  for (const [k, v] of Object.entries(perRoute)) if (v.length) console.log(`  ${k}:\n    ${v.slice(0, 6).join('\n    ')}`);
  summary();
  await ctx.close();
}
