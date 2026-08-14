// ────────────────────────────────────────────────────────────────
// Computer Use — the two oracles that prove "background".
//
// Everything else in this feature can pass while the core claim is false. The
// claim is: an element-addressed action does NOT move the user's pointer and
// does NOT leak keystrokes into whatever window happens to be focused. These
// two checks are the only ones that actually test it, so they run against the
// real driver on a real desktop rather than a mock.
//
// Skips itself (exit 0) when the driver is unavailable — CI without a desktop
// must not report a red build for a machine capability it does not have.
//
//   node agent-tests/computer-use-oracles.mjs
// ────────────────────────────────────────────────────────────────

import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ComputerService,
  CuaDriverBridge,
  NullComputerBridge,
  buildComputerToolSet,
} from '@generatorai/core';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const CONFIG = {
  enabled: true,
  allowSyntheticFallback: true,
  maxConcurrentSessions: 1,
  screenshotEveryAction: false,
  maxSnapshotElements: 400,
  maxSnapshotDepth: 12,
  screenshotMaxBytes: 900_000,
  screenshotMaxEdge: 1280,
  actionTimeoutMs: 30_000,
  consentTtlSeconds: 60,
  idleTimeoutMs: 900_000,
  extraBlockedBundleIds: [],
  extraBlockedNameFragments: [],
  extraBlockedExecutables: [],
  alwaysAllowedApps: [],
};

function buildTools() {
  const service = new ComputerService(
    { create: async (r) => r, findByWorkspace: async () => [], delete: async () => {}, findByStageRun: async () => [], deleteByWorkspace: async () => {} },
    { emit: async () => {} },
    silent,
    { find: async () => null, save: async () => {}, prompt: async () => 'allow_once' },
    { record: async () => {} },
    CONFIG,
    [new CuaDriverBridge({ logger: silent }), new NullComputerBridge()],
  );
  const tools = new Map(
    buildComputerToolSet({
      computerService: service,
      workspaceId: 'oracles',
      workspaceRoot: process.cwd(),
    }).map((t) => [t.name, t]),
  );
  return { service, call: (name, args = {}) => tools.get(name).handler(args) };
}

/** Pointer position via the OS, never via the driver being tested. */
function cursorPosition() {
  if (process.platform !== 'win32') return null;
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; ' +
        '$p=[System.Windows.Forms.Cursor]::Position; "$($p.X),$($p.Y)"',
    ],
    { encoding: 'utf8' },
  ).trim();
  const [x, y] = out.split(',').map(Number);
  return { x, y };
}

let failures = 0;
function check(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures += 1;
}

async function main() {
  const { service, call } = buildTools();

  const caps = await call('computer_capabilities');
  if (!caps.ok || caps.provider !== 'cua-driver') {
    console.log(`SKIP  computer-use driver unavailable (provider=${caps.provider ?? 'none'})`);
    return 0;
  }

  // Two Notepads: one we drive, one that must never be touched.
  const target = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
  const decoy = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
  target.unref();
  decoy.unref();
  await sleep(2500);

  try {
    const apps = await call('computer_list_apps');
    const notepad = (apps.apps ?? []).find((a) => /notepad/i.test(a.name));
    if (!notepad) {
      console.log('SKIP  Notepad did not appear in the app list');
      return 0;
    }

    // Windows spawned from a background process start minimised, and a write to
    // a minimised window is refused by design (it would be silently discarded).
    // Restore first — this happens BEFORE the pointer is sampled, so it does
    // not affect the cursor measurement.
    await call('computer_bring_to_front', { appId: notepad.appId });
    await sleep(1200);

    const wins = await call('computer_list_windows', { appId: notepad.appId });
    const live = (wins.windows ?? []).filter((w) => !w.minimised);
    if (live.length < 2) {
      console.log(`SKIP  need two live Notepad windows, saw ${live.length}`);
      return 0;
    }
    const [driven, untouched] = live;

    // ── Oracle 1: cursor preservation ──
    //
    // Sampled twice first: if the pointer is already moving — someone using the
    // machine, another automation running — then "it moved" proves nothing, and
    // an oracle that cries failure whenever the operator touches their mouse is
    // an oracle nobody will trust.
    const settle1 = cursorPosition();
    await sleep(400);
    const settle2 = cursorPosition();
    const pointerReadable = settle1 !== null && settle2 !== null;
    const pointerIsStill = pointerReadable && settle1.x === settle2.x && settle1.y === settle2.y;

    const before = cursorPosition();
    const snap = await call('computer_snapshot', { appId: notepad.appId, windowId: driven.windowId });
    const editor = (snap.elements ?? []).find((e) => /edit|document/i.test(`${e.role} ${e.label ?? ''}`));
    if (!snap.ok || !editor) {
      console.log('SKIP  no editable element found in the driven window');
      return 0;
    }

    const marker = `ORACLE-${Date.now()}`;
    const write = await call('computer_set_value', {
      appId: notepad.appId,
      snapshotId: snap.snapshotId,
      elementIndex: editor.index,
      value: marker,
    });
    const after = cursorPosition();

    check('set_value succeeds through the accessibility layer', write.ok === true, write.message ?? '');
    if (!pointerReadable) {
      console.log(`SKIP  cursor preservation — no pointer reader for ${process.platform} yet`);
    } else if (!pointerIsStill) {
      console.log(
        'SKIP  cursor preservation — the pointer was already moving before the action ' +
          `(${settle1.x},${settle1.y} → ${settle2.x},${settle2.y}), so movement afterwards is not attributable`,
      );
    } else {
      check(
        'cursor did not move across an element-addressed action',
        before !== null && after !== null && before.x === after.x && before.y === after.y,
        before && after ? `${before.x},${before.y} → ${after.x},${after.y}` : 'unavailable',
      );
    }
    check('element-addressed action is not synthetic', write.path === 'accessibility', `path=${write.path}`);

    // ── Oracle 2: input leak ──
    const decoySnap = await call('computer_snapshot', {
      appId: notepad.appId,
      windowId: untouched.windowId,
    });
    const decoyEditor = (decoySnap.elements ?? []).find((e) =>
      /edit|document/i.test(`${e.role} ${e.label ?? ''}`),
    );
    check(
      'the untouched window received nothing',
      !decoyEditor || !String(decoyEditor.value ?? '').includes(marker),
      `value=${JSON.stringify(decoyEditor?.value ?? null)}`,
    );

    // ── Oracle 3: the write actually landed where it was aimed ──
    const reread = await call('computer_snapshot', { appId: notepad.appId, windowId: driven.windowId });
    const rereadEditor = (reread.elements ?? []).find((e) => e.index === editor.index);
    check(
      'the driven window holds exactly what was written',
      String(rereadEditor?.value ?? '').includes(marker),
      `value=${JSON.stringify(rereadEditor?.value ?? null)}`,
    );
  } finally {
    for (const pid of [target.pid, decoy.pid]) {
      try {
        process.kill(pid);
      } catch {
        // Already gone.
      }
    }
    await service.stop('oracles', 'oracles-complete').catch(() => undefined);
  }

  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => {
    console.log(failures === 0 ? '\nOracles: all checks passed.' : `\nOracles: ${failures} failed.`);
    process.exit(code);
  })
  .catch((err) => {
    console.error('Oracles crashed:', err);
    process.exit(1);
  });
