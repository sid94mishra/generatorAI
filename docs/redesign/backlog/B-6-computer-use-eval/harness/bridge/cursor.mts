// tsx cursor.mts — the real bridge against the live driver: an action shows the agent cursor, the end of a turn
// hides it, the next action shows it again. Reads the state on the bridge's own session.
import { execFileSync } from 'node:child_process';
import { CuaDriverBridge } from '/Users/sidmishra/Desktop/Projects/generatorAI/packages/core/src/infrastructure/computer/CuaDriverBridge.ts';
const ps = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
const sock = ps.split('\n').find((l) => l.startsWith('/Applications/GeneratorAI.app') && l.includes(' serve --embedded'))!.split('--socket ')[1]!.split(' ')[0]!;
const pid = Number(execFileSync('pgrep', ['-x', 'Calculator'], { encoding: 'utf8' }).trim().split('\n')[0]);
const nolog = () => {};
const bridge = new CuaDriverBridge({ logger: { info: nolog, warn: console.log, error: console.log, debug: nolog } as never, maxSnapshotElements: 600, maxSnapshotDepth: 30, attachSocketPath: sock });
const workspaceId = `harness-${Date.now()}`;
const handle = await bridge.start({ workspaceId, workspaceRoot: '/private/tmp/claude-501/-Users-sidmishra-Desktop-Projects-generatorAI/c4d587b8-91f7-439b-b467-3bbea6ba535b/scratchpad/cu/harness' } as never);
const conn = (bridge as any).connections.get(workspaceId);
const state = async () => JSON.parse((await conn.client.callTool('get_agent_cursor_state', JSON.stringify({ session: conn.sessionId }))).structuredJson);
const app = { appId: 'com.apple.calculator', name: 'Calculator', pid };
const win = (await bridge.listWindows(handle as never, app as never)).windows.find((w: any) => w.title === 'Calculator')!;
const click = (name: string) => bridge.act(handle as never, { type: 'clickNamed', target: { app, window: { by: 'id', id: win.id } }, name } as never, undefined, { observe: false });
try {
  let s = await state();
  console.log('after start:      enabled', s.enabled, 'motion', JSON.stringify({ style: s.motion.style, arc: s.motion.arc_size, timing: s.motion.timing, dwell: s.motion.dwell_after_click_ms, idle: s.motion.idle_hide_ms, effects: s.motion.effects }));
  console.log('click 7:', JSON.stringify(await click('7')).slice(0, 400)); s = await state(); console.log('during the turn:  enabled', s.enabled, 'position', JSON.stringify(s.position));
  await bridge.hideAgentCursor(handle as never); s = await state(); console.log('turn ended:       enabled', s.enabled);
  console.log('click All Clear:', (await click('All Clear')).ok); s = await state(); console.log('next turn acts:   enabled', s.enabled, 'position', JSON.stringify(s.position));
} finally {
  await bridge.stop(handle as never).catch(() => {});
}
process.exit(0);
