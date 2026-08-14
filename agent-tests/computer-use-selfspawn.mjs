// Endpoint mode A: the bridge spawns its own daemon from the bundled binary,
// with no desktop shell and no pre-existing socket. The agent cursor is the
// tell — it only renders on a daemon-backed connection.
import * as path from 'node:path';
import { CuaDriverBridge } from '@generatorai/core';

const target = `${process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
const driverBinaryPath = path.resolve('apps/desktop/resources/cua-driver', target, exe);

const lines = [];
const logger = {
  debug: () => {},
  info: (m) => lines.push(m),
  warn: (m) => lines.push(`[warn] ${m}`),
  error: (m) => lines.push(`[err] ${m}`),
};

const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); process.exitCode = 1; };

const bridge = new CuaDriverBridge({
  logger,
  maxSnapshotElements: 500,
  maxSnapshotDepth: 25,
  driverBinaryPath,
  // Proves the daemon is chosen over the in-process runtime, not merely
  // reached because nothing else was available.
  allowInProcess: false,
});

const handle = await bridge.start({ workspaceId: 'modeA', workspaceRoot: process.cwd() });
if (handle.operational && handle.hostRef !== 'in-process') pass(`connected over ${handle.hostRef}`);
else fail(`expected a daemon socket, got hostRef=${handle.hostRef}`);
if (lines.some((l) => l.includes('started own driver daemon'))) pass('bridge spawned the daemon itself');
else fail(`no spawn logged. lines=${JSON.stringify(lines)}`);

const status = await bridge.runtime('modeA');
if (status.host === 'attached' && status.state === 'ready') pass(`runtime reports ${status.host}/${status.state}`);
else fail(`runtime reports ${status.host}/${status.state}`);
if ((status.checks ?? []).length > 0) pass(`health checks came back (${status.checks.length})`);
else fail('no health checks');

const apps = await bridge.listApps(handle);
const t = (apps.apps ?? []).find((a) => /notepad|excel|explorer/i.test(a.name));
if (t) {
  const wins = await bridge.listWindows(handle, { appId: t.id, name: t.name, pid: t.pid });
  const win = wins.windows?.[0];
  const snap = await bridge.snapshot(handle, {
    app: { appId: t.id, name: t.name, pid: t.pid },
    window: { by: 'id', id: win.id },
  });
  if (snap.ok && (snap.snapshot?.elements.length ?? 0) > 0) {
    pass(`drove ${t.name} through the daemon — ${snap.snapshot.elements.length} elements`);
  } else {
    fail(`snapshot through the daemon failed: ${snap.refusal?.code}`);
  }
}

const { client, sessionId } = bridge.connections.get('modeA');
const cursor = JSON.parse(
  (await client.callTool('get_agent_cursor_state', JSON.stringify({ session: sessionId }))).structuredJson ?? '{}',
);
if (cursor.enabled === true) pass('agent cursor is live — impossible on the in-process runtime');
else fail(`agent cursor still reports enabled=${cursor.enabled}`);

await bridge.stop(handle);
await bridge.dispose();
pass('daemon stopped with the bridge');
process.exit(process.exitCode ?? 0);
