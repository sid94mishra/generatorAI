// The whole point of shipping the binary: can a plain Node process spawn it as
// a daemon, connect over its socket, and drive a real window? And does the
// agent cursor — impossible in-process — come alive on that path?
import * as path from 'node:path';
import { EmbeddedCuaDriverHost } from '@trycua/cua-driver/embedded';
import { CuaDriver } from '@trycua/cua-driver';

const target = `${process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
const binaryPath = path.resolve('apps/desktop/resources/cua-driver', target, exe);
console.log(`binary: ${binaryPath}`);

// bounded mode demands a session-policy file; standard mode rejects the
// approval flag. They are mutually exclusive shapes, not independent knobs.
const bounded = process.env['PROBE_POLICY'] !== undefined;
const host = EmbeddedCuaDriverHost.withOptions({
  binaryPath,
  hostBundleId: 'com.generatorai.app',
  permissionMode: bounded ? 1 : 0,
  ...(bounded ? { sessionPolicyPath: process.env['PROBE_POLICY'], approveSessionPolicy: true } : { approveSessionPolicy: false }),
  dangerouslyBypassApprovals: false,
  environment: [],
  inheritStderr: false,
});

const started = Date.now();
const connection = await host.start();
console.log(
  `daemon up in ${Date.now() - started}ms  pid=${connection.pid} version=${connection.driverVersion}`,
);
console.log(`socket: ${connection.socketPath}`);

const driver = CuaDriver.connect(connection.socketPath);
const session = `daemon-probe-${Date.now()}`;
await driver.startSession({ session, captureScope: 1 });

const call = async (tool, args = {}) => {
  const r = await driver.callTool(tool, JSON.stringify({ session, ...args }));
  return r;
};

const apps = JSON.parse((await call('list_apps')).structuredJson ?? '{}');
const running = (apps.apps ?? []).filter((a) => a.running);
console.log(`\nlist_apps through the daemon: ${running.length} running apps`);

const t = running.find((a) => /notepad|excel|explorer/i.test(a.name ?? ''));
if (t) {
  const wins = JSON.parse((await call('list_windows', { pid: t.pid })).structuredJson ?? '{}');
  const win = (wins.windows ?? [])[0];
  console.log(`target: ${t.name} pid=${t.pid} window=${win?.window_id}`);
  if (win) {
    const state = await call('get_window_state', {
      pid: t.pid,
      window_id: win.window_id,
      include_screenshot: false,
    });
    const sj = JSON.parse(state.structuredJson ?? '{}');
    console.log(`get_window_state: ${sj.elements?.length} elements, snapshot=${sj.snapshot_id}`);
  }
}

// The question the in-process runtime could never answer.
console.log('\n=== agent cursor on the daemon path ===');
console.log('enable ->', (await call('set_agent_cursor_enabled', { enabled: true })).structuredJson);
await call('move_cursor', { x: 900, y: 500, scope: 'window' });
await new Promise((r) => setTimeout(r, 1200));
const cursor = JSON.parse((await call('get_agent_cursor_state')).structuredJson ?? '{}');
console.log(`state -> enabled=${cursor.enabled} position=${JSON.stringify(cursor.position)}`);

await driver.endSession({ session });
await host.stop();
console.log('\ndaemon stopped cleanly');
process.exit(0);
