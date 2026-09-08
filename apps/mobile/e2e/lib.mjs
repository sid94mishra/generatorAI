// Shared Playwright harness for driving the mobile app's Expo web preview at
// a phone viewport against the isolated server on :3111.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
// Resolve playwright-core from the monorepo root, wherever the repo lives.
const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../package.json'));
const { chromium, devices } = require('playwright-core');

export const APP_URL = process.env.APP_URL ?? 'http://localhost:8081';
export const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:3111';
export const OUT = process.env.E2E_OUT ?? path.resolve(process.env.E2E_HOME ?? 'C:/gaimob', 'e2e/shots');
export const PROFILE = process.env.E2E_PROFILE ?? path.resolve(process.env.E2E_HOME ?? 'C:/gaimob', 'profile');
// Playwright's bundled Chromium (the installed Chrome may refuse remote debugging under policy).
const CHROME = process.env.E2E_CHROME ?? 'C:/Users/sidmishra/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';

fs.mkdirSync(OUT, { recursive: true });

export const results = [];
export async function step(label, fn) {
  process.stdout.write(`▶ ${label} … `);
  const t = Date.now();
  try {
    const info = await fn();
    console.log(`OK (${Date.now() - t}ms)${info ? ' — ' + info : ''}`);
    results.push({ label, ok: true, info: info ?? '' });
    return info;
  } catch (e) {
    console.log(`FAIL: ${e?.message ?? e}`);
    results.push({ label, ok: false, info: String(e?.message ?? e).slice(0, 300) });
    throw e;
  }
}

let shotIndex = 0;
export async function shot(page, name) {
  const file = path.join(OUT, `${String(++shotIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${file}`);
  return file;
}

/**
 * iPhone-ish viewport (393×852 @3x, touch) with a persistent profile so the
 * paired device key (localStorage in the web shim) survives between scripts.
 */
export async function launch({ fresh = false, viewport } = {}) {
  if (fresh) fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: true,
    viewport: viewport ?? { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 14'].userAgent,
    args: ['--disable-gpu', '--no-first-run'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const console_ = [];
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') console_.push(`[${t}] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => console_.push(`[pageerror] ${String(e).slice(0, 300)}`));
  return { ctx, page, consoleLog: console_ };
}

export function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  for (const f of failed) console.log(`  ✗ ${f.label}: ${f.info}`);
  return failed.length === 0;
}

export function pairingUrl() {
  if (process.env.PAIR_URL) return process.env.PAIR_URL;
  if (process.env.PAIR_FILE) return fs.readFileSync(process.env.PAIR_FILE, 'utf8').trim();
  const j = JSON.parse(fs.readFileSync(path.resolve(process.env.E2E_HOME ?? 'C:/gaimob', 'data/bootstrap-pairing.json'), 'utf8'));
  return j.pairingUrl;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
