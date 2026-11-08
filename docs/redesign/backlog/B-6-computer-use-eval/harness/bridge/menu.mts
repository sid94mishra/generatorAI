// tsx menu.mts <appName> <windowId> <A>B>C> — runs the bridge's real act(invokeMenu) against the live app.
import { execFileSync } from 'node:child_process';
import { CuaDriverBridge } from '/Users/sidmishra/Desktop/Projects/generatorAI/packages/core/src/infrastructure/computer/CuaDriverBridge.ts';
const [appName, windowId, menu] = process.argv.slice(2);
const ps = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
const sock = ps.split('\n').find((l) => l.startsWith('/Applications/GeneratorAI.app') && l.includes(' serve --embedded'))!.split('--socket ')[1]!.split(' ')[0]!;
const pid = Number(execFileSync('pgrep', ['-x', appName!], { encoding: 'utf8' }).trim().split('\n')[0]);
const log = (...a: unknown[]) => console.log('[log]', ...a);
const bridge = new CuaDriverBridge({ logger: { info: log, warn: log, error: log, debug: () => {} } as never, maxSnapshotElements: 600, maxSnapshotDepth: 30, attachSocketPath: sock });
const handle = await bridge.start({ workspaceId: `harness-${Date.now()}`, workspaceRoot: '/private/tmp/claude-501/-Users-sidmishra-Desktop-Projects-generatorAI/c4d587b8-91f7-439b-b467-3bbea6ba535b/scratchpad/cu/harness' } as never);
const app = { appId: 'x', name: appName!, pid };
const r = await bridge.act(handle as never, { type: 'invokeMenu', target: { app, window: { by: 'id', id: Number(windowId) } }, path: menu!.split('>') } as never);
console.log(JSON.stringify(r).slice(0, 600));
await bridge.stop(handle as never).catch(() => {});
process.exit(0);
