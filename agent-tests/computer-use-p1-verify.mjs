// Verifies the P1 slice end to end against the real driver: query projection,
// element_token dispatch, stale-token refusal, and isolated launch.
import { CuaDriverBridge } from '@generatorai/core';

const logger = { debug: () => {}, info: () => {}, warn: (m) => console.log('[warn]', m), error: (m) => console.log('[err]', m) };
const bridge = new CuaDriverBridge({ logger, maxSnapshotElements: 2000, maxSnapshotDepth: 25 });
const handle = await bridge.start({ workspaceId: 'p1verify', workspaceRoot: process.cwd() });

const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); process.exitCode = 1; };

const apps = await bridge.listApps(handle);
const target = apps.apps.find((a) => /excel/i.test(a.name)) ?? apps.apps.find((a) => /notepad/i.test(a.name));
if (!target) { console.log('SKIP  no Excel or Notepad running'); process.exit(0); }
const app = { appId: target.id, name: target.name, pid: target.pid };
const wins = await bridge.listWindows(handle, app);
const win = wins.windows[0];
console.log(`target: ${target.name} pid=${target.pid} window=${win.id} minimised=${win.minimised}\n`);

const window = { by: 'id', id: win.id };

// ── query projection ──
// The term is taken from the live window rather than hardcoded: Excel's start
// screen has no grid, so a fixed "A1" would measure the fixture, not the code.
const full = await bridge.snapshot(handle, { app, window });
const fullN = full.snapshot?.elements.length ?? 0;
const labelled = (full.snapshot?.elements ?? []).filter((e) => e.label && e.label.length > 2);
if (labelled.length === 0) { console.log('SKIP  window exposes no labelled elements'); process.exit(0); }
const term = labelled[Math.floor(labelled.length / 2)].label.slice(0, 6);

const filtered = await bridge.snapshot(handle, { app, window, query: term });
const filtN = filtered.snapshot?.elements.length ?? 0;
console.log(`  no query: ${fullN} elements   query="${term}": ${filtN} elements`);
if (fullN > 0 && filtN > 0 && filtN < fullN) pass(`query projects the tree (${fullN} -> ${filtN})`);
else fail(`query did not project (${fullN} -> ${filtN})`);

// ── element_token captured ──
const withToken = (filtered.snapshot?.elements ?? []).filter((e) => e.token);
if (withToken.length > 0) pass(`element_token captured (${withToken.length}/${filtN}, e.g. ${withToken[0].token})`);
else fail('no element carried an element_token');

// ── token is not leaked to the model ──
const core = await import('@generatorai/core');
if (typeof core.projectElements === 'function') {
  const projected = core.projectElements(filtered.snapshot.elements);
  if (projected.every((p) => p['token'] === undefined)) pass('token is not projected to the model');
  else fail('token leaked into the agent-facing payload');
} else {
  console.log('SKIP  projectElements is not exported from the package root');
}

// ── token-addressed action reaches the driver ──
// A minimised window refuses before dispatch by design, so restore first —
// otherwise this measures the guard, not the token path.
if (win.minimised) {
  await bridge.bringToFront(handle, app);
  await new Promise((r) => setTimeout(r, 1200));
}
const live = await bridge.snapshot(handle, { app, window, query: term });
const cell = live.snapshot?.elements?.[0];
if (cell) {
  const act = await bridge.act(handle, {
    type: 'click',
    snapshotId: live.snapshot.snapshotId,
    elementIndex: cell.index,
  });
  if (act.ok) pass(`token-addressed click accepted (path=${act.action?.path})`);
  else fail(`token-addressed click refused: ${act.refusal?.code} — ${act.refusal?.message?.slice(0, 120)}`);
}

// ── a superseded snapshot still refuses cleanly ──
const stale = await bridge.act(handle, {
  type: 'click',
  snapshotId: 'snapshot-that-never-existed',
  elementIndex: 0,
});
if (!stale.ok && stale.refusal?.code === 'stale_snapshot') pass('unknown snapshot refuses as stale_snapshot');
else fail(`expected stale_snapshot, got ${stale.refusal?.code ?? 'ok'}`);

// ── the token is genuinely on the wire ──
// Supersede the snapshot the driver holds, then act with the older one. Our
// cache still has it, so the request carries a token the driver has retired —
// which only refuses if the token is actually being sent.
const older = await bridge.snapshot(handle, { app, window, query: term });
await bridge.snapshot(handle, { app, window, query: term });
const olderCell = older.snapshot?.elements?.[0];
if (olderCell) {
  const superseded = await bridge.act(handle, {
    type: 'click',
    snapshotId: older.snapshot.snapshotId,
    elementIndex: olderCell.index,
  });
  const code = superseded.refusal?.code;
  if (!superseded.ok && code === 'stale_snapshot') {
    pass('superseded element handle refuses as stale_snapshot (token reached the driver)');
  } else if (superseded.ok) {
    console.log('NOTE  superseded handle was accepted — this driver does not retire tokens per snapshot');
  } else {
    fail(`superseded handle refused as ${code}, expected stale_snapshot`);
  }
}

process.exit(process.exitCode ?? 0);

