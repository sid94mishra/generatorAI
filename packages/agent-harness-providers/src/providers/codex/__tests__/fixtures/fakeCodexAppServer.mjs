#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// fakeCodexAppServer — a minimal `codex app-server` stand-in speaking the REAL
// newline-delimited JSON-RPC 2.0 protocol, used only by CodexProvider.test.ts.
//
// The method and notification names below are taken from
// `protocol/codex.generated.ts` — i.e. from the schema the real binary emits —
// not invented. The previous version of this fixture implemented
// `session.create` / `turn` / `turn.steer`, a vocabulary `codex app-server`
// has never spoken, so the whole suite passed against a fiction: every test
// agreed with the provider about a protocol neither shared with upstream.
//
// The provider under test spawns a REAL child process and talks to it over a
// REAL pipe, so a regression in framing, id correlation, error-response
// handling or process teardown fails the tests — not just a mock's
// assumptions about them.
//
// Behaviour is selected with env vars so one fixture covers every path:
//
//   FAKE_CODEX_THREAD_ERROR=1     `thread/start` answers with a JSON-RPC error.
//   FAKE_CODEX_TURN_RATE_LIMIT=N  the first N turns emit an `error`
//                                 notification with
//                                 `codexErrorInfo: "rateLimitExceeded"` — how
//                                 backpressure really arrives; the rest run
//                                 normally.
//   FAKE_CODEX_DIE_ON=<method>    exit(1) as soon as <method> is received,
//                                 without answering it.
//   FAKE_CODEX_SILENT=<method>    accept <method> and never answer it.
//   FAKE_CODEX_IGNORE_INTERRUPT=1 accept `turn/interrupt` but never end the
//                                 turn, so it only ends if the CLIENT settles.
//   FAKE_CODEX_APPROVAL=1         send an approval REQUEST mid-turn and only
//                                 continue once the client answers it. Pins
//                                 the defect where the provider never replied
//                                 and the turn hung until the RPC deadline.
//   FAKE_CODEX_STDERR=<text>      write <text> to stderr at startup.
//   FAKE_CODEX_IGNORE_SIGTERM=1   install a no-op SIGTERM handler, so only
//                                 SIGKILL can end this process.
//   FAKE_CODEX_SKIP_HANDSHAKE=1   reject `initialize`, to prove the provider
//                                 fails bring-up rather than carrying on.
//
// Prompt-driven turn shapes (matched against `turn/start`'s text input):
//   "TOOL_OK"        → item/started + item/completed (exit 0), turn/completed
//   "TOOL_TRUNCATE"  → one completed tool, one still-open tool, then an
//                      `error` notification with `contextWindowExceeded` →
//                      only the OPEN call may be failed by the guard
//   "HANG"           → deltas, then nothing (the turn never ends by itself)
//   "ERROR"          → an `error` notification with a non-retryable info
//   "SERVER_CANCEL"  → turn/completed with status "interrupted"
//   anything else    → an agent-message delta, then turn/completed
// ────────────────────────────────────────────────────────────────

import { createInterface } from 'node:readline';

const THREAD_ERROR = process.env['FAKE_CODEX_THREAD_ERROR'] === '1';
const RATE_LIMIT_TURNS = Number(process.env['FAKE_CODEX_TURN_RATE_LIMIT'] ?? '0');
const DIE_ON = process.env['FAKE_CODEX_DIE_ON'] ?? '';
const SILENT = process.env['FAKE_CODEX_SILENT'] ?? '';
const IGNORE_INTERRUPT = process.env['FAKE_CODEX_IGNORE_INTERRUPT'] === '1';
const WANT_APPROVAL = process.env['FAKE_CODEX_APPROVAL'] === '1';
const SKIP_HANDSHAKE = process.env['FAKE_CODEX_SKIP_HANDSHAKE'] === '1';

if (process.env['FAKE_CODEX_STDERR']) process.stderr.write(process.env['FAKE_CODEX_STDERR']);
if (process.env['FAKE_CODEX_IGNORE_SIGTERM'] === '1') process.on('SIGTERM', () => { /* deliberately deaf */ });

/** threadId → { turnId } while a turn is running. */
const running = new Map();
let turnCount = 0;
let threadCount = 0;
let itemCount = 0;
let serverRequestId = 0;
/** Server-request id → resolver, for approvals we are waiting on. */
const awaitingApproval = new Map();

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

const nextItemId = () => `item_${++itemCount}`;

// ── Turn scripts ─────────────────────────────────────────────────

function agentMessageItem(id, text) {
  return { type: 'agentMessage', id, text, phase: null, memoryCitation: null, delivery: null };
}

function commandItem(id, status, exitCode, output) {
  return {
    type: 'commandExecution',
    id,
    pluginId: null,
    scriptPath: null,
    command: 'echo hi',
    cwd: '/tmp',
    processId: null,
    source: 'model',
    status,
    commandActions: [],
    aggregatedOutput: output,
    exitCode,
    durationMs: 1,
  };
}

function endTurn(threadId, turnId, status, error) {
  running.delete(threadId);
  notify('turn/completed', {
    threadId,
    turn: {
      id: turnId,
      items: [],
      itemsView: 'complete',
      status,
      error: error ?? null,
      startedAt: 0,
      completedAt: 1,
      durationMs: 1,
    },
  });
}

async function runTurn(threadId, turnId, prompt) {
  // Backpressure arrives as an `error` NOTIFICATION carrying a
  // `codexErrorInfo`, never as JSON-RPC code -32001.
  if (turnCount <= RATE_LIMIT_TURNS) {
    notify('error', {
      threadId,
      turnId,
      willRetry: false,
      error: { message: 'rate limited', codexErrorInfo: 'rateLimitExceeded', additionalDetails: null, misalignment: null },
    });
    running.delete(threadId);
    return;
  }

  if (WANT_APPROVAL) {
    // Block the turn on a server→client request. If the client never answers,
    // nothing below runs and the turn hangs — which is exactly the defect the
    // corresponding test pins.
    await requestApproval(threadId);
  }

  if (prompt.includes('TOOL_OK')) {
    const id = nextItemId();
    notify('item/started', { threadId, turnId, startedAtMs: 0, item: commandItem(id, 'inProgress', null, null) });
    notify('item/completed', {
      threadId, turnId, completedAtMs: 1,
      item: commandItem(id, 'completed', 0, 'file body'),
    });
    const msg = nextItemId();
    notify('item/agentMessage/delta', { threadId, turnId, itemId: msg, delta: 'done ' });
    notify('item/completed', { threadId, turnId, completedAtMs: 2, item: agentMessageItem(msg, 'done ') });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('TOOL_TRUNCATE')) {
    const done = 'call_done';
    const open = 'call_open';
    notify('item/started', { threadId, turnId, startedAtMs: 0, item: commandItem(done, 'inProgress', null, null) });
    notify('item/completed', {
      threadId, turnId, completedAtMs: 1,
      item: commandItem(done, 'completed', 0, 'file body'),
    });
    notify('item/started', { threadId, turnId, startedAtMs: 2, item: commandItem(open, 'inProgress', null, null) });
    // Truncation is reported as a context-window error, not a stop reason.
    notify('error', {
      threadId,
      turnId,
      willRetry: false,
      error: { message: 'context window exceeded', codexErrorInfo: 'contextWindowExceeded', additionalDetails: null, misalignment: null },
    });
    running.delete(threadId);
    return;
  }

  if (prompt.includes('HANG')) {
    const msg = nextItemId();
    notify('item/agentMessage/delta', { threadId, turnId, itemId: msg, delta: 'thinking' });
    return; // never ends
  }

  if (prompt.includes('ERROR')) {
    notify('error', {
      threadId,
      turnId,
      willRetry: false,
      error: { message: 'something broke', codexErrorInfo: 'internalServerError', additionalDetails: null, misalignment: null },
    });
    running.delete(threadId);
    return;
  }

  if (prompt.includes('SERVER_CANCEL')) {
    endTurn(threadId, turnId, 'interrupted');
    return;
  }

  const msg = nextItemId();
  notify('item/agentMessage/delta', { threadId, turnId, itemId: msg, delta: 'hello ' });
  notify('item/completed', { threadId, turnId, completedAtMs: 1, item: agentMessageItem(msg, 'hello ') });
  endTurn(threadId, turnId, 'completed');
}

/** Send an approval request and wait for the client's answer. */
function requestApproval(threadId) {
  const id = `srv_${++serverRequestId}`;
  return new Promise((resolve) => {
    awaitingApproval.set(id, resolve);
    send({
      jsonrpc: '2.0',
      id,
      method: 'item/commandExecution/requestApproval',
      params: { threadId, itemId: nextItemId(), command: 'rm -rf /', cwd: '/tmp', reason: null },
    });
  });
}

// ── Dispatch ─────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  // A response to one of OUR server requests (an approval decision).
  if (msg.id != null && msg.method === undefined) {
    const resolve = awaitingApproval.get(msg.id);
    if (resolve) {
      awaitingApproval.delete(msg.id);
      resolve(msg.result ?? null);
    }
    return;
  }

  const { id, method, params } = msg;
  if (DIE_ON && method === DIE_ON) process.exit(1);
  if (SILENT && method === SILENT) return;

  switch (method) {
    case 'initialize':
      if (SKIP_HANDSHAKE) { respondError(id, -32600, 'handshake refused'); return; }
      respond(id, {
        userAgent: 'fake-codex/0.0.0',
        codexHome: '/tmp/.codex',
        platformFamily: 'unix',
        platformOs: 'linux',
      });
      return;

    case 'initialized':
      return; // notification, no reply

    case 'thread/start': {
      if (THREAD_ERROR) { respondError(id, -32602, 'invalid thread params'); return; }
      const threadId = `thr_${++threadCount}`;
      respond(id, {
        thread: { id: threadId, sessionId: threadId, status: { type: 'idle' } },
        model: params?.model ?? 'gpt-5-codex',
        modelProvider: 'openai',
        serviceTier: null,
        cwd: params?.cwd ?? '/tmp',
        instructionSources: [],
        approvalPolicy: params?.approvalPolicy ?? 'never',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
        reasoningEffort: null,
      });
      return;
    }

    case 'thread/resume': {
      const threadId = params?.threadId ?? `thr_${++threadCount}`;
      respond(id, {
        thread: { id: threadId, sessionId: threadId, status: { type: 'idle' } },
        model: 'gpt-5-codex',
        modelProvider: 'openai',
        serviceTier: null,
        cwd: '/tmp',
        instructionSources: [],
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
        reasoningEffort: null,
        turnsBackwardsCursor: null,
        itemsBackwardsCursor: null,
      });
      return;
    }

    case 'thread/delete':
      respond(id, {});
      return;

    case 'thread/items/list':
      respond(id, {
        data: [
          { turnId: 't1', item: { type: 'userMessage', id: 'u1', clientId: null, content: [{ type: 'text', text: 'hi', text_elements: [] }] } },
          { turnId: 't1', item: agentMessageItem('a1', 'hello ') },
        ],
        nextCursor: null,
        backwardsCursor: null,
      });
      return;

    case 'turn/start': {
      const threadId = params?.threadId;
      const turnId = `turn_${++turnCount}`;
      running.set(threadId, { turnId });
      respond(id, {
        turn: {
          id: turnId, items: [], itemsView: 'complete', status: 'inProgress',
          error: null, startedAt: 0, completedAt: null, durationMs: null,
        },
      });
      const text = (params?.input ?? [])
        .filter((p) => p?.type === 'text')
        .map((p) => p.text ?? '')
        .join(' ');
      // Deferred so the `turn/start` RESPONSE is written before any of the
      // turn's notifications — the provider learns the turn id from it.
      setImmediate(() => { void runTurn(threadId, turnId, text); });
      return;
    }

    case 'turn/interrupt': {
      respond(id, {});
      if (IGNORE_INTERRUPT) return;
      const threadId = params?.threadId;
      const state = running.get(threadId);
      if (state) endTurn(threadId, state.turnId, 'interrupted');
      return;
    }

    case 'model/list':
      respond(id, {
        data: [{
          id: 'gpt-5-codex',
          model: 'gpt-5-codex',
          upgrade: null,
          upgradeInfo: null,
          availabilityNux: null,
          displayName: 'GPT-5 Codex',
          description: 'Fixture model',
          modelSpecialty: null,
          hidden: false,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: 'medium',
          inputModalities: ['text'],
          supportsPersonality: false,
          multiAgentVersion: null,
          additionalSpeedTiers: [],
          serviceTiers: [],
          defaultServiceTier: null,
          isDefault: true,
        }],
        nextCursor: null,
      });
      return;

    default:
      if (id != null) respondError(id, -32601, `unknown method ${method}`);
  }
});
