// Interactive walkthrough — attaches to the running desktop app via its
// loopback CDP endpoint and drives the full browser panel flow, saving
// PNG screenshots at each step so the user can eyeball the result.
//
// Usage:
//   node scripts/drive-browser-feature.mjs <cdpEndpoint>
// Example:
//   node scripts/drive-browser-feature.mjs http://127.0.0.1:57964

import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs/promises';

const cdp = process.argv[2] ?? 'http://127.0.0.1:57964';
const OUT = path.resolve(process.cwd(), 'agent-tests', 'test-results', 'desktop-browser-walkthrough');
await fs.mkdir(OUT, { recursive: true });

const results = [];
const step = async (label, fn) => {
  process.stdout.write(`▶ ${label} … `);
  const started = Date.now();
  try {
    const info = await fn();
    console.log(`OK (${Date.now() - started}ms)${info ? ' — ' + info : ''}`);
    results.push({ label, ok: true, info });
  } catch (e) {
    console.log(`FAIL: ${e?.message ?? e}`);
    results.push({ label, ok: false, info: String(e).slice(0, 200) });
    throw e;
  }
};

const browser = await chromium.connectOverCDP(cdp);
const ctx = browser.contexts()[0];
if (!ctx) throw new Error('No context on CDP endpoint');
let page = ctx.pages().find((p) => p.url().startsWith('http://127.0.0.1') || p.url().startsWith('http://localhost'));
if (!page) throw new Error('No SPA page found');
console.log(`attached to ${page.url()}`);

const shot = async (n, name) => {
  const file = path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${path.relative(process.cwd(), file)}`);
};

/**
 * Return the URL of the WCV for the given workspace by finding the page
 * whose URL is NOT localhost (SPA), NOT about:blank, and NOT a marker
 * fragment. If multiple candidate pages exist (older accumulated WCVs
 * from previous runs of this driver), return them all so the caller can
 * disambiguate.
 */
const wcvUrls = () => {
  const urls = [];
  for (const c of browser.contexts()) for (const p of c.pages()) {
    const u = p.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) continue;
    urls.push(u);
  }
  return urls;
};


await step('SPA loaded', async () => {
  await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 15_000 });
  return page.url();
});
await shot(1, 'spa-loaded');

await step('bridge available', async () => {
  const val = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const api = /** @type {any} */ (window).generatoraiDesktop;
    if (!api?.browser?.available) return { present: false };
    return { present: true, available: await api.browser.available() };
  });
  if (!val.available) throw new Error('bridge unavailable');
  return JSON.stringify(val);
});

await step('navigate to /chats', async () => {
  await page.evaluate(() => {
    window.history.pushState({}, '', '/chats');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(1500);
});
await shot(2, 'chats-list');

let chatId = null;
await step('open a chat', async () => {
  const btn = await page.$('button:has-text("Browser test chat"), button:has-text("Test")');
  if (btn) await btn.click();
  else {
    const created = await page.evaluate(async () => {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'walkthrough ' + Date.now(), model: 'claude-sonnet-4.6' }),
      });
      const data = await res.json();
      return data.id ?? data.chat?.id;
    });
    await page.evaluate((id) => {
      window.history.pushState({}, '', `/chats/${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, created);
  }
  await page.waitForTimeout(1500);
  const m = page.url().match(/\/chats\/([^/?#]+)/);
  chatId = m?.[1] ?? null;
  if (!chatId) throw new Error('chat not opened');
  return chatId;
});
await shot(3, 'chat-open');

await step('open Browser panel', async () => {
  await page.waitForSelector('button:has-text("Browser")', { timeout: 15_000 });
  await page.click('button:has-text("Browser")');
  await page.waitForFunction(() => document.body.textContent?.includes('Integrated Browser'), { timeout: 10_000 });
});
await shot(4, 'browser-panel-open');

await step('type URL & Start (native WCV)', async () => {
  await page.fill('input[placeholder*="https"]', 'https://example.com');
  const startBtn = await page.$('button:has-text("Start")');
  if (startBtn) await startBtn.click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('div,span')).some((e) => /· active/.test(e.textContent ?? '')),
  { timeout: 45_000 });
});
await page.waitForTimeout(2000);
await shot(5, 'session-active-example-com');

await step('native branch mounted', async () => {
  const el = await page.$('[aria-label="Native browser view"]');
  if (!el) throw new Error('NativeBrowserView not mounted');
  return 'aria-label present';
});

await step('WCV visible over shared CDP', async () => {
  const pages = [];
  for (const c of browser.contexts()) for (const p of c.pages()) pages.push(p.url());
  const hit = pages.some((u) => u.includes('example.com') || u.includes('#gai-'));
  if (!hit) throw new Error(`no example.com or marker page. urls=${JSON.stringify(pages)}`);
  return JSON.stringify(pages);
});

await step('navigate to Wikipedia (URL bar → Enter)', async () => {
  // Focus + retype so we can send Enter reliably.
  const bar = await page.$('input[placeholder*="https"]');
  if (!bar) throw new Error('URL bar not found');
  await bar.click();
  await bar.press('Control+A');
  await bar.type('https://en.wikipedia.org/wiki/Chromium_(web_browser)');
  await bar.press('Enter');
  // Wait for the WCV url to change over CDP.
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    for (const c of browser.contexts()) for (const p of c.pages()) {
      if (p.url().includes('en.wikipedia.org')) return p.url();
    }
    await page.waitForTimeout(400);
  }
  throw new Error('Wikipedia never appeared over CDP');
});
await page.waitForTimeout(2500);
await shot(6, 'wikipedia-loaded');

await step('reload button', async () => {
  const rl = await page.$('button[aria-label="Reload"]');
  if (rl) await rl.click();
  await page.waitForTimeout(1500);
});
await shot(7, 'after-reload');

await step('back button', async () => {
  const before = wcvUrls();
  const back = await page.$('button[aria-label="Back"]');
  if (!back) throw new Error('Back button not found');
  await back.click();
  // Poll for navigation completion via shared CDP. Wait for at least
  // one WCV URL that ISN'T wikipedia to appear (i.e. the current WCV
  // navigated somewhere new).
  const t0 = Date.now();
  let after = before;
  while (Date.now() - t0 < 15_000) {
    after = wcvUrls();
    if (after.some((u) => u.includes('example.com')) && after.length >= before.length) break;
    await page.waitForTimeout(200);
  }
  if (!after.some((u) => u.includes('example.com'))) {
    throw new Error(`back didn't restore example.com. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }
  // Give the placeholder-refresh debounce + capturePage time to
  // repaint the CSS background so the shot below reflects reality.
  await page.waitForTimeout(1500);
  return `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`;
});
await shot(8, 'after-back');

await step('forward button', async () => {
  const before = wcvUrls();
  const fwd = await page.$('button[aria-label="Forward"]');
  if (!fwd) throw new Error('Forward button not found');
  await fwd.click();
  const t0 = Date.now();
  let after = before;
  while (Date.now() - t0 < 15_000) {
    after = wcvUrls();
    if (after.some((u) => u.includes('wikipedia'))) break;
    await page.waitForTimeout(200);
  }
  if (!after.some((u) => u.includes('wikipedia'))) {
    throw new Error(`forward didn't restore wikipedia. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }
  await page.waitForTimeout(1500);
  return `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`;
});
await shot(9, 'after-forward');

await step('Stop session (cleanup)', async () => {
  const stop = await page.$('button:has-text("Stop")');
  if (stop) await stop.click();
  await page.waitForTimeout(1000);
});
await shot(10, 'after-stop');

console.log('\n=== summary ===');
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.label}${r.info ? ' — ' + r.info : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} steps passed. Screenshots saved to ${path.relative(process.cwd(), OUT)}/`);
process.exit(failed === 0 ? 0 : 1);
