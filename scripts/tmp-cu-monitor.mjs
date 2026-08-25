// Live monitor for a computer-use chat run.
//  - attaches to the chat SSE stream and records EVERY event (tool calls, results, errors)
//  - polls the computer audit activity
//  - polls the screencast video length so we can correlate video growth with actions
//
// usage: node scripts/tmp-cu-monitor.mjs <chatId> <workspaceId> [maxMinutes]
import fs from 'node:fs';
import path from 'node:path';

const [chatId, workspaceId, maxMinutesArg] = process.argv.slice(2);
if (!chatId || !workspaceId) {
  console.error('usage: node tmp-cu-monitor.mjs <chatId> <workspaceId> [maxMinutes]');
  process.exit(1);
}
const maxMinutes = Number(maxMinutesArg ?? 40);
const API = 'http://localhost:3100/api';
const outDir = path.join(process.cwd(), 'scripts', 'tmp-cu-monitor');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `run-${chatId}.jsonl`);
const stream = fs.createWriteStream(file, { flags: 'a' });
const t0 = Date.now();

function note(kind, data) {
  const row = { dt: +((Date.now() - t0) / 1000).toFixed(1), kind, ...data };
  stream.write(JSON.stringify(row) + '\n');
  const brief = Object.entries(data)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 90) : JSON.stringify(v)?.slice(0, 90)}`)
    .join(' ');
  console.log(`[${String(row.dt).padStart(7)}s] ${kind} ${brief}`);
}

// ── SSE ──────────────────────────────────────────────────────────────
async function attachSse() {
  const res = await fetch(`${API}/stream?scope=chat&id=${chatId}`, { headers: { Accept: 'text/event-stream' } });
  note('sse.open', { status: res.status });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLines = raw.split('\n').filter((l) => l.startsWith('data:'));
      if (!dataLines.length) continue;
      const payload = dataLines.map((l) => l.slice(5).trim()).join('\n');
      if (!payload || payload === '{}') continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      handleEvent(ev);
    }
  }
  note('sse.close', {});
}

function trunc(v, n = 400) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return '';
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s;
}

function handleEvent(ev) {
  const kind = ev.kind ?? ev.type ?? 'unknown';
  const d = ev.payload ?? ev.data ?? ev;
  // Record raw for post-hoc analysis, but print a readable line.
  stream.write(JSON.stringify({ dt: +((Date.now() - t0) / 1000).toFixed(1), kind: 'raw', ev }) + '\n');
  if (kind === 'harness.tool_start') {
    note('tool.start', { name: d.tool, id: String(d.callId).slice(-8), args: trunc(d.args, 300) });
  } else if (kind === 'harness.tool_complete') {
    note('tool.result', {
      name: d.tool,
      id: String(d.callId).slice(-8),
      ok: d.isError === undefined ? d.success : !d.isError,
      out: trunc(d.result ?? d.output ?? d.content, 400),
    });
  } else if (/consent/i.test(kind)) {
    note('consent', { kind, detail: trunc(d, 200) });
  } else if (/error|failed/i.test(kind)) {
    note('error', { kind, detail: trunc(d, 400) });
  } else if (/turn_end|idle|prompt_failed/i.test(kind)) {
    note('lifecycle', { kind, detail: trunc(d, 200) });
  }
}

// ── polling ──────────────────────────────────────────────────────────
const seen = new Set();
let lastBytes = -1;
let lastTurns = -1;

async function poll() {
  try {
    const acts = await (await fetch(`${API}/workspaces/${workspaceId}/computer/activity`)).json();
    for (const e of [...(acts.entries ?? [])].reverse()) {
      const key = `${e.createdAt}|${e.action}|${e.appLabel}|${e.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      note('audit', {
        action: e.action,
        app: e.appLabel,
        target: e.target,
        verified: e.verified,
        refusal: e.refusalCode,
        frame: e.artifactId ? 'yes' : 'no',
        at: e.createdAt,
      });
    }
  } catch (err) { note('audit.error', { err: String(err) }); }

  try {
    const rec = await (await fetch(`${API}/workspaces/${workspaceId}/computer/recording`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"status"}',
    })).json();
    let bytes = -1;
    try {
      const v = await fetch(`${API}/workspaces/${workspaceId}/computer/recording/video`, { headers: { Range: 'bytes=0-0' } });
      const cr = v.headers.get('content-range');
      if (cr) bytes = Number(cr.split('/').pop());
      else if (v.headers.get('content-length')) bytes = Number(v.headers.get('content-length'));
      await v.body?.cancel();
    } catch { /* video not up yet */ }
    if (bytes !== lastBytes || rec.turnCount !== lastTurns) {
      note('video', { rec: rec.recording, cast: rec.cast?.active, turns: rec.turnCount, hasCast: rec.hasCast, bytes });
      lastBytes = bytes; lastTurns = rec.turnCount;
    }
  } catch (err) { note('video.error', { err: String(err) }); }
}

note('monitor.start', { chatId, workspaceId, file });
// The dev server restarts on edit; keep re-attaching so no event window is lost.
(async () => {
  for (;;) {
    try { await attachSse(); } catch (e) { note('sse.error', { err: String(e) }); }
    await new Promise((r) => setTimeout(r, 2000));
  }
})();
const timer = setInterval(poll, 4000);
poll();
setTimeout(() => { note('monitor.stop', {}); clearInterval(timer); stream.end(); process.exit(0); }, maxMinutes * 60_000);
