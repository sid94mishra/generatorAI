// node trajectory.mjs <style> <timing> [effects-json] — measures the agent cursor's motion between Calculator keys.
// Opens its own driver session with the cursor on, samples get_agent_cursor_state every ~15 ms during each click,
// prints per-move metrics, and ALWAYS ends its session (no cursor is left behind).
import { execFileSync } from 'node:child_process';
const sdk = await import('/Users/sidmishra/Desktop/Projects/generatorAI/packages/core/node_modules/@trycua/cua-driver/dist/index.js');
const [style = 'signature_arc', timing = 'fitts', effectsJson] = process.argv.slice(2);
const ps = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
const line = ps.split('\n').find((l) => l.startsWith('/Applications/GeneratorAI.app') && l.includes(' serve --embedded'));
if (!line) { console.log('no driver running'); process.exit(1); }
const c = sdk.CuaDriver.connect(line.split('--socket ')[1].split(' ')[0]);
const session = `gai-cursor-probe-${Date.now()}`;
const call = async (tool, args) => {
  try { const r = await c.callTool(tool, JSON.stringify({ session, ...args })); return JSON.parse(r.structuredJson ?? '{}'); }
  catch (e) { return { error: e?.inner?.message ?? String(e) }; }
};
let exitCode = 0;
await c.startSession({ session, captureScope: 1 });
try {
  await call('set_agent_cursor_enabled', { enabled: true });
  const motion = await call('set_agent_cursor_motion', { style, timing, idle_hide_ms: 0, ...(effectsJson ? { effects: JSON.parse(effectsJson) } : {}), ...(process.env.MOTION ? JSON.parse(process.env.MOTION) : {}) });
  console.log('motion applied:', JSON.stringify((await call('get_agent_cursor_state', {})).motion));
  if (motion.error) console.log('motion error', motion.error);
  const pid = Number(execFileSync('pgrep', ['-x', 'Calculator'], { encoding: 'utf8' }).trim().split('\n')[0]);
  const wins = await call('list_windows', { pid, on_screen_only: true });
  const win = wins.windows.find((w) => w.title === 'Calculator') ?? wins.windows[0];
  const state = await call('get_window_state', { pid, window_id: win.window_id, tree_format: 'elements', include_screenshot: false, timeout_ms: 4000 });
  const byLabel = (l) => state.elements.find((e) => e.role === 'AXButton' && e.label === l);
  const seq = ['All Clear', '7', '3', '9', '1', 'Equals', '0', 'Divide', 'All Clear'].map(byLabel).filter(Boolean);
  const first = await call('get_agent_cursor_state', {});
  console.log('cursor state:', JSON.stringify(first));
  const rows = [];
  for (const el of seq) {
    const samples = [];
    let done = false;
    const t0 = Date.now();
    const poll = (async () => {
      while (!done) {
        const s = await call('get_agent_cursor_state', {});
        const p = s.position ?? s.cursor?.position ?? s;
        samples.push({ t: Date.now() - t0, x: p?.x ?? null, y: p?.y ?? null, visible: s.visual_state?.resolved_action ?? null, raw: JSON.stringify(s.position) });
        await new Promise((r) => setTimeout(r, 12));
      }
    })();
    await call('click', { element_token: el.element_token });
    await new Promise((r) => setTimeout(r, 150));
    done = true;
    await poll;
    // Moving part only: from the first sample that differs to the last that differs.
    if (process.env.DUMP) console.log(el.label, JSON.stringify(samples.filter((s, i) => i === 0 || s.x !== samples[i - 1].x || s.y !== samples[i - 1].y || s.visible !== samples[i - 1].visible).slice(0, 12)));
    const moving = samples.filter((s, i) => i > 0 && (s.x !== samples[i - 1].x || s.y !== samples[i - 1].y));
    if (moving.length < 2) { rows.push({ to: el.label, samples: samples.length, moved: false }); continue; }
    const start = samples[samples.indexOf(moving[0]) - 1] ?? moving[0];
    const end = moving[moving.length - 1];
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    let len = 0, peakV = 0, peakAt = 0, peaks = 0, prevV = 0, rising = false;
    const pts = [start, ...moving];
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const dt = Math.max(1, pts[i].t - pts[i - 1].t);
      const v = d / dt;
      len += d;
      if (v > peakV) { peakV = v; peakAt = pts[i].t; }
      if (v > prevV * 1.15) rising = true;
      else if (rising && v < prevV * 0.85) { peaks++; rising = false; }
      prevV = v;
    }
    const target = el.frame ? { x: el.frame.x + el.frame.w / 2, y: el.frame.y + el.frame.h / 2 } : undefined;
    rows.push({
      to: el.label,
      ms: end.t - start.t,
      dist: Math.round(dist),
      curvature: +(len / Math.max(1, dist)).toFixed(2),
      peakAtFrac: +((peakAt - start.t) / Math.max(1, end.t - start.t)).toFixed(2),
      velocityPeaks: peaks,
      samples: pts.length,
      endOffTarget: target ? Math.round(Math.hypot(end.x - target.x, end.y - target.y)) : undefined,
    });
  }
  console.log(`style=${style} timing=${timing}`);
  console.table(rows);
} catch (e) {
  console.log('probe failed', String(e));
  exitCode = 1;
} finally {
  await call('set_agent_cursor_enabled', { enabled: false });
  await c.endSession({ session }).catch(() => {});
}
process.exit(exitCode);
