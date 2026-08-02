// Terminal WS smoke — spawn a session, connect the WS, send `echo hi`,
// read the output, resize, kill. Runs against a live GeneratorAI server.
//
// Usage:
//   node agent-tests/terminal-ws-smoke.mjs
//
// Env:
//   GENERATORAI_URL       (default http://localhost:3100)
//   GENERATORAI_WORKSPACE — an active workspace id; required. Or if a
//                            path prefix must be found, this script falls
//                            back to the first `status=active` workspace.
//   GENERATORAI_API_KEY   — optional bearer token

import { WebSocket } from 'ws';

const BASE = process.env.GENERATORAI_URL ?? 'http://localhost:3100';
const TOKEN = process.env.GENERATORAI_API_KEY ?? '';

function hdrs() {
  return TOKEN
    ? { 'x-generatorai-token': TOKEN, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function pickActiveWorkspace() {
  if (process.env.GENERATORAI_WORKSPACE) return process.env.GENERATORAI_WORKSPACE;
  const r = await fetch(`${BASE}/api/workspaces?status=active&limit=1`, { headers: hdrs() });
  const list = await r.json();
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('No active workspace found — pass GENERATORAI_WORKSPACE=<id>');
  }
  return list[0].id;
}

async function spawn(workspaceId) {
  const r = await fetch(`${BASE}/api/workspaces/${workspaceId}/terminals`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({ cols: 100, rows: 30 }),
  });
  if (!r.ok) throw new Error(`spawn failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function list(workspaceId) {
  const r = await fetch(`${BASE}/api/workspaces/${workspaceId}/terminals`, { headers: hdrs() });
  if (!r.ok) throw new Error(`list failed: ${r.status}`);
  return r.json();
}

async function kill(workspaceId, sid) {
  await fetch(`${BASE}/api/workspaces/${workspaceId}/terminals/${sid}`, { method: 'DELETE', headers: hdrs() });
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log(' ✓ ' + msg);
}

async function main() {
  const workspaceId = await pickActiveWorkspace();
  console.log(`Using workspace: ${workspaceId}`);

  console.log('▶ POST /terminals');
  const created = await spawn(workspaceId);
  console.log(`   sid=${created.id} host=${created.host} pid=${created.pid} shell=${created.shell}`);
  assert(created.host === 'node-pty' || created.host === 'fallback-child-process', 'host valid');
  assert(created.cols === 100, 'cols set');

  console.log('▶ GET /terminals — expect at least our new session');
  const lst = await list(workspaceId);
  assert(lst.terminals.some((t) => t.id === created.id), 'listed our session');

  console.log('▶ WS connect');
  const wsUrl = BASE.replace(/^http/, 'ws') + `/api/workspaces/${workspaceId}/terminals/${created.id}/stream`;
  const ws = new WebSocket(wsUrl);
  const outputChunks = [];
  let ready = false;
  let exited = false;

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS open timeout')), 8000);
  });
  console.log(' ✓ WS opened');

  ws.on('message', (data, isBinary) => {
    if (isBinary || data instanceof Buffer && data[0] !== 0x7b) {
      outputChunks.push(Buffer.from(data));
      return;
    }
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.t === 'ready') ready = true;
      if (parsed.t === 'exit') exited = true;
      console.log(`   ← ${parsed.t}`);
    } catch { /* ignore */ }
  });

  // Wait for ready frame + banner output.
  await new Promise((r) => setTimeout(r, 800));

  console.log('▶ send input: echo hi');
  ws.send(JSON.stringify({ t: 'input', data: 'echo hi\r' }));
  await new Promise((r) => setTimeout(r, 2500));

  const outputText = Buffer.concat(outputChunks).toString('utf8');
  console.log('   captured output length:', outputText.length);
  assert(outputText.includes('hi'), 'terminal echoed "hi"');

  console.log('▶ resize 120x40');
  ws.send(JSON.stringify({ t: 'resize', cols: 120, rows: 40 }));
  await new Promise((r) => setTimeout(r, 300));

  console.log('▶ ACK bytes');
  ws.send(JSON.stringify({ t: 'ack', bytes: outputText.length }));

  console.log('▶ kill (SIGKILL via DELETE)');
  await kill(workspaceId, created.id);
  await new Promise((r) => setTimeout(r, 500));

  ws.close();
  console.log('▶ done — ready:%s exited:%s outputBytes:%d', ready, exited, outputText.length);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
