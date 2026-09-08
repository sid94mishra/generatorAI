// Network timeline during a streaming turn. Usage: MSYS_NO_PATHCONV=1 node net2.mjs /chats/<id>
import { launch, APP_URL, sleep } from './lib.mjs';

const { ctx, page, consoleLog } = await launch();
const t0 = Date.now();
const lines = [];
const log = (s) => lines.push(`${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s ${s}`);
const short = (u) => u.replace('http://127.0.0.1:3111', '').replace(/ticket=[^&]+/, 'ticket=…').slice(0, 110);
page.on('request', (r) => { if (r.url().includes('/api/')) log(`→ ${r.method()} ${short(r.url())}`); });
page.on('response', (r) => { if (r.url().includes('/api/')) log(`← ${r.status()} ${r.request().method()} ${short(r.url())}`); });
page.on('requestfinished', (r) => { if (r.url().includes('/api/stream?')) log(`■ finished GET ${short(r.url())}`); });
page.on('requestfailed', (r) => { if (r.url().includes('/api/')) log(`✗ ${r.method()} ${short(r.url())} ${r.failure()?.errorText}`); });
await page.goto(APP_URL + (process.argv[2] ?? '/'), { waitUntil: 'domcontentloaded' });
await sleep(6000);
log('--- sending prompt');
const field = page.locator('textarea').last();
await field.click();
await field.fill('Count from 1 to 25, one number per line, no tools.');
await page.getByRole('button', { name: /^send$/i }).first().click();
await sleep(45000);
console.log(lines.filter((l) => !/health|chats\?|models|\/interactions|\/messages|\/plans|\/tasks|changes|posture|devices/.test(l) || /stream/.test(l)).slice(0, 60).join('\n'));
console.log('\nconsole:', consoleLog.filter((l) => !/deprecated|expo-notifications|localStorage/.test(l)).slice(0, 12).join('\n  ') || '(clean)');
await ctx.close();
