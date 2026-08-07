// Focused diagnostic: why is the desktop renderer not auto-pairing?
// Run from agent-tests/:  node desktop-pairing-diagnostic.mjs
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

const DESKTOP = path.resolve(process.cwd(), '..', 'apps', 'desktop');
const ELECTRON = createRequire(path.join(DESKTOP, 'package.json'))('electron');

const app = await electron.launch({
  executablePath: ELECTRON,
  args: ['.'],
  cwd: DESKTOP,
  env: { ...process.env, GENERATORAI_DESKTOP_MODE: 'standalone' },
  timeout: 60000,
});

app.process().stdout?.on('data', (d) => {
  const s = d.toString();
  if (/pair|Pair|admin|token|error|ERROR/.test(s)) process.stdout.write(`[main] ${s}`);
});

let page = null;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline && !page) {
  for (const w of app.windows()) {
    const url = w.url();
    if (url.startsWith('http')) { page = w; break; }
  }
  if (!page) await new Promise((r) => setTimeout(r, 500));
}
if (!page) { console.log('NO PAGE'); await app.close(); process.exit(1); }

page.on('console', (m) => console.log(`[renderer:${m.type()}] ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => console.log(`[renderer:pageerror] ${String(e).slice(0, 300)}`));

const urlCounts = new Map();
page.on('request', (r) => {
  const u = r.url().replace(/^https?:\/\/[^/]+/, '');
  urlCounts.set(u, (urlCounts.get(u) ?? 0) + 1);
});

await page.waitForTimeout(12000);

console.log('\n=== TOP REQUESTED PATHS ===');
[...urlCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .forEach(([u, n]) => console.log(`${String(n).padStart(5)}  ${u}`));

const diag = await page.evaluate(async () => {
  const d = window.generatoraiDesktop;
  const out = {
    hasBridge: !!d,
    isDesktop: d?.isDesktop ?? null,
    hasRequestPairingCode: typeof d?.requestPairingCode,
    bodyText: document.body.innerText.slice(0, 200),
    catalog: localStorage.getItem('generatorai.connections'),
  };
  if (typeof d?.requestPairingCode === 'function') {
    try {
      const code = await d.requestPairingCode('Diagnostic');
      out.pairingCodeResult = code ? { keys: Object.keys(code) } : null;
    } catch (e) {
      out.pairingCodeError = String(e).slice(0, 300);
    }
  }
  return out;
});

console.log('\n=== DIAGNOSTIC ===');
console.log(JSON.stringify(diag, null, 2));

await app.close();
