#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// A stand-in for `opencode serve --stdio --port 0` (OpenCode 2.2.7).
//
// Speaks the subset of the 2.2.7 HTTP API (schemas/opencode/openapi.json) the
// provider uses, with the real contract's shapes and ordering:
//
//   • `--stdio`: binds 127.0.0.1:<ephemeral>, prints ONE line `{"url":"…"}`,
//     exits when stdin closes; the password comes from OPENCODE_PASSWORD and
//     every request needs HTTP Basic `opencode:<password>` (401 otherwise).
//   • `GET /api/event`: `data: <envelope>\n\n` frames, `server.connected`
//     first, `: heartbeat` comments; envelope `{id, created, type, data}`.
//   • `POST /api/session/{id}/prompt` ADMITS the input and returns at once;
//     the run follows on the stream: `session.execution.started` → steps
//     (text/reasoning deltas, `session.tool.*`) → one terminal
//     `session.execution.succeeded | failed | interrupted`.
//   • Permission asks (`permission.asked` → `…/permission/{id}/reply`), the
//     question tool's form (`form.created` → `…/form/{id}/reply` or DELETE),
//     compaction (`session.compaction.*`), fork (re-keyed copies), revert,
//     and a client-hosted MCP WebSocket that we drive as the MCP client.
//
// The prompt text picks a script (see `runPrompt`). Test hooks live under
// `/__test/*` (no auth): the recorded requests, the client-MCP tool lists, and
// knobs. FAKE_OC_VERSION overrides the reported version; FAKE_OC_V1=1 behaves
// like OpenCode 1 (no --stdio JSON line, no /api routes).
// ────────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const VERSION = process.env.FAKE_OC_VERSION ?? '2.2.7';
const PASSWORD = process.env.OPENCODE_PASSWORD ?? '';
const V1 = process.env.FAKE_OC_V1 === '1';
if (args[0] !== 'serve') { console.error('usage: serve --stdio --port 0'); process.exit(2); }
if (process.env.FAKE_OC_EXIT_EARLY) { console.error('fatal: boom'); process.exit(3); }

// ── State ──
let seq = 0;
const nextId = (prefix) => `${prefix}_${String(++seq).padStart(8, '0')}`;
const requests = [];
const sessions = new Map(); // id → { info, messages: [], env, instructions: {}, running: null }
const permissions = new Map(); // id → resolve(decision)
const forms = new Map(); // id → resolve({answer} | {cancel, message})
const subscribers = new Set();
const knobs = { compact: 'ok' };
const mcpClients = new Map(); // directory → { send, tools, pending: Map<id, resolve>, nextId }

const MODELS = [
  {
    id: 'claude-sonnet-5-5', modelID: 'claude-sonnet-5-5', providerID: 'anthropic', name: 'Claude Sonnet 5.5', family: 'claude',
    capabilities: { tools: true, input: ['text', 'image', 'pdf'], output: ['text'] },
    variants: [{ id: 'low' }, { id: 'high' }, { id: 'max' }], time: { released: 1 },
    cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }], status: 'active', enabled: true,
    limit: { context: 1_000_000, output: 64_000 }, type: 'chat',
  },
  {
    id: 'gpt-5.6-terra', modelID: 'gpt-5.6-terra', providerID: 'openai', name: 'GPT-5.6 Terra',
    capabilities: { tools: true, input: ['text'], output: ['text'] },
    variants: [{ id: 'minimal' }], time: { released: 2 },
    cost: [], status: 'active', enabled: true, limit: { context: 258_000, input: 200_000, output: 58_000 }, type: 'chat',
  },
  {
    id: 'old', modelID: 'old', providerID: 'openai', name: 'Old', capabilities: { tools: true, input: ['text'], output: ['text'] },
    variants: [], time: { released: 0 }, cost: [], status: 'deprecated', enabled: true, limit: { context: 1000, output: 100 },
  },
];
const AGENTS = [
  { id: 'build', name: 'Build', mode: 'primary', hidden: false, permissions: [{ action: '*', resource: '*', effect: 'allow' }], request: { settings: {}, headers: {}, body: {} } },
  { id: 'plan', name: 'Plan', mode: 'primary', hidden: false, description: 'Read-only', permissions: [], request: { settings: {}, headers: {}, body: {} } },
  { id: 'general', name: 'General', mode: 'subagent', hidden: false, permissions: [], request: { settings: {}, headers: {}, body: {} } },
  { id: 'title', name: 'Title', mode: 'primary', hidden: true, permissions: [], request: { settings: {}, headers: {}, body: {} } },
];

// ── Events ──
function emit(type, data) {
  const frame = `data: ${JSON.stringify({ id: nextId('evt'), created: Date.now(), type, data })}\n\n`;
  for (const res of subscribers) res.write(frame);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── HTTP helpers ──
function json(res, status, body) {
  if (body === undefined) { res.writeHead(status); res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
const notFound = (res, tag = 'SessionNotFoundError') => json(res, 404, { _tag: tag, message: 'not found' });
const authorized = (req) => req.headers.authorization === `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString('base64')}`;

function sessionInfo(s) { return s.info; }

function newSession(body, parent) {
  const id = nextId('ses');
  const s = {
    info: {
      id, projectID: 'prj_1', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now(), updated: Date.now() },
      ...(body.title ? { title: body.title } : {}),
      ...(parent ? { parentID: parent.info.id } : {}),
      agent: body.agent ?? 'build',
      ...(body.model ? { model: body.model } : {}),
      metadata: body.metadata ?? parent?.info.metadata ?? {},
      permissions: body.permissions ?? parent?.info.permissions ?? [],
      location: body.location ?? parent?.info.location ?? { directory: process.cwd() },
    },
    messages: [], env: null, instructions: {}, running: null,
  };
  sessions.set(id, s);
  emit('session.created', { sessionID: id, projectID: 'prj_1', location: s.info.location, slug: id, version: VERSION, ...(parent ? { parentID: parent.info.id } : {}), metadata: s.info.metadata, permissions: s.info.permissions });
  return s;
}

// ── Turn scripts ──
async function step(s, run, fn, { finish = 'stop', tokens } = {}) {
  const amid = nextId('msg');
  const msg = { id: amid, type: 'assistant', agent: s.info.agent, model: s.info.model ?? { id: 'claude-sonnet-5-5', providerID: 'anthropic' }, content: [], time: { created: Date.now() } };
  s.messages.push(msg);
  emit('session.step.started', { sessionID: s.info.id, assistantMessageID: amid, agent: msg.agent, model: msg.model, started: Date.now() });
  const say = async (text) => {
    emit('session.text.started', { sessionID: s.info.id, assistantMessageID: amid, ordinal: 0 });
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      emit('session.text.delta', { sessionID: s.info.id, assistantMessageID: amid, ordinal: 0, delta: piece });
      await sleep(2);
    }
    emit('session.text.ended', { sessionID: s.info.id, assistantMessageID: amid, ordinal: 0, text });
    msg.content.push({ type: 'text', text });
  };
  const tool = (id, name, input) => {
    emit('session.tool.input.started', { sessionID: s.info.id, assistantMessageID: amid, id, name });
    emit('session.tool.input.ended', { sessionID: s.info.id, assistantMessageID: amid, id });
    emit('session.tool.called', { sessionID: s.info.id, assistantMessageID: amid, id, input, executed: true });
  };
  const ok = (id, text) => emit('session.tool.success', { sessionID: s.info.id, assistantMessageID: amid, id, content: [{ type: 'text', text }], executed: true });
  const fail = (id, message) => emit('session.tool.failed', { sessionID: s.info.id, assistantMessageID: amid, id, error: { type: 'tool', message }, executed: true });
  await fn({ amid, say, tool, ok, fail });
  if (run.interrupted) return;
  emit('session.step.ended', {
    sessionID: s.info.id, assistantMessageID: amid, finish, cost: 0.001,
    tokens: tokens ?? { input: 1200, output: 30, reasoning: 5, cache: { read: 800, write: 0 } },
  });
}

function waitInterrupt(run) { return new Promise((r) => { run.onInterrupt = r; }); }

async function callClientTool(s, name, args) {
  const client = mcpClients.get(s.info.location.directory);
  if (!client) return { isError: true, content: [{ type: 'text', text: 'no client mcp' }] };
  const id = client.nextId++;
  const result = new Promise((r) => client.pending.set(id, r));
  client.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: { 'ai.opencode/sessionID': s.info.id } } });
  const reply = await result;
  return reply.result ?? { isError: true, content: [{ type: 'text', text: reply.error?.message ?? 'error' }] };
}

async function runPrompt(s, text, run) {
  emit('session.execution.started', { sessionID: s.info.id });
  const sid = s.info.id;
  const finishOk = () => { if (!run.interrupted) emit('session.execution.succeeded', { sessionID: sid }); };

  if (text.includes('SERVER_CANCEL')) {
    await step(s, run, async ({ say }) => { await say('partial '); });
    emit('session.execution.interrupted', { sessionID: sid, reason: 'user' });
    return;
  }
  if (text.includes('FAIL_TURN')) {
    emit('session.execution.failed', { sessionID: sid, error: { type: 'provider', message: 'model exploded' } });
    return;
  }
  if (text.includes('HANG')) {
    await step(s, run, async ({ say }) => { await say('thinking '); await waitInterrupt(run); });
    return;
  }
  if (text.includes('TOOL_OK')) {
    await step(s, run, async ({ tool, ok }) => { tool('call_1', 'read', { path: 'a.txt' }); await sleep(5); ok('call_1', 'file body'); }, { finish: 'tool-calls' });
    await step(s, run, async ({ say }) => { await say('done reading'); });
    return finishOk();
  }
  if (text.includes('TOOL_TRUNCATE')) {
    await step(s, run, async ({ tool, ok }) => {
      tool('call_a', 'read', { path: 'a' });
      ok('call_a', 'A');
      tool('call_b', 'edit', { path: 'b' });
    }, { finish: 'length' });
    return finishOk();
  }
  if (text.includes('REASON')) {
    await step(s, run, async ({ amid, say }) => {
      emit('session.reasoning.started', { sessionID: sid, assistantMessageID: amid, ordinal: 0 });
      emit('session.reasoning.delta', { sessionID: sid, assistantMessageID: amid, ordinal: 0, delta: 'let me ' });
      emit('session.reasoning.delta', { sessionID: sid, assistantMessageID: amid, ordinal: 0, delta: 'think' });
      emit('session.reasoning.ended', { sessionID: sid, assistantMessageID: amid, ordinal: 0, text: 'let me think' });
      await say('answer');
    });
    return finishOk();
  }
  if (text.includes('ASK_PERMISSION')) {
    await step(s, run, async ({ tool, ok, fail }) => {
      tool('call_sh', 'shell', { command: 'rm -rf build' });
      const id = nextId('per');
      const decision = new Promise((r) => permissions.set(id, r));
      emit('permission.asked', { id, sessionID: sid, action: 'shell', resources: ['rm -rf build'], save: ['rm *'], source: { type: 'tool', messageID: 'msg_x', id: 'call_sh' } });
      const reply = await decision;
      if (reply.decision === 'reject') fail('call_sh', `Permission denied${reply.message ? `: ${reply.message}` : ''}`);
      else ok('call_sh', 'removed');
    });
    return finishOk();
  }
  if (text.includes('ASK_QUESTION')) {
    let answerText = '';
    await step(s, run, async ({ tool, ok }) => {
      tool('call_q', 'question', { questions: [{ header: 'Pkg', question: 'Which package manager?', options: [{ label: 'bun', description: 'fast' }, { label: 'npm' }] }] });
      const form = {
        id: nextId('frm'), sessionID: sid, title: 'Questions',
        metadata: { kind: 'question', tool: { messageID: 'msg_x', id: 'call_q' } },
        fields: [
          { key: 'q0', title: 'Pkg', description: 'Which package manager?', type: 'string', options: [{ value: 'bun', label: 'bun', description: 'fast' }, { value: 'npm', label: 'npm' }], custom: true },
          { key: 'q1', title: 'Extras', description: 'Which extras?', type: 'multiselect', options: [{ value: 'lint', label: 'lint' }, { value: 'test', label: 'test' }], custom: true },
        ],
      };
      const result = new Promise((r) => forms.set(form.id, r));
      emit('form.created', { form });
      const r = await result;
      answerText = r.cancel ? `cancelled:${r.message ?? ''}` : `answered:${JSON.stringify(r.answer)}`;
      ok('call_q', answerText);
    });
    await step(s, run, async ({ say }) => { await say(answerText); });
    return finishOk();
  }
  if (text.includes('ELICIT')) {
    await step(s, run, async ({ say }) => {
      const form = { id: nextId('frm'), sessionID: sid, title: 'Login', metadata: { kind: 'mcp' }, fields: [{ key: 'token', type: 'string' }] };
      const result = new Promise((r) => forms.set(form.id, r));
      emit('form.created', { form });
      const r = await result;
      await say(r.cancel ? `cancelled:${r.message ?? ''}` : 'answered');
    });
    return finishOk();
  }
  if (text.includes('HOST_TOOL')) {
    const name = text.match(/HOST_TOOL (\S+)/)?.[1] ?? 'echo';
    await step(s, run, async ({ tool, ok, fail }) => {
      tool('call_h', `generatorai_${name}`, { value: 42 });
      const result = await callClientTool(s, name, { value: 42 });
      const out = (result.content ?? []).map((c) => c.text ?? '').join('\n');
      if (result.isError) fail('call_h', out); else ok('call_h', out);
    });
    return finishOk();
  }
  if (text.includes('SUBAGENT')) {
    await step(s, run, async ({ amid, tool, ok }) => {
      tool('call_sub', 'subagent', { agent: 'general', prompt: 'look' });
      const child = newSession({ title: 'look', agent: 'general' }, s);
      emit('session.tool.progress', { sessionID: sid, assistantMessageID: amid, id: 'call_sub', metadata: { sessionID: child.info.id, status: 'running' } });
      await step(child, run, async ({ tool: ctool, ok: cok, say }) => { await say('child prose'); ctool('call_c', 'grep', { pattern: 'x' }); cok('call_c', 'matches'); });
      ok('call_sub', 'subagent done');
    });
    return finishOk();
  }
  if (text.includes('AUTO_COMPACT')) {
    emit('session.compaction.started', { sessionID: sid, reason: 'auto' });
    emit('session.compaction.ended', { sessionID: sid, reason: 'auto', text: 'auto summary' });
    await step(s, run, async ({ say }) => { await say('after compaction'); });
    return finishOk();
  }
  // Default: a short answer.
  await step(s, run, async ({ say }) => { await say('hello world'); });
  finishOk();
}

async function runCompaction(s) {
  const sid = s.info.id;
  emit('session.execution.started', { sessionID: sid });
  emit('session.compaction.started', { sessionID: sid, reason: 'manual' });
  const run = { interrupted: false };
  s.running = run;
  if (knobs.compact === 'hang') { await waitInterrupt(run); s.running = null; return; }
  await sleep(5);
  if (knobs.compact === 'fail') {
    emit('session.compaction.failed', { sessionID: sid, reason: 'manual', error: { type: 'provider', message: 'summary failed' } });
    emit('session.execution.failed', { sessionID: sid, error: { type: 'provider', message: 'summary failed' } });
  } else {
    s.messages.push({ id: nextId('msg'), type: 'compaction', status: 'completed', reason: 'manual', summary: 'SUMMARY', time: { created: Date.now() } });
    emit('session.compaction.ended', { sessionID: sid, reason: 'manual', text: 'SUMMARY' });
    emit('session.execution.succeeded', { sessionID: sid });
  }
  s.running = null;
}

// ── WebSocket (client-hosted MCP: we are the MCP client) ──
function acceptWebSocket(req, socket, directory) {
  const key = req.headers['sec-websocket-key'];
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const sendText = (text) => {
    const payload = Buffer.from(text, 'utf8');
    let header;
    if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
    else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
    socket.write(Buffer.concat([header, payload]));
  };
  const client = { send: (m) => sendText(JSON.stringify(m)), tools: [], pending: new Map(), nextId: 1 };
  mcpClients.set(directory, client);
  const request = (method, params) => {
    const id = client.nextId++;
    const p = new Promise((r) => client.pending.set(id, r));
    client.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    return p;
  };
  const list = async () => { const r = await request('tools/list'); client.tools = r.result?.tools ?? []; };
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = (buf[1] & 0x80) !== 0;
      const maskOff = off; if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buf[maskOff + (i % 4)];
      buf = buf.subarray(off + len);
      if (opcode === 8) { socket.end(); if (mcpClients.get(directory) === client) mcpClients.delete(directory); return; }
      if (opcode !== 1) continue;
      let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch { continue; }
      if (msg.id !== undefined && !msg.method) { const r = client.pending.get(msg.id); client.pending.delete(msg.id); r?.(msg); continue; }
      if (msg.method === 'notifications/tools/list_changed') void list();
    }
  });
  socket.on('close', () => { if (mcpClients.get(directory) === client) mcpClients.delete(directory); });
  void (async () => {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'opencode', version: VERSION } });
    client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await list();
  })();
}

// ── Router ──
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : undefined; } catch { return raw; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const body = await readBody(req);
  if (p.startsWith('/__test/')) {
    if (p === '/__test/requests') return json(res, 200, requests);
    if (p === '/__test/mcp') return json(res, 200, Object.fromEntries([...mcpClients].map(([d, c]) => [d, c.tools.map((t) => t.name)])));
    if (p === '/__test/sessions') return json(res, 200, [...sessions.values()].map((s) => ({ ...s.info, env: s.env, instructions: s.instructions, messages: s.messages.map((m) => ({ id: m.id, type: m.type })) })));
    if (p === '/__test/knobs') { Object.assign(knobs, body ?? {}); return json(res, 204); }
    if (p === '/__test/active') { const s = sessions.get(body.sessionID); if (s) s.running = { interrupted: false, foreign: true }; return json(res, 204); }
    return json(res, 404, {});
  }
  requests.push({ method: req.method, path: p, query: url.search, body });
  if (V1) return json(res, 404, {});
  if (!authorized(req)) return json(res, 401, { _tag: 'UnauthorizedError', message: 'unauthorized' });

  if (req.method === 'GET' && p === '/api/info') return json(res, 200, { version: VERSION, pid: process.pid, urls: [], paths: { tmp: '/tmp' } });
  if (req.method === 'GET' && p === '/api/event') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(`data: ${JSON.stringify({ id: nextId('evt'), type: 'server.connected', data: {} })}\n\n`);
    subscribers.add(res);
    const hb = setInterval(() => res.write(': heartbeat\n\n'), 1000);
    req.on('close', () => { clearInterval(hb); subscribers.delete(res); });
    return;
  }
  if (req.method === 'GET' && p === '/api/model') return json(res, 200, { location: { directory: process.cwd() }, data: MODELS });
  if (req.method === 'GET' && p === '/api/model/default') return json(res, 200, { location: { directory: process.cwd() }, data: MODELS[0] });
  if (req.method === 'GET' && p === '/api/agent') return json(res, 200, { location: { directory: process.cwd() }, data: AGENTS });
  if (req.method === 'POST' && p === '/api/location/reload') return json(res, 204);
  if (req.method === 'PUT' && p.startsWith('/api/experimental/mcp/')) return json(res, 204);
  if (req.method === 'GET' && p === '/api/session/active') {
    return json(res, 200, { data: Object.fromEntries([...sessions.values()].filter((s) => s.running).map((s) => [s.info.id, { type: 'running' }])) });
  }
  if (req.method === 'POST' && p === '/api/session') {
    const s = newSession(body ?? {});
    return json(res, 200, { data: sessionInfo(s) });
  }

  const m = p.match(/^\/api\/(?:experimental\/)?session\/([^/]+)(?:\/(.*))?$/);
  if (!m) return json(res, 404, { _tag: 'NotFound', message: p });
  const s = sessions.get(decodeURIComponent(m[1]));
  const rest = m[2] ?? '';
  if (!s) return notFound(res);
  const sid = s.info.id;

  if (rest === '' && req.method === 'GET') return json(res, 200, { data: sessionInfo(s) });
  if (rest === '' && req.method === 'PATCH') {
    if (body?.permissions) s.info.permissions = body.permissions;
    if (body?.metadata) s.info.metadata = body.metadata;
    return json(res, 204);
  }
  if (rest === '' && req.method === 'DELETE') { sessions.delete(sid); return json(res, 204); }
  if (rest === 'model') { s.info.model = body.model; return json(res, 204); }
  if (rest === 'agent') { s.info.agent = body.agent; return json(res, 204); }
  if (rest === 'move') { s.info.location = { directory: body.directory }; return json(res, 204); }
  if (rest === 'environment') { s.env = body.variables; return json(res, 204); }
  if (rest.startsWith('instructions/entries/')) {
    const key = decodeURIComponent(rest.slice('instructions/entries/'.length));
    if (req.method === 'DELETE') delete s.instructions[key]; else s.instructions[key] = body.value;
    return json(res, 204);
  }
  if (rest === 'prompt') {
    if (s.running) return json(res, 409, { _tag: 'ConflictError', message: 'busy' });
    const id = nextId('msg');
    s.messages.push({ id, type: 'user', text: body.text, files: body.files, time: { created: Date.now() } });
    const run = { interrupted: false };
    s.running = run;
    json(res, 200, { data: { id, sessionID: sid, time: { created: Date.now() }, type: 'user', payload: { text: body.text }, delivery: 'steer' } });
    setTimeout(() => { void runPrompt(s, body.text, run).finally(() => { if (s.running === run) s.running = null; }); }, 5);
    return;
  }
  if (rest === 'interrupt') {
    const run = s.running;
    if (!run) return json(res, 200, { interrupted: false });
    run.interrupted = true;
    s.running = null;
    emit('session.execution.interrupted', { sessionID: sid, reason: 'user' });
    run.onInterrupt?.();
    return json(res, 200, { interrupted: true });
  }
  if (rest === 'compact') {
    json(res, 200, { data: { id: nextId('msg'), sessionID: sid, time: { created: Date.now() }, type: 'compaction', payload: {}, delivery: 'steer' } });
    setTimeout(() => { void runCompaction(s); }, 5);
    return;
  }
  if (rest === 'message' && req.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const cursor = url.searchParams.get('cursor');
    const start = cursor ? Number(cursor) : 0;
    const page = s.messages.slice(start, start + limit);
    const next = start + limit < s.messages.length ? String(start + limit) : null;
    return json(res, 200, { data: page, cursor: { next, previous: null } });
  }
  if (rest === 'fork') {
    const child = newSession({ title: `${s.info.title ?? ''} (fork)`, metadata: s.info.metadata, permissions: s.info.permissions, location: s.info.location, model: s.info.model, agent: s.info.agent });
    let copy = s.messages;
    if (body?.before) {
      const i = s.messages.findIndex((x) => x.id === body.before);
      if (i < 0) return notFound(res, 'MessageNotFoundError');
      copy = s.messages.slice(0, i);
    }
    const evt = nextId('evt');
    child.messages = copy.map((x, i) => ({ ...x, id: `${evt}_${i + 1}` }));
    child.info.fork = { sessionID: sid, boundary: body?.before ? { type: 'before', messageID: body.before } : { type: 'through', messageID: s.messages.at(-1)?.id ?? '' } };
    return json(res, 200, { data: sessionInfo(child) });
  }
  if (rest === 'revert/stage') {
    if (s.running) return json(res, 409, { _tag: 'SessionBusyError', sessionID: sid, message: 'busy' });
    if (!s.messages.some((x) => x.id === body.messageID)) return notFound(res, 'MessageNotFoundError');
    s.info.revert = { messageID: body.messageID };
    return json(res, 200, { data: s.info.revert });
  }
  if (rest === 'revert/commit') {
    const to = s.info.revert?.messageID;
    if (to) s.messages = s.messages.slice(0, s.messages.findIndex((x) => x.id === to));
    delete s.info.revert;
    return json(res, 204);
  }
  const perm = rest.match(/^permission\/([^/]+)\/reply$/);
  if (perm) {
    const r = permissions.get(decodeURIComponent(perm[1]));
    if (!r) return notFound(res, 'PermissionNotFoundError');
    permissions.delete(decodeURIComponent(perm[1]));
    r(body);
    return json(res, 204);
  }
  const formReply = rest.match(/^form\/([^/]+)\/reply$/);
  if (formReply) {
    const r = forms.get(decodeURIComponent(formReply[1]));
    if (!r) return notFound(res, 'FormNotFoundError');
    forms.delete(decodeURIComponent(formReply[1]));
    r({ answer: body.answer });
    return json(res, 204);
  }
  const formCancel = rest.match(/^form\/([^/]+)$/);
  if (formCancel && req.method === 'DELETE') {
    const r = forms.get(decodeURIComponent(formCancel[1]));
    if (!r) return notFound(res, 'FormNotFoundError');
    forms.delete(decodeURIComponent(formCancel[1]));
    r({ cancel: true, message: url.searchParams.get('message') ?? undefined });
    return json(res, 204);
  }
  return json(res, 404, { _tag: 'NotFound', message: `${req.method} ${p}` });
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/api/experimental/client-mcp' || !authorized(req)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return;
  }
  requests.push({ method: 'WS', path: url.pathname, query: url.search });
  acceptWebSocket(req, socket, url.searchParams.get('location[directory]') ?? process.cwd());
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  if (V1 || !args.includes('--stdio')) console.log(`opencode server listening on ${url}`);
  else console.log(JSON.stringify({ url }));
});

// The lease: stdin closing ends the server.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
process.stdin.resume();
