// Notepad + Excel write-and-verify, counting how often the agent path would
// have needed to steal the foreground.
//
//   npx tsx agent-tests/computer-use-apps-e2e.mjs

import { setTimeout as sleep } from 'node:timers/promises';
import {
  ComputerService,
  CuaDriverBridge,
  NullComputerBridge,
  buildComputerToolSet,
} from '@generatorai/core';

const silent = { info() {}, warn() {}, error() {}, debug() {}, child: () => silent };

const service = new ComputerService(
  {
    create: async () => {},
    findByWorkspace: async () => [],
    findByStageRun: async () => [],
    delete: async () => {},
    deleteByWorkspace: async () => {},
  },
  { emit: async () => {} },
  silent,
  { find: async () => null, save: async () => {}, prompt: async () => 'allow_once' },
  { record: async () => {} },
  {
    enabled: true,
    allowSyntheticFallback: false,
    maxConcurrentSessions: 1,
    screenshotEveryAction: false,
    maxSnapshotElements: 600,
    maxSnapshotDepth: 16,
    screenshotMaxBytes: 900_000,
    screenshotMaxEdge: 1280,
    actionTimeoutMs: 30_000,
    consentTtlSeconds: 60,
    idleTimeoutMs: 900_000,
    extraBlockedBundleIds: [],
    extraBlockedNameFragments: [],
    extraBlockedExecutables: [],
    alwaysAllowedApps: [],
  },
  [new CuaDriverBridge({ logger: silent }), new NullComputerBridge()],
);

const tools = new Map(
  buildComputerToolSet({
    computerService: service,
    workspaceId: 'apps-e2e',
    workspaceRoot: process.cwd(),
  }).map((t) => [t.name, t]),
);
const call = (n, a = {}) => tools.get(n).handler(a);

let failures = 0;
let frontCalls = 0;
function check(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures += 1;
}

async function bringToFront(appId) {
  frontCalls += 1;
  return call('computer_bring_to_front', { appId });
}

/** Element indices belong to one snapshot; re-find by identity, never by index. */
function findByLabel(snapshot, pattern, roles = /./) {
  return (snapshot.elements ?? []).find(
    (e) => roles.test(e.role) && pattern.test(`${e.label ?? ''} ${e.title ?? ''}`.trim()),
  );
}

async function driveNotepad() {
  console.log('\n── Notepad ──');
  const launched = await call('computer_launch_app', { name: 'Notepad' });
  if (!launched.ok) {
    console.log(`SKIP  could not launch Notepad: ${launched.message ?? ''}`);
    return;
  }
  await sleep(2500);

  // Deliberately NO bring_to_front: the point is that a background write works.
  const snap = await call('computer_snapshot', { appId: launched.appId });
  if (!snap.ok) {
    check('notepad snapshot', false, `${snap.refusal} ${snap.message ?? ''}`);
    return;
  }
  const editor = findByLabel(snap, /text editor/i, /document|edit/i);
  if (!editor) {
    check('notepad editor element found', false, `${snap.elementCount} elements`);
    return;
  }

  const marker = `NOTEPAD-${Date.now()}`;
  const write = await call('computer_set_value', {
    appId: launched.appId,
    snapshotId: snap.snapshotId,
    elementIndex: editor.index,
    value: marker,
  });
  check('notepad write accepted', write.ok === true, `${write.refusal ?? ''} ${write.message ?? ''}`);
  check('notepad write used accessibility, not synthetic', write.path === 'accessibility', `path=${write.path}`);

  await sleep(800);
  const after = await call('computer_snapshot', { appId: launched.appId });
  const reread = findByLabel(after, /text editor/i, /document|edit/i);
  check(
    'notepad content reads back',
    String(reread?.value ?? '').includes(marker),
    JSON.stringify(String(reread?.value ?? '').slice(0, 60)),
  );
}

async function driveExcel() {
  console.log('\n── Excel ──');
  const launched = await call('computer_launch_app', { name: 'Excel' });
  if (!launched.ok) {
    console.log(`SKIP  could not launch Excel: ${launched.message ?? ''}`);
    return;
  }
  // Excel shows a start screen before the grid exists.
  await sleep(6000);

  let snap = await call('computer_snapshot', { appId: launched.appId });
  if (!snap.ok) {
    check('excel snapshot', false, `${snap.refusal} ${snap.message ?? ''}`);
    return;
  }
  console.log(`  start screen: ${snap.elementCount} elements — "${snap.window.title}"`);

  const blank = (snap.elements ?? []).find((e) =>
    /blank workbook/i.test(`${e.label ?? ''} ${e.title ?? ''}`),
  );
  if (blank) {
    const opened = await call('computer_click', {
      appId: launched.appId,
      snapshotId: snap.snapshotId,
      elementIndex: blank.index,
    });
    check('excel opened a blank workbook', opened.ok === true, opened.message ?? '');
    await sleep(6000);
    snap = await call('computer_snapshot', { appId: launched.appId });
  }

  if (!snap.ok) {
    check('excel grid snapshot', false, `${snap.refusal} — ${snap.message ?? ''}`);
    return;
  }
  console.log(`  grid: ${snap.elementCount} elements — "${snap.window.title}"`);

  // Cells are exposed individually as DataItems labelled A1, B1, … — no need to
  // go through the Name Box or the formula bar at all.
  if (!findByLabel(snap, /^A1$/i, /dataitem/i)) {
    console.log(
      `SKIP  no addressable cells among ${snap.elementCount} elements — ` +
        'Excel is not drivable through UIA on this machine',
    );
    return;
  }

  // A write to a minimised window is the one case proven to vanish on restore,
  // so the guard refuses it and this is a legitimate reason to take focus.
  const wins = await call('computer_list_windows', { appId: launched.appId });
  if ((wins.windows ?? []).some((w) => w.minimised)) {
    await bringToFront(launched.appId);
    await sleep(1500);
    snap = await call('computer_snapshot', { appId: launched.appId });
  }
  const cell = findByLabel(snap, /^A1$/i, /dataitem/i);
  if (!cell) {
    check('excel cell A1 still present after restore', false, `${snap.elementCount} elements`);
    return;
  }

  const marker = `EXCEL-${Date.now()}`;
  const write = await call('computer_set_value', {
    appId: launched.appId,
    snapshotId: snap.snapshotId,
    elementIndex: cell.index,
    value: marker,
  });
  check('excel A1 write accepted', write.ok === true, `${write.refusal ?? ''} ${write.message ?? ''}`);

  // Excel accepts the write, reports success, and echoes the value back on
  // every later read while the cell stays visibly empty. Verified by screenshot
  // on 2026-08-13. So the ONLY correct assertions here are that the tool told
  // the truth about not having confirmed it, and that it said how to check.
  check(
    'excel write is reported UNVERIFIED, not as success',
    write.verified === false,
    `verified=${write.verified}`,
  );
  check(
    'excel write carries the do-not-trust-read-back warning',
    typeof write.warning === 'string' && /Excel/i.test(write.warning),
    write.warning ? 'present' : 'MISSING',
  );

  await sleep(1500);
  const after = await call('computer_snapshot', { appId: launched.appId });
  const reread = findByLabel(after, /^A1$/i, /dataitem/i);
  console.log(
    `  note: A1 reads back as ${JSON.stringify(String(reread?.value ?? ''))} — ` +
      'the cell is empty on screen. This is the echo, not the value.',
  );
}

await driveNotepad();
await driveExcel();

console.log(`\nforeground steals (computer_bring_to_front calls): ${frontCalls}`);
console.log(failures === 0 ? 'Apps E2E: all checks passed.' : `Apps E2E: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
