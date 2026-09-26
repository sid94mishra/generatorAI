// Focused diagnostic: why is the desktop renderer not auto-pairing?
// Run:  node agent-tests/desktop-pairing-diagnostic.mjs  (any cwd)
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DESKTOP_DIR as DESKTOP, isolatedProfile } from './helpers/desktop-profile.mjs';

// A fresh profile: never the developer's userData or vault key.
const profile = isolatedProfile('gai-pairing-diag-');
process.on('exit', profile.cleanup);
const ELECTRON = createRequire(path.join(DESKTOP, 'package.json'))('electron');

const app = await electron.launch({
  executablePath: ELECTRON,
  args: ['.', profile.arg],
  cwd: DESKTOP,
  env: { ...process.env, GENERATORAI_DESKTOP_MODE: 'standalone' },
  timeout: 60000,
});
// P2-R44 — hand the launched app to the profile helper so a SIGINT/SIGTERM
// that lands after this point can close Electron before removing the
// directory it may still hold files in.
profile.attach(app);

try {
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
  if (!page) {
    console.log('NO PAGE');
    process.exitCode = 1;
  } else {
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
  }
} finally {
  // P2-R44 — close before cleanup: the directory is only removed once
  // Electron (and the embedded server it spawned) has released its files.
  await app.close().catch(() => {});
  profile.cleanup();
}
