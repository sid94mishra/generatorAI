// Builds and installs the GeneratorAI red agent-cursor theme.
//
// The driver's overlay renderer accepts a narrow Lottie subset: ungrouped
// shape items only (`sh`/`fl`/`st`), a 128x128 canvas at 30 fps, and one
// animation per action. `cua-driver-actions-v2` requires all twelve actions.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagedDir = path.join(
  repoRoot,
  'apps',
  'desktop',
  'resources',
  'cua-driver',
  `${process.platform}-${process.arch}`,
);

const ACTIONS = [
  'idle',
  'observe',
  'click',
  'drag',
  'scroll',
  'text',
  'key',
  'navigate',
  'app',
  'transfer',
  'record',
  'system',
];

// Per-action pulse so the user can tell "thinking" from "acting" at a glance.
const PULSE = {
  idle: { from: 100, to: 100 },
  observe: { from: 100, to: 112 },
  click: { from: 100, to: 78 },
  drag: { from: 100, to: 108 },
  scroll: { from: 100, to: 106 },
  text: { from: 100, to: 104 },
  key: { from: 100, to: 104 },
  navigate: { from: 100, to: 110 },
  app: { from: 100, to: 110 },
  transfer: { from: 100, to: 106 },
  record: { from: 100, to: 114 },
  system: { from: 100, to: 108 },
};

const RED = [0.898, 0.11, 0.141, 1];
const SCALE = 2.6;
const OUTLINE = [[0, 0], [0, 34], [9, 26], [15, 40], [22, 37], [16, 23], [27, 23]].map(
  ([x, y]) => [Math.round(x * SCALE * 100) / 100, Math.round(y * SCALE * 100) / 100],
);
const TANGENTS = OUTLINE.map(() => [0, 0]);

function animation(action) {
  const pulse = PULSE[action] ?? { from: 100, to: 100 };
  const scale =
    pulse.from === pulse.to
      ? { a: 0, k: [pulse.from, pulse.from, 100] }
      : {
          a: 1,
          k: [
            { t: 0, s: [pulse.from, pulse.from, 100], i: { x: [0.3], y: [1] }, o: { x: [0.7], y: [0] } },
            { t: 15, s: [pulse.to, pulse.to, 100], i: { x: [0.3], y: [1] }, o: { x: [0.7], y: [0] } },
            { t: 30, s: [pulse.from, pulse.from, 100] },
          ],
        };

  return {
    v: '5.9.0',
    fr: 30,
    ip: 0,
    op: 30,
    w: 128,
    h: 128,
    nm: `generatorai-red-${action}`,
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: action,
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [0, 0, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: scale,
        },
        ao: 0,
        shapes: [
          { ty: 'sh', nm: 'path', ks: { a: 0, k: { c: true, v: OUTLINE, i: TANGENTS, o: TANGENTS } } },
          { ty: 'fl', nm: 'fill', c: { a: 0, k: RED }, o: { a: 0, k: 100 }, r: 1 },
          {
            ty: 'st',
            nm: 'stroke',
            c: { a: 0, k: [1, 1, 1, 1] },
            o: { a: 0, k: 100 },
            w: { a: 0, k: 4 },
            lc: 2,
            lj: 2,
          },
        ],
        ip: 0,
        op: 30,
        st: 0,
        bm: 0,
      },
    ],
  };
}

function themeJson(version) {
  return {
    schema: 'cua.cursor-theme/2',
    id: 'generatorai.red',
    name: 'GeneratorAI Red',
    version,
    author: 'GeneratorAI',
    license: 'MIT',
    compatibility: { profile: 'cua-driver-actions-v2', semantics: 2 },
    canvas: { width: 128, height: 128, fps: 30 },
    hotspot: { x: 0, y: 0 },
    actions: Object.fromEntries(ACTIONS.map((a) => [a, { animation: a }])),
    variants: {},
  };
}

function zip(sourceDir, destination) {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${destination}' -Force`,
    ],
    { stdio: 'inherit' },
  );
}

function cursorThemeExe() {
  const exe = process.platform === 'win32' ? 'cua-cursor-theme.exe' : 'cua-cursor-theme';
  const staged = path.join(stagedDir, exe);
  if (!fs.existsSync(staged)) {
    throw new Error(`cursor theme builder not staged at ${staged} — run scripts/fetch-cua-driver.mjs first`);
  }
  return staged;
}

const driverVersion = fs.readFileSync(path.join(stagedDir, '.version'), 'utf8').trim();

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-cursor-'));
fs.mkdirSync(path.join(work, 'src', 'cua'), { recursive: true });
fs.mkdirSync(path.join(work, 'src', 'a'), { recursive: true });

for (const action of ACTIONS) {
  fs.writeFileSync(path.join(work, 'src', 'a', `${action}.json`), JSON.stringify(animation(action)));
}
fs.writeFileSync(
  path.join(work, 'src', 'manifest.json'),
  JSON.stringify({
    version: '1.0',
    generator: 'generatorai',
    animations: ACTIONS.map((id) => ({ id })),
  }),
);
fs.writeFileSync(
  path.join(work, 'src', 'cua', 'theme.json'),
  JSON.stringify(themeJson('1.0.0'), null, 2),
);

const source = path.join(work, 'generatorai-red.lottie');
zip(path.join(work, 'src'), path.join(work, 'generatorai-red.zip'));
fs.renameSync(path.join(work, 'generatorai-red.zip'), source);

const exe = cursorThemeExe();
console.log(execFileSync(exe, ['validate', source], { encoding: 'utf8' }).trim());

const outDir = path.join(repoRoot, 'apps', 'desktop', 'resources', 'cursor-themes');
fs.mkdirSync(outDir, { recursive: true });
const built = path.join(outDir, 'generatorai-red.cua-theme');
execFileSync(exe, ['build', source, '--output', built], { stdio: 'inherit' });

if (process.argv.includes('--install')) {
  execFileSync(exe, ['install', built], { stdio: 'inherit' });
  console.log(execFileSync(exe, ['list', '--json'], { encoding: 'utf8' }).trim());
}

console.log(`built ${built} against driver ${driverVersion}`);
fs.rmSync(work, { recursive: true, force: true });
