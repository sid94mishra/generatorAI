import { execFileSync } from 'node:child_process';
const sdk = await import('/Users/sidmishra/Desktop/Projects/generatorAI/packages/core/node_modules/@trycua/cua-driver/dist/index.js');
const ps = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
const line = ps.split('\n').find((l) => l.startsWith('/Applications/GeneratorAI.app') && l.includes(' serve --embedded'));
const c = sdk.CuaDriver.connect(line.split('--socket ')[1].split(' ')[0]);
for (const session of process.argv.slice(2)) {
  try { const r = await c.callTool('get_agent_cursor_state', JSON.stringify({ session })); console.log(session, (r.structuredJson ?? r.text ?? '').slice(0, 700)); }
  catch (e) { console.log(session, 'ERR', e?.inner?.message ?? String(e)); }
}
process.exit(0);
