// tsx saveas.ts <appName> <windowId> <folder> <name> <menu> — runs the bridge's real saveAs against the live app.
import { execFileSync } from 'node:child_process';
import { CuaDriverBridge } from '/Users/sidmishra/Desktop/Projects/generatorAI/packages/core/src/infrastructure/computer/CuaDriverBridge.ts';
const [appName, windowId, folder, name, menu] = process.argv.slice(2);
const ps = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
const sock = ps.split('\n').find((l) => l.startsWith('/Applications/GeneratorAI.app') && l.includes(' serve --embedded'))!.split('--socket ')[1]!.split(' ')[0]!;
const pid = Number(execFileSync('pgrep', ['-x', appName!], { encoding: 'utf8' }).trim().split('\n')[0]);
const log = (...a: unknown[]) => console.log('[log]', ...a);
const bridge = new CuaDriverBridge({ logger: { info: log, warn: log, error: log, debug: () => {} } as never, maxSnapshotElements: 600, maxSnapshotDepth: 30, attachSocketPath: sock });
const handle = await bridge.start({ workspaceId: `harness-${Date.now()}`, workspaceRoot: '/private/tmp/claude-501/-Users-sidmishra-Desktop-Projects-generatorAI/c4d587b8-91f7-439b-b467-3bbea6ba535b/scratchpad/cu/harness' } as never);
const t0 = Date.now();
const r = await bridge.saveAs!(handle as never, { appId: 'x', name: appName!, pid } as never, Number(windowId), { folder: folder!, name: name!, menu: menu ? menu.split('>') : undefined } as never);
console.log(JSON.stringify(r), Date.now() - t0, 'ms');
await bridge.stop(handle as never).catch(() => {});
process.exit(0);
