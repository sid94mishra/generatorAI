// node perm.mjs — reads Settings › Computer use › macOS permissions in the running app over CDP.
import { createRequire } from 'node:module';
const require = createRequire('/Users/sidmishra/Desktop/Projects/generatorAI/agent-tests/package.json');
const { chromium } = require('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9555');
const win = browser.contexts().flatMap((c) => c.pages()).find((p) => /^http:\/\/127\.0\.0\.1/.test(p.url()));
const origin = new URL(win.url()).origin;
console.log('connected', win.url());
await win.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => console.log('reload', e.message));
const s = win.getByTestId('computer-mac-permissions');
await s.waitFor({ timeout: 20000 }).catch(() => {});
await win.waitForTimeout(3000);
console.log((await s.innerText({ timeout: 5000 }).catch(() => 'no permissions section')).replace(/\n+/g, ' | '));
process.exit(0);
