// Builds and installs the GeneratorAI agent-cursor theme: a red arrow with a
// "GAI" badge, so the person can tell the agent's pointer from their own at a
// glance while theirs stays free.
//
// The driver's overlay renderer accepts a narrow Lottie subset: ungrouped
// shape items only (`sh`/`fl`/`st`), a 128x128 canvas at 30 fps, and one
// animation per action. `cua-driver-actions-v2` requires all twelve actions.
// A fill paints every path before it in its layer, so the arrow, the badge and
// the letters are separate layers (the first layer is drawn on top).
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

// The badge sits below and right of the tip, clear of the hotspot at (0, 0).
const BADGE_FILL = [0.11, 0.11, 0.13, 1];
const WHITE = [1, 1, 1, 1];
const BADGE = roundedRect(58, 74, 66, 30, 9);
// "GAI" as open strokes, 16 px tall.
const LETTERS = [
  [[80, 85], [77, 82], [69, 82], [65, 86], [65, 94], [69, 98], [77, 98], [80, 95], [80, 91], [73, 91]], // G
  [[85, 98], [92, 82], [99, 98]], // A
  [[88, 93], [96, 93]], // A crossbar
  [[105, 82], [113, 82]], // I top
  [[109, 82], [109, 98]], // I stem
  [[105, 98], [113, 98]], // I foot
];

function roundedRect(x, y, w, h, r) {
  const k = r * 0.5523;
  // Clockwise from the top edge, two vertices per corner with bezier handles.
  const v = [
    [x + r, y], [x + w - r, y], [x + w, y + r], [x + w, y + h - r],
    [x + w - r, y + h], [x + r, y + h], [x, y + h - r], [x, y + r],
  ];
  const zero = [0, 0];
  const i = [[-k, 0], zero, [0, -k], zero, [k, 0], zero, [0, k], zero];
  const o = [zero, [k, 0], zero, [0, k], zero, [-k, 0], zero, [0, -k]];
  return { v, i, o };
}

function pathItem(nm, points, closed, handles) {
  const flat = points.map(() => [0, 0]);
  return {
    ty: 'sh',
    nm,
    ks: { a: 0, k: { c: closed, v: points, i: handles?.i ?? flat, o: handles?.o ?? flat } },
  };
}

function layer(ind, nm, scale, shapes) {
  return {
    ddd: 0,
    ind,
    ty: 4,
    nm,
    sr: 1,
    ks: {
      o: { a: 0, k: 100 },
      r: { a: 0, k: 0 },
      p: { a: 0, k: [0, 0, 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: scale,
    },
    ao: 0,
    shapes,
    ip: 0,
    op: 30,
    st: 0,
    bm: 0,
  };
}

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
      layer(1, `${action}-letters`, scale, [
        ...LETTERS.map((points, n) => pathItem(`letter-${n}`, points, false)),
        { ty: 'st', nm: 'letters', c: { a: 0, k: WHITE }, o: { a: 0, k: 100 }, w: { a: 0, k: 3.2 }, lc: 2, lj: 2 },
      ]),
      layer(2, `${action}-badge`, scale, [
        pathItem('badge', BADGE.v, true, BADGE),
        { ty: 'fl', nm: 'badge-fill', c: { a: 0, k: BADGE_FILL }, o: { a: 0, k: 92 }, r: 1 },
        { ty: 'st', nm: 'badge-edge', c: { a: 0, k: RED }, o: { a: 0, k: 100 }, w: { a: 0, k: 2.5 }, lc: 2, lj: 2 },
      ]),
      layer(3, action, scale, [
        pathItem('path', OUTLINE, true, { i: TANGENTS, o: TANGENTS }),
        { ty: 'fl', nm: 'fill', c: { a: 0, k: RED }, o: { a: 0, k: 100 }, r: 1 },
        { ty: 'st', nm: 'stroke', c: { a: 0, k: WHITE }, o: { a: 0, k: 100 }, w: { a: 0, k: 4 }, lc: 2, lj: 2 },
      ]),
    ],
  };
}

function themeJson(version) {
  return {
    schema: 'cua.cursor-theme/2',
    id: 'generatorai.red',
    name: 'GeneratorAI (GAI)',
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
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${destination}' -Force`,
      ],
      { stdio: 'inherit' },
    );
    return;
  }
  // The archive root must be the source folder's contents (manifest.json at the top).
  execFileSync('zip', ['-r', '-X', '-q', destination, '.'], { cwd: sourceDir, stdio: 'inherit' });
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
  JSON.stringify(themeJson('1.1.0'), null, 2),
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
