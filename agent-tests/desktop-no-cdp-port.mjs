// Confirms the P0 security property: with the desktop app running, no CDP
// endpoint on loopback exposes the privileged SPA window. Uses plain Node
// (no PowerShell) so it is portable and has no quoting pitfalls.
import { _electron as electron } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import net from 'node:net';

const DESKTOP = path.resolve(process.cwd(), '..', 'apps', 'desktop');
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gai-sec3-'));

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userDataDir}`],
  cwd: DESKTOP,
  env: { ...process.env, GENERATORAI_DESKTOP_MODE: 'standalone', GENERATORAI_DESKTOP_NATIVE_BROWSER: '1' },
  timeout: 120000,
});
console.log('electron launched, main pid =', await app.evaluate(() => process.pid));

await new Promise((r) => setTimeout(r, 15000));
console.log('windows:', JSON.stringify(app.windows().map((w) => w.url())));

const candidates = [9222, 9223, 9224, 9225, 9229, 9333, 9334, 9335];
const probe = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: '127.0.0.1' });
  s.setTimeout(200);
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('timeout', () => { s.destroy(); resolve(false); });
  s.on('error', () => resolve(false));
});

const open = [];
for (const p of candidates) if (await probe(p)) open.push(p);
console.log('open candidate ports:', JSON.stringify(open));

const cdp = [];
for (const p of open) {
  try {
    const r = await fetch(`http://127.0.0.1:${p}/json/list`, { signal: AbortSignal.timeout(600) });
    if (!r.ok) continue;
    const targets = await r.json();
    const list = (Array.isArray(targets) ? targets : []).map((t) => t.url || '');
    const exposesSpa = list.some((u) => /^file:/.test(u) || /^http:\/\/127\.0\.0\.1:\d+\/(#|$|chats|projects)/.test(u));
    cdp.push({ port: p, targets: list.slice(0, 6), exposesSpa });
  } catch { /* not a CDP endpoint */ }
}
console.log('\nCDP endpoints found:', JSON.stringify(cdp, null, 2));

const bad = cdp.filter((c) => c.exposesSpa);
console.log(bad.length === 0
  ? '\n*** PASS - no CDP endpoint exposes the privileged SPA window ***'
  : `\n*** FAIL - SPA window reachable over CDP: ${JSON.stringify(bad)} ***`);

await app.close().catch(() => {});
process.exit(bad.length === 0 ? 0 : 1);
