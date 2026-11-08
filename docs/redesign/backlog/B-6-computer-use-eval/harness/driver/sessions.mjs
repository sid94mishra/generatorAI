import { execFileSync } from 'node:child_process';
const sdk = await import('/Users/sidmishra/Desktop/Projects/generatorAI/packages/core/node_modules/@trycua/cua-driver/dist/index.js');
const ps = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
const line = ps.split('\n').find((l) => l.startsWith('/Applications/GeneratorAI.app') && l.includes(' serve --embedded'));
if (!line) { console.log('no driver running'); process.exit(0); }
const c = sdk.CuaDriver.connect(line.split('--socket ')[1].split(' ')[0]);
for (const tool of ['list_sessions']) {
  try { const r = await c.callTool(tool, '{}'); console.log(tool, (r.structuredJson ?? r.text ?? '').slice(0, 3000)); } catch (e) { console.log(tool, 'ERR', e?.inner?.message ?? String(e)); }
}
process.exit(0);
