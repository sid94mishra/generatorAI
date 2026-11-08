// node sess.mjs <steps.json> — runs driver calls in ONE session against GeneratorAI's embedded cua-driver, so
// snapshot tokens carry from one call to the next. Diagnostics only. Each step: {tool, args, show?}.
// In args, "$tok:<label>" is replaced with the element_token of the latest snapshot row whose label/role/value matches.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire('/Users/sidmishra/Desktop/Projects/generatorAI/packages/core/package.json');
const sdk = await import('/Users/sidmishra/Desktop/Projects/generatorAI/packages/core/node_modules/@trycua/cua-driver/dist/index.js');
const ps = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
const sock = ps.split('\n').find((l) => l.startsWith('/Applications/GeneratorAI.app') && l.includes(' serve --embedded')).split('--socket ')[1].split(' ')[0];
const client = sdk.CuaDriver.connect(sock);
const session = `gai-diag-${Date.now()}`;
await client.startSession({ session, captureScope: 0 }).catch(() => {});
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let last = null;
const resolveTok = (v) => {
  if (typeof v !== 'string' || !v.startsWith('$tok:')) return v;
  const want = v.slice(5).toLowerCase();
  const row = (last?.elements ?? []).find((e) => [e.label, e.role, e.value, e.title].some((x) => typeof x === 'string' && x.toLowerCase() === want))
    ?? (last?.elements ?? []).find((e) => [e.label, e.value].some((x) => typeof x === 'string' && x.toLowerCase().includes(want)));
  if (row) return row.element_token;
  const line = (last?.tree_markdown ?? '').split('\n').find((l) => /\[\d+\]/.test(l) && l.toLowerCase().includes(want) && /AXButton|AXMenuItem|AXTextField|AXCell|AXPopUpButton|AXCheckBox|AXRadioButton|AXTextArea|AXImage/.test(l));
  if (!line) throw new Error(`no row matches ${want}`);
  return `${last.snapshot_id}:${line.match(/\[(\d+)\]/)[1]}`;
};
for (const step of steps) {
  const args = Object.fromEntries(Object.entries({ session, ...step.args }).map(([k, v]) => [k, resolveTok(v)]));
  const t0 = Date.now();
  let r;
  try { r = await client.callTool(step.tool, JSON.stringify(args)); }
  catch (e) { r = { isError: true, text: e?.inner?.message ?? String(e) }; }
  let d = {};
  try { d = JSON.parse(r.structuredJson ?? '{}'); } catch {}
  if (step.tool === 'get_window_state' && (d.elements || d.tree_markdown)) last = d;
  delete d.screenshot_png_b64;
  const summary = step.show === 'tree' ? (d.tree_markdown ?? d.tree_diff ?? '') : step.show === 'none' ? '' : JSON.stringify(d).slice(0, step.max ?? 600);
  console.log(`## ${step.tool} ${JSON.stringify(step.args).slice(0, 160)}  (${Date.now() - t0} ms) ${r.isError ? 'ERROR ' + (r.text ?? '').slice(0, 300) : ''}\n${summary}`);
  if (step.sleep) await new Promise((res) => setTimeout(res, step.sleep));
}
await client.endSession({ session }).catch(() => {});
process.exit(0);
