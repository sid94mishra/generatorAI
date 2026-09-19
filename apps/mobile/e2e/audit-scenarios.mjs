// Live mobile UI scenarios. Seed definitions in an isolated server first;
// this harness performs user actions and asserts the resulting UI states.
import fs from 'node:fs';
import { launch, step, shot, summary, APP_URL, sleep, OUT } from './lib.mjs';
const fixtures = JSON.parse(fs.readFileSync(process.env.AUDIT_FIXTURES, 'utf8'));
const phase = process.argv[2] ?? 'workflow';
const { ctx, page, consoleLog } = await launch();
const visible = (locator) => locator.locator('visible=true').first();
const button = (name) => visible(page.getByRole('button', { name }));
const tap = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Control has no visible bounds');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(400);
};
const body = () => page.locator('body').innerText();
const requireText = async (text) => {
  await page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout: 20_000 });
};
try {
  if (phase === 'workflow') {
    await step('workflow dependencies and stage instructions', async () => {
      await page.goto(`${APP_URL}/workflows/${fixtures.workflow.id}`);
      await requireText('after Design');
      await requireText('after Implement');
      await requireText('after Validate');
      await shot(page, 'workflow-dependencies');
      await tap(button('Inspect Design'));
      await requireText('Instructions');
      await requireText('DESIGN.md');
      await shot(page, 'workflow-stage-inspector');
      await tap(button(/^Close$/));
    });
    await step('start workflow through mobile input sheet', async () => {
      await tap(button(/^Run…$|^Run workflow$/));
      const field = visible(page.locator('input'));
      await field.fill('incident severity rollups');
      await shot(page, 'workflow-inputs');
      await tap(button(/^Start run$/));
      await page.waitForURL(/\/runs\/[a-f0-9-]+$/, { timeout: 30_000 });
      fs.writeFileSync(`${OUT}/workflow-run-route.txt`, new URL(page.url()).pathname);
      await requireText('Stages');
      await shot(page, 'workflow-started');
      return new URL(page.url()).pathname;
    });
  } else if (phase === 'panes') {
    await page.goto(`${APP_URL}/chats/${fixtures.chatId}`);
    await requireText('Chat');
    for (const label of ['Changes', 'Files', 'Terminal', 'Browser', 'Chat']) {
      await step(`chat pane: ${label}`, async () => {
        await tap(visible(page.getByRole('tab', { name: new RegExp(`^${label}(,|$)`) })));
        await sleep(1600);
        const text = await body();
        if (/Something went wrong|Unmatched Route/.test(text)) throw new Error(text);
        await shot(page, `pane-${label.toLowerCase()}`);
        return text.slice(-350).replace(/\s+/g, ' ');
      });
    }
    await step('turn setup and attachment actions', async () => {
      await tap(button(/^Turn setup:/));
      await requireText('High');
      await shot(page, 'turn-setup');
      await tap(button(/^Close$/));
      await tap(button(/^Add attachment$/));
      await shot(page, 'attachment-actions');
      await tap(button(/^Cancel$/));
    });
  } else if (phase === 'automation') {
    await page.goto(`${APP_URL}/automations/${fixtures.automation.id}`);
    await requireText('Run now');
    await step('manual automation detail and trigger', async () => {
      await shot(page, 'automation-before');
      const triggered = page.waitForResponse((response) => response.url().endsWith(`/automations/${fixtures.automation.id}/trigger`) && response.request().method() === 'POST');
      await tap(button(/^Run now$/));
      const response = await triggered;
      if (!response.ok()) throw new Error(`Automation trigger returned ${response.status()}`);
      await sleep(3500);
      await requireText('History');
      if ((await body()).includes('No executions yet')) throw new Error('Triggered execution is missing from history');
      await shot(page, 'automation-triggered');
      return (await body()).slice(-600).replace(/\s+/g, ' ');
    });
  } else {
    throw new Error(`Unknown audit phase ${phase}`);
  }
} finally {
  const errors = consoleLog.filter((line) => /^\[(error|pageerror)\]/.test(line));
  fs.writeFileSync(`${OUT}/audit-${phase}-console.json`, JSON.stringify(errors, null, 2));
  console.log('Console errors:', errors);
  if (!summary() || errors.length) process.exitCode = 1;
  await ctx.close();
}
