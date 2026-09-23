// Native Android interaction/evidence helper. This deliberately uses the
// installed app and accessibility hierarchy, not an Expo web viewport.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), 'Library/Android/sdk');
const adb = process.env.ADB ?? path.join(sdk, 'platform-tools/adb');
const out = process.env.E2E_OUT ?? path.join(os.tmpdir(), 'generatorai-native-audit');
fs.mkdirSync(out, { recursive: true });
const run = (args) => execFileSync(adb, args, { timeout: 45_000, maxBuffer: 12 * 1024 * 1024 });
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const decode = (s) => s.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
function hierarchy() {
  const dump = run(['shell', 'uiautomator', 'dump', '--compressed', '/sdcard/generatorai-audit.xml']).toString();
  // Android can return exit code 0 with "null root node" during a transition.
  // Never act on the previous dump, or count it as evidence for a new page.
  if (!dump.includes('/sdcard/generatorai-audit.xml')) throw new Error(`No fresh accessibility hierarchy: ${dump.trim()}`);
  const xml = run(['shell', 'cat', '/sdcard/generatorai-audit.xml']).toString();
  return [...xml.matchAll(/<node\s+([^>]+)>/g)].map((match) => {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
    const b = attrs.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)?.slice(1).map(Number);
    return { text: attrs.text, label: attrs['content-desc'], package: attrs.package, enabled: attrs.enabled === 'true', clickable: attrs.clickable === 'true', bounds: b };
  });
}
const [action = 'inspect', value = 'screen'] = process.argv.slice(2);
if (action === 'tap' || action === 'longpress') {
  const nodes = hierarchy();
  const visible = nodes.filter((n) => n.bounds && n.bounds[2] > n.bounds[0] && n.bounds[3] > n.bounds[1]);
  const node = visible.find((n) => n.label === value) ?? visible.find((n) => n.text === value);
  if (!node?.bounds) throw new Error(`No native control named ${value}`);
  if (!node.enabled) throw new Error(`Native control is disabled: ${value}`);
  const expectedPackage = process.env.E2E_PACKAGE ?? 'dev.generatorai.app';
  if (node.package !== expectedPackage) throw new Error(`Refusing to operate ${node.package}; expected ${expectedPackage}`);
  const [l,t,r,b] = node.bounds;
  const x = String(Math.round((l+r)/2));
  const y = String(Math.round((t+b)/2));
  run(action === 'longpress'
    ? ['shell', 'input', 'swipe', x, y, x, y, '1000']
    : ['shell', 'input', 'tap', x, y]);
  console.log(`${action === 'longpress' ? 'Long-pressed' : 'Tapped'} ${value}`);
} else if (action === 'route') {
  if (!value.startsWith('/') || /[\s'"&]/.test(value)) throw new Error('Expected a simple app route');
  run(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', quote(`generatorai://${value.slice(1)}`), 'dev.generatorai.app']);
  console.log(`Opened ${value}`);
} else if (action === 'text') {
  run(['shell', 'input', 'text', quote(value.replaceAll(' ', '%s'))]);
  console.log('Entered text');
} else if (action === 'back') {
  run(['shell', 'input', 'keyevent', '4']);
} else if (action === 'inspect') {
  const name = value.replace(/[^a-zA-Z0-9_-]/g, '-');
  const nodes = hierarchy();
  fs.writeFileSync(path.join(out, `${name}.png`), run(['exec-out', 'screencap', '-p']));
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(nodes, null, 2));
  console.log(nodes.filter((n) => n.text || n.label));
} else {
  throw new Error('Use inspect NAME, tap LABEL, longpress LABEL, route /path, text VALUE, or back');
}
