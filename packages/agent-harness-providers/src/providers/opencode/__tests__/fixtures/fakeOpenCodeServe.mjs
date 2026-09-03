#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// fakeOpenCodeServe — a stand-in for `opencode serve`, used by
// OpenCodeProvider.test.ts.
//
// Every route and event name below is taken from `schemas/opencode/openapi.json`
// — the OpenAPI document a real `opencode serve` publishes at `GET /doc` — and
// the event ORDERING was captured from a real turn against opencode-ai@1.18.25.
//
// The previous fixture answered `{}` to every request and listened on a fixed
// port, which was enough only because the provider's own contract was wrong:
// it expected `POST /session/{id}/message` to return an SSE stream. It does
// not. This fixture implements the real split — a server-wide `GET /event`
// stream plus a JSON prompt route — so the tests exercise what the provider
// will actually meet.
//
//   node fakeOpenCodeServe.mjs serve --hostname 127.0.0.1 --port <n>
//
// Env knobs:
//   FAKE_OPENCODE_EXIT=1        exit(3) immediately instead of listening, so a
//                               server that fails to start reports its own
//                               reason rather than a blank startup timeout.
//   FAKE_OPENCODE_NO_ANNOUNCE=1 listen, but never print the listening URL, so
//                               the address-discovery timeout can be exercised.
//
// Prompt-driven turn shapes (matched against the prompt text):
//   "TOOL_OK"       → a tool part running → completed, then text, then idle
//   "TOOL_TRUNCATE" → one completed tool, one left running, then a
//                     MessageOutputLengthError → only the OPEN call may be
//                     failed by the truncation guard
//   "HANG"          → a token, then nothing (no idle, no HTTP response)
//   "ERROR"         → a session.error with a non-abort, non-truncation name
//   "SERVER_CANCEL" → a MessageAbortedError
//   anything else   → two text frames (proving cumulative text is diffed into
//                     deltas rather than replayed whole), then idle
// ────────────────────────────────────────────────────────────────

import { createServer } from 'node:http';

if (process.env['FAKE_OPENCODE_EXIT'] === '1') {
  process.stderr.write('opencode: address already in use\n');
  process.exit(3);
}

const NO_ANNOUNCE = process.env['FAKE_OPENCODE_NO_ANNOUNCE'] === '1';

const portIdx = process.argv.indexOf('--port');
const port = portIdx >= 0 ? Number(process.argv[portIdx + 1]) : 0;

let sessionCount = 0;
let messageCount = 0;
let partCount = 0;
let eventCount = 0;

/** sessionId → session record. */
const sessions = new Map();
/** Connected SSE clients. */
const streams = new Set();
/** sessionId → true while a turn is running, so abort has something to stop. */
const running = new Map();

function emit(type, properties) {
  const frame = `data: ${JSON.stringify({ id: `evt_${++eventCount}`, type, properties })}\n\n`;
  for (const res of streams) res.write(frame);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

const textPart = (id, messageID, sessionID, text) => ({
  id, sessionID, messageID, type: 'text', text, time: { start: 0 },
});

const toolPart = (id, messageID, sessionID, callID, tool, state) => ({
  id, sessionID, messageID, type: 'tool', callID, tool, state,
});

/**
 * Run a turn: emit stream events, then resolve with the final HTTP body.
 * Mirrors the real server, where the POST resolves only once the turn is over.
 */
function runTurn(sessionID, prompt) {
  return new Promise((resolve) => {
    const messageID = `msg_${++messageCount}`;
    running.set(sessionID, { messageID, resolve });

    // The assistant message is announced first; parts that follow belong to it.
    emit('message.updated', {
      sessionID,
      info: { id: messageID, sessionID, role: 'assistant', time: { created: 0 } },
    });

    const finish = (finishReason, parts) => {
      running.delete(sessionID);
      emit('message.updated', {
        sessionID,
        info: { id: messageID, sessionID, role: 'assistant', finish: finishReason, time: { created: 0, completed: 1 } },
      });
      emit('session.idle', { sessionID });
      resolve({
        info: { id: messageID, sessionID, role: 'assistant', finish: finishReason },
        parts,
      });
    };

    const fail = (name, message) => {
      running.delete(sessionID);
      emit('session.error', { sessionID, error: { name, data: { message } } });
      // The real server still answers the POST; the stream carries the reason.
      resolve({ info: { id: messageID, sessionID, role: 'assistant', finish: name === 'MessageAbortedError' ? 'aborted' : 'error' }, parts: [] });
    };

    if (prompt.includes('TOOL_OK')) {
      const pid = `prt_${++partCount}`;
      emit('message.part.updated', {
        sessionID, time: 0,
        part: toolPart(pid, messageID, sessionID, 'call_ok', 'read', { status: 'running', input: { path: '/f' }, time: { start: 0 } }),
      });
      emit('message.part.updated', {
        sessionID, time: 1,
        part: toolPart(pid, messageID, sessionID, 'call_ok', 'read', {
          status: 'completed', input: { path: '/f' }, output: 'file body', title: 'read', metadata: {}, time: { start: 0, end: 1 },
        }),
      });
      const tid = `prt_${++partCount}`;
      emit('message.part.updated', { sessionID, time: 2, part: textPart(tid, messageID, sessionID, 'done ') });
      finish('stop', [textPart(tid, messageID, sessionID, 'done ')]);
      return;
    }

    if (prompt.includes('TOOL_TRUNCATE')) {
      const donePart = `prt_${++partCount}`;
      emit('message.part.updated', {
        sessionID, time: 0,
        part: toolPart(donePart, messageID, sessionID, 'call_done', 'read', { status: 'running', input: {}, time: { start: 0 } }),
      });
      emit('message.part.updated', {
        sessionID, time: 1,
        part: toolPart(donePart, messageID, sessionID, 'call_done', 'read', {
          status: 'completed', input: {}, output: 'file body', title: 'read', metadata: {}, time: { start: 0, end: 1 },
        }),
      });
      const openPart = `prt_${++partCount}`;
      emit('message.part.updated', {
        sessionID, time: 2,
        part: toolPart(openPart, messageID, sessionID, 'call_open', 'write', { status: 'running', input: {}, time: { start: 2 } }),
      });
      // Truncation is a session.error, not a stop-reason field.
      fail('MessageOutputLengthError', 'output length exceeded');
      return;
    }

    if (prompt.includes('HANG')) {
      const tid = `prt_${++partCount}`;
      emit('message.part.updated', { sessionID, time: 0, part: textPart(tid, messageID, sessionID, 'thinking') });
      return; // never finishes
    }

    if (prompt.includes('ERROR')) {
      fail('UnknownError', 'something broke');
      return;
    }

    if (prompt.includes('SERVER_CANCEL')) {
      fail('MessageAbortedError', 'aborted by server');
      return;
    }

    // Two frames carrying CUMULATIVE text. A provider that emits `part.text`
    // verbatim would produce "hel" + "hello " — replaying the prefix — instead
    // of the two deltas "hel" and "lo ".
    const tid = `prt_${++partCount}`;
    emit('message.part.updated', { sessionID, time: 0, part: textPart(tid, messageID, sessionID, 'hel') });
    emit('message.part.updated', { sessionID, time: 1, part: textPart(tid, messageID, sessionID, 'hello ') });
    finish('stop', [textPart(tid, messageID, sessionID, 'hello ')]);
  });
}

// ── Routes ───────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // Server-wide SSE subscription — the ONLY place streaming happens.
  if (method === 'GET' && path === '/event') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ id: 'evt_0', type: 'server.connected', properties: {} })}\n\n`);
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }

  if (method === 'GET' && path === '/session') {
    json(res, 200, [...sessions.values()]);
    return;
  }

  if (method === 'POST' && path === '/session') {
    const body = await readBody(req);
    const id = `ses_${++sessionCount}`;
    const session = {
      id,
      projectID: 'proj',
      directory: '/tmp',
      title: body.title ?? 'untitled',
      version: '1.18.25',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    };
    sessions.set(id, session);
    json(res, 200, session);
    return;
  }

  if (method === 'GET' && path === '/agent') {
    json(res, 200, [
      { name: 'build', description: 'Build agent', model: { providerID: 'opencode', modelID: 'big' } },
      { name: 'plan', description: 'Planning agent' },
    ]);
    return;
  }

  if (method === 'GET' && path === '/config/providers') {
    json(res, 200, {
      default: { opencode: 'big' },
      providers: [{
        id: 'opencode',
        name: 'OpenCode',
        source: 'config',
        env: [],
        models: {
          big: {
            id: 'big',
            name: 'Big Model',
            capabilities: { reasoning: true, toolcall: true, input: { text: true, image: true } },
            limit: { context: 200000, output: 8192 },
          },
        },
      }],
    });
    return;
  }

  const sessionMatch = /^\/session\/([^/]+)(\/.*)?$/.exec(path);
  if (sessionMatch) {
    const sessionID = decodeURIComponent(sessionMatch[1]);
    const rest = sessionMatch[2] ?? '';

    if (method === 'GET' && rest === '') {
      const s = sessions.get(sessionID);
      if (!s) { json(res, 404, { name: 'NotFoundError', data: {} }); return; }
      json(res, 200, s);
      return;
    }

    if (method === 'DELETE' && rest === '') {
      sessions.delete(sessionID);
      json(res, 200, true);
      return;
    }

    if (method === 'GET' && rest === '/message') {
      json(res, 200, [
        { info: { id: 'msg_u', role: 'user' }, parts: [textPart('p1', 'msg_u', sessionID, 'hi')] },
        { info: { id: 'msg_a', role: 'assistant' }, parts: [textPart('p2', 'msg_a', sessionID, 'hello ')] },
      ]);
      return;
    }

    if (method === 'POST' && rest === '/abort') {
      const state = running.get(sessionID);
      json(res, 200, true);
      if (state) {
        running.delete(sessionID);
        emit('session.error', { sessionID, error: { name: 'MessageAbortedError', data: { message: 'aborted' } } });
        state.resolve({ info: { id: state.messageID, sessionID, role: 'assistant', finish: 'aborted' }, parts: [] });
      }
      return;
    }

    // The prompt route returns JSON when the turn is over — NOT a stream.
    if (method === 'POST' && rest === '/message') {
      if (!sessions.has(sessionID)) { json(res, 404, { name: 'NotFoundError', data: {} }); return; }
      const body = await readBody(req);
      const prompt = (body.parts ?? [])
        .filter((p) => p?.type === 'text')
        .map((p) => p.text ?? '')
        .join(' ');
      const result = await runTurn(sessionID, prompt);
      json(res, 200, result);
      return;
    }
  }

  json(res, 404, { name: 'NotFoundError', data: {} });
});

server.listen(port, '127.0.0.1', () => {
  if (NO_ANNOUNCE) return;
  const addr = server.address();
  // The real server prints exactly this line; the provider reads the bound
  // port off it, which is the only way to learn an ephemeral one.
  process.stdout.write(`opencode server listening on http://127.0.0.1:${addr.port}\n`);
});
