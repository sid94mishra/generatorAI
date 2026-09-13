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
//   "COLLAB"         → the multi-agent shapes: a `collabAgentToolCall` item
//                      (spawnAgent → completed) plus `subAgentActivity`
//                      started/completed, which the provider maps to an
//                      `Agent` tool call and sub-agent session_info notices
//   "TOOL_TRUNCATE"  → one completed tool, one still-open tool, then an
//                      `error` notification with `contextWindowExceeded` →
//                      only the OPEN call may be failed by the guard
//   "HANG"           → deltas, then nothing (the turn never ends by itself)
//   "ERROR"          → an `error` notification with a non-retryable info
//   "SERVER_CANCEL"  → turn/completed with status "interrupted"
//   "ECHO_PARAMS"    → the agent message is a JSON dump of the params this
//                      thread was STARTED/RESUMED with and the params of the
//                      turn itself, so a test can assert what actually went
//                      over the wire (cwd, sandboxPolicy.writableRoots)
//                      instead of trusting a mock.
//   "RICH"           → the shapes a real 0.153 turn produces: turn/started,
//                      a reasoning summary, a commentary message, a host
//                      dynamic-tool call (awaits the client's answer), a
//                      one-file patch, token usage, then the final answer
//                      (which quotes the tool's output)
//   "ECHO_DECISION"  → with FAKE_CODEX_APPROVAL=1, the agent message is the
//                      client's approval answer as JSON
//   "PROGRESS_DEMO"  → a command and a patch that stream output while open:
//                      item/commandExecution/outputDelta,
//                      item/fileChange/outputDelta, fileChange/patchUpdated,
//                      item/mcpToolCall/progress and turn/diff/updated
//   "PLAN_DEMO"      → turn/plan/updated twice (the second with a step done),
//                      then a streamed `plan` item via item/plan/delta
//   "WARN_DEMO"      → warning / configWarning / deprecationNotice /
//                      guardianWarning / model/rerouted / thread/compacted,
//                      plus an `error` with willRetry:true (which must NOT end
//                      the turn), then a normal completion
//   "RATE_DEMO"      → account/rateLimits/updated with both windows
//   "ASK_DEMO"       → item/tool/requestUserInput; the agent message is the
//                      client's answer map as JSON
//   "PERM_DEMO"      → item/permissions/requestApproval; the agent message is
//                      the client's response (or its error) as JSON
//   "CLOSE_DEMO"     → thread/status/changed → systemError mid-turn, and then
//                      nothing at all (only the client can settle the turn)
//   "REASON_PARTS"   → two reasoning summary parts separated by
//                      item/reasoning/summaryPartAdded
//   anything else    → an agent-message delta, then turn/completed
//
// FAKE_CODEX_RATE_LIMITS=1  answer `account/rateLimits/read` with a snapshot
//                           (otherwise it is "method not found", like an older
//                           binary, so the provider must degrade gracefully).
// FAKE_CODEX_MCP_STATUS=<mode>  answer `mcpServerStatus/list`:
//                           "failed"  → one healthy server, one that failed to
//                                       start and one whose catalogue errored
//                           "ok"      → one healthy server
//                           unset     → "method not found"
//
// Account (`account/read`), FAKE_CODEX_ACCOUNT:
//   unset / "chatgpt" → signed in with ChatGPT (pro)
//   "none"            → signed out; auth required
//   "apikey"          → API-key auth
// ────────────────────────────────────────────────────────────────

import { createInterface } from 'node:readline';

const THREAD_ERROR = process.env['FAKE_CODEX_THREAD_ERROR'] === '1';
/** Set to make `thread/revert` answer "method not found" so the rollback fallback is exercised. */
const REVERT_UNSUPPORTED = process.env['FAKE_CODEX_REVERT_UNSUPPORTED'] === '1';
const forkCalls = [];
const revertCalls = [];
const rollbackCalls = [];
const ACCOUNT = process.env['FAKE_CODEX_ACCOUNT'] ?? 'chatgpt';
let skillRoots = null;
const RATE_LIMIT_TURNS = Number(process.env['FAKE_CODEX_TURN_RATE_LIMIT'] ?? '0');
const DIE_ON = process.env['FAKE_CODEX_DIE_ON'] ?? '';
const SILENT = process.env['FAKE_CODEX_SILENT'] ?? '';
const IGNORE_INTERRUPT = process.env['FAKE_CODEX_IGNORE_INTERRUPT'] === '1';
const WANT_APPROVAL = process.env['FAKE_CODEX_APPROVAL'] === '1';
const SKIP_HANDSHAKE = process.env['FAKE_CODEX_SKIP_HANDSHAKE'] === '1';
const RATE_LIMITS_READ = process.env['FAKE_CODEX_RATE_LIMITS'] === '1';
const MCP_STATUS = process.env['FAKE_CODEX_MCP_STATUS'] ?? '';

if (process.env['FAKE_CODEX_STDERR']) process.stderr.write(process.env['FAKE_CODEX_STDERR']);
if (process.env['FAKE_CODEX_IGNORE_SIGTERM'] === '1') process.on('SIGTERM', () => { /* deliberately deaf */ });

/** threadId → { turnId } while a turn is running. */
const running = new Map();
/** threadId → the `thread/start` (or `thread/resume`) params it was created with. */
const threadParams = new Map();
let turnCount = 0;
let threadCount = 0;
let itemCount = 0;
let serverRequestId = 0;
/** Server-request id → resolver, for approvals we are waiting on. */
const awaitingApproval = new Map();
/**
 * Ids whose resolver wants the WHOLE envelope, not just `result`.
 *
 * A declined permission escalation is answered with a JSON-RPC *error*, so a
 * resolver that only ever saw `result` could not tell "denied" from "granted
 * nothing" — which is the distinction the escalation test exists to make.
 */
const awaitingRaw = new Set();

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

async function runTurn(threadId, turnId, prompt, turnStartParams) {
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

  let decision = null;
  if (WANT_APPROVAL) {
    // Block the turn on a server→client request. If the client never answers,
    // nothing below runs and the turn hangs — which is exactly the defect the
    // corresponding test pins.
    decision = await requestApproval(threadId);
  }

  if (prompt.includes('ECHO_DECISION')) {
    const msg = nextItemId();
    const text = JSON.stringify(decision);
    notify('item/agentMessage/delta', { threadId, turnId, itemId: msg, delta: text });
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: agentMessageItem(msg, text) });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('PROGRESS_DEMO')) {
    const cmd = 'call_progress';
    notify('item/started', { threadId, turnId, startedAtMs: 0, item: commandItem(cmd, 'inProgress', null, null) });
    notify('item/commandExecution/outputDelta', { threadId, turnId, itemId: cmd, delta: 'line one\n' });
    notify('item/commandExecution/outputDelta', { threadId, turnId, itemId: cmd, delta: 'line two\n' });
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: commandItem(cmd, 'completed', 0, 'line one\nline two\n') });

    const fc = 'call_patch';
    const change = { path: 'src/b.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b\n' };
    notify('item/started', { threadId, turnId, startedAtMs: 2, item: { type: 'fileChange', id: fc, changes: [change], status: 'inProgress' } });
    notify('item/fileChange/outputDelta', { threadId, turnId, itemId: fc, delta: 'applying hunk 1/1\n' });
    notify('item/fileChange/patchUpdated', { threadId, turnId, itemId: fc, changes: [change] });
    notify('item/completed', { threadId, turnId, completedAtMs: 3, item: { type: 'fileChange', id: fc, changes: [change], status: 'completed' } });

    const mcp = 'call_mcp';
    notify('item/started', { threadId, turnId, startedAtMs: 4, item: { type: 'mcpToolCall', id: mcp, server: 'linear', tool: 'search', arguments: {}, status: 'inProgress', error: null, result: null } });
    notify('item/mcpToolCall/progress', { threadId, turnId, itemId: mcp, message: 'searching issues…' });
    notify('item/completed', { threadId, turnId, completedAtMs: 5, item: { type: 'mcpToolCall', id: mcp, server: 'linear', tool: 'search', arguments: {}, status: 'completed', error: null, result: { ok: true } } });

    notify('turn/diff/updated', { threadId, turnId, diff: 'diff --git a/src/b.ts b/src/b.ts\n@@ -1 +1 @@\n-a\n+b\n' });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('PLAN_DEMO')) {
    const plan = (s2) => ([
      { step: 'read the parser', status: 'completed' },
      { step: 'fix the bug', status: s2 },
      { step: 'add a test', status: 'pending' },
    ]);
    notify('turn/plan/updated', { threadId, turnId, explanation: 'Three steps.', plan: plan('inProgress') });
    // Re-sent unchanged: the provider must not file a second identical update.
    notify('turn/plan/updated', { threadId, turnId, explanation: 'Three steps.', plan: plan('inProgress') });
    notify('turn/plan/updated', { threadId, turnId, explanation: 'Three steps.', plan: plan('completed') });

    // The same plan again, this time as a streamed markdown item.
    const pid = 'item_plan';
    notify('item/started', { threadId, turnId, startedAtMs: 0, item: { type: 'plan', id: pid, text: '' } });
    notify('item/plan/delta', { threadId, turnId, itemId: pid, delta: '- [x] read the parser\n' });
    notify('item/plan/delta', { threadId, turnId, itemId: pid, delta: '- [ ] ship it\n' });
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: { type: 'plan', id: pid, text: '- [x] read the parser\n- [ ] ship it\n' } });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('WARN_DEMO')) {
    // Thread-less on purpose: these are exactly the notifications the per-turn
    // handler cannot see, so a provider that only listens per turn drops them.
    notify('warning', { message: 'Your sandbox is running in degraded mode.', threadId: null });
    notify('configWarning', { summary: 'Unknown key "modl"', path: '/home/u/.codex/config.toml', details: 'Did you mean "model"?', range: null });
    notify('deprecationNotice', { summary: 'Detached review threads', details: 'Use thread/start then an inline review.' });
    notify('guardianWarning', { threadId, message: 'This command touches credentials.' });
    notify('model/rerouted', { threadId, turnId, fromModel: 'gpt-5.6-terra', toModel: 'gpt-5.6-luna', reason: 'highRiskCyberActivity' });
    notify('thread/compacted', { threadId, turnId });
    // A retry the SERVER is handling: it must be announced but must not end
    // the turn, which continues below.
    notify('error', { threadId, turnId, willRetry: true, error: { message: 'upstream hiccup', codexErrorInfo: 'serverOverloaded', additionalDetails: null, misalignment: null } });
    const msg = nextItemId();
    notify('item/agentMessage/delta', { threadId, turnId, itemId: msg, delta: 'warned ' });
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: agentMessageItem(msg, 'warned ') });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('RATE_DEMO')) {
    notify('account/rateLimits/updated', { rateLimits: {
      limitId: 'codex',
      limitName: 'Codex',
      primary: { usedPercent: 42.4, resetsAt: 1800000000, windowDurationMins: 300 },
      secondary: { usedPercent: 7, resetsAt: null, windowDurationMins: 10080 },
      credits: null,
      individualLimit: null,
      normalModelSlug: null,
      planType: 'pro',
      rateLimitReachedType: null,
      spendControlReached: false,
    } });
    const msg = nextItemId();
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: agentMessageItem(msg, 'quota ') });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('ASK_DEMO')) {
    const answer = await new Promise((resolve) => {
      const reqId = `srv_${++serverRequestId}`;
      awaitingApproval.set(reqId, resolve);
      send({ jsonrpc: '2.0', id: reqId, method: 'item/tool/requestUserInput', params: {
        threadId, turnId, itemId: nextItemId(), isBlocking: true, autoResolutionMs: null,
        questions: [{
          id: 'q1', header: 'Router', question: 'Which router should I use?',
          options: [{ label: 'react-router', description: 'The incumbent' }, { label: 'tanstack', description: 'Newer' }],
          isOther: true, isSecret: false,
        }],
      } });
    });
    const msg = nextItemId();
    const text = JSON.stringify(answer);
    notify('item/agentMessage/delta', { threadId, turnId, itemId: msg, delta: text });
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: agentMessageItem(msg, text) });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('PERM_DEMO')) {
    const reply = await new Promise((resolve) => {
      const reqId = `srv_${++serverRequestId}`;
      // Recorded raw so the test can tell a grant from the error response.
      awaitingRaw.add(reqId);
      awaitingApproval.set(reqId, resolve);
      send({ jsonrpc: '2.0', id: reqId, method: 'item/permissions/requestApproval', params: {
        threadId, turnId, itemId: nextItemId(), startedAtMs: 0, environmentId: null,
        cwd: '/tmp', reason: 'The build needs the npm registry.',
        permissions: {
          fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: '/tmp/out' } }], read: null, write: null, globScanMaxDepth: null },
          network: { enabled: true },
        },
      } });
    });
    const msg = nextItemId();
    const text = JSON.stringify(reply);
    notify('item/agentMessage/delta', { threadId, turnId, itemId: msg, delta: text });
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: agentMessageItem(msg, text) });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('FAIL_QUIET')) {
    // A command that fails with NOTHING on stdout/stderr — a sandbox denial
    // looks exactly like this. The exit code is the only signal.
    const id = `cmd_${++itemCount}`;
    notify('item/started', { threadId, turnId, startedAtMs: 0, item: commandItem(id, 'inProgress', null, null) });
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: commandItem(id, 'completed', 7, '') });
    const msg = `msg_${++itemCount}`;
    notify('item/agentMessage/delta', { threadId, turnId, itemId: msg, delta: 'it failed' });
    notify('item/completed', { threadId, turnId, completedAtMs: 2, item: agentMessageItem(msg, 'it failed') });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('CLOSE_DEMO')) {
    const msg = nextItemId();
    notify('item/agentMessage/delta', { threadId, turnId, itemId: msg, delta: 'starting ' });
    notify('item/started', { threadId, turnId, startedAtMs: 0, item: commandItem('call_doomed', 'inProgress', null, null) });
    notify('thread/status/changed', { threadId, status: { type: 'systemError' } });
    return; // the thread is gone; nothing else will ever arrive
  }

  if (prompt.includes('REASON_PARTS')) {
    const rs = nextItemId();
    notify('item/started', { threadId, turnId, startedAtMs: 0, item: { type: 'reasoning', id: rs, summary: [], content: [] } });
    notify('item/reasoning/summaryTextDelta', { threadId, turnId, itemId: rs, summaryIndex: 0, delta: 'First part.' });
    notify('item/reasoning/summaryPartAdded', { threadId, turnId, itemId: rs, summaryIndex: 1 });
    notify('item/reasoning/summaryTextDelta', { threadId, turnId, itemId: rs, summaryIndex: 1, delta: 'Second part.' });
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: { type: 'reasoning', id: rs, summary: ['First part.', 'Second part.'], content: [] } });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('RICH')) {
    notify('turn/started', { threadId, turn: { id: turnId, items: [], itemsView: 'notLoaded', status: 'inProgress', error: null, startedAt: 0, completedAt: null, durationMs: null } });
    const rs = nextItemId();
    notify('item/started', { threadId, turnId, startedAtMs: 0, item: { type: 'reasoning', id: rs, summary: [], content: [] } });
    notify('item/reasoning/summaryTextDelta', { threadId, turnId, itemId: rs, summaryIndex: 0, delta: 'Plan the ' });
    notify('item/reasoning/textDelta', { threadId, turnId, itemId: rs, contentIndex: 0, delta: 'RAW-SHOULD-NOT-RELAY' });
    notify('item/reasoning/summaryTextDelta', { threadId, turnId, itemId: rs, summaryIndex: 0, delta: 'work' });
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: { type: 'reasoning', id: rs, summary: ['Plan the work'], content: [] } });

    const c1 = nextItemId();
    notify('item/agentMessage/delta', { threadId, turnId, itemId: c1, delta: 'Checking first.' });
    notify('item/completed', { threadId, turnId, completedAtMs: 2, item: { ...agentMessageItem(c1, 'Checking first.'), phase: 'commentary' } });

    const callId = nextItemId();
    const toolReply = await new Promise((resolve) => {
      const reqId = `srv_${++serverRequestId}`;
      awaitingApproval.set(reqId, resolve);
      send({ jsonrpc: '2.0', id: reqId, method: 'item/tool/call', params: { threadId, turnId, callId, namespace: null, tool: 'get_magic_number', arguments: { label: 'fixture' } } });
    });
    notify('item/completed', { threadId, turnId, completedAtMs: 3, item: { type: 'dynamicToolCall', id: callId, namespace: null, tool: 'get_magic_number', arguments: { label: 'fixture' }, status: 'completed', contentItems: toolReply?.contentItems ?? [], success: toolReply?.success ?? false, durationMs: 1 } });

    const fc = nextItemId();
    const change = { path: 'src/a.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1,2 +1,3 @@\n-old\n+new\n+added\n same' };
    notify('item/started', { threadId, turnId, startedAtMs: 4, item: { type: 'fileChange', id: fc, changes: [change], status: 'inProgress' } });
    notify('item/completed', { threadId, turnId, completedAtMs: 5, item: { type: 'fileChange', id: fc, changes: [change], status: 'completed' } });

    notify('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: {
      total: { totalTokens: 1150, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 150, reasoningOutputTokens: 20 },
      last: { totalTokens: 1150, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 150, reasoningOutputTokens: 20 },
      modelContextWindow: 272000,
    } });

    const fin = nextItemId();
    const answer = `MAGIC=${(toolReply?.contentItems?.[0]?.text ?? '').replace(/\D/g, '')}`;
    notify('item/agentMessage/delta', { threadId, turnId, itemId: fin, delta: answer });
    notify('item/completed', { threadId, turnId, completedAtMs: 6, item: { ...agentMessageItem(fin, answer), phase: 'final_answer' } });
    endTurn(threadId, turnId, 'completed');
    return;
  }

  if (prompt.includes('COLLAB')) {
    const collabId = 'collab_1';
    const activityId = 'subact_1';
    const collab = (status) => ({
      type: 'collabAgentToolCall',
      id: collabId,
      tool: 'spawnAgent',
      status,
      senderThreadId: threadId,
      receiverThreadIds: ['thread_child'],
      agentsStates: { thread_child: { status: status === 'completed' ? 'completed' : 'running' } },
      prompt: 'investigate the parser',
      model: 'gpt-5.6-terra',
    });
    notify('item/started', { threadId, turnId, startedAtMs: 0, item: collab('inProgress') });
    notify('item/started', {
      threadId, turnId, startedAtMs: 1,
      item: { type: 'subAgentActivity', id: activityId, kind: 'started', agentPath: 'agents/parser.md', agentThreadId: 'thread_child' },
    });
    notify('item/completed', {
      threadId, turnId, completedAtMs: 2,
      item: { type: 'subAgentActivity', id: activityId, kind: 'completed', agentPath: 'agents/parser.md', agentThreadId: 'thread_child' },
    });
    notify('item/completed', { threadId, turnId, completedAtMs: 3, item: collab('completed') });
    const msg = nextItemId();
    notify('item/completed', { threadId, turnId, completedAtMs: 4, item: agentMessageItem(msg, 'delegated ') });
    endTurn(threadId, turnId, 'completed');
    return;
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

  if (prompt.includes('LONG_CMD')) {
    // A command that is still running when the client interrupts the turn.
    const id = 'call_long';
    notify('item/started', { threadId, turnId, startedAtMs: 0, item: commandItem(id, 'inProgress', null, null) });
    return; // never ends by itself
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

  if (prompt.includes('ECHO_PARAMS')) {
    const msg = nextItemId();
    const text = JSON.stringify({
      thread: threadParams.get(threadId) ?? null,
      turn: turnStartParams ?? null,
      skillRoots,
    });
    notify('item/agentMessage/delta', { threadId, turnId, itemId: msg, delta: text });
    notify('item/completed', { threadId, turnId, completedAtMs: 1, item: agentMessageItem(msg, text) });
    endTurn(threadId, turnId, 'completed');
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
      if (awaitingRaw.delete(msg.id)) resolve({ result: msg.result ?? null, error: msg.error ?? null });
      else resolve(msg.result ?? null);
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
      threadParams.set(threadId, params ?? null);
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
      threadParams.set(threadId, params ?? null);
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

    // Branching — recorded so tests can assert the anchor that was sent.
    case 'thread/fork': {
      const threadId = `thr_${++threadCount}`;
      threadParams.set(threadId, params ?? null);
      forkCalls.push({ threadId, params: params ?? null });
      respond(id, {
        thread: { id: threadId, sessionId: threadId, status: { type: 'idle' }, forkedFromId: params?.threadId ?? null },
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

    case 'thread/revert': {
      if (REVERT_UNSUPPORTED) { respondError(id, -32601, 'method not found'); return; }
      revertCalls.push(params ?? null);
      respond(id, {
        thread: { id: params?.threadId, sessionId: params?.threadId, status: { type: 'idle' } },
        turnsBackwardsCursor: null,
        itemsBackwardsCursor: null,
      });
      return;
    }

    case 'thread/rollback': {
      rollbackCalls.push(params ?? null);
      respond(id, { thread: { id: params?.threadId, sessionId: params?.threadId, status: { type: 'idle' }, turns: [] } });
      return;
    }

    case '__test/branching': {
      respond(id, { forkCalls, revertCalls, rollbackCalls });
      return;
    }

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
      setImmediate(() => { void runTurn(threadId, turnId, text, params ?? null); });
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

    case 'thread/backgroundTerminals/list':
      // One terminal from this turn's command, one an earlier turn left running.
      respond(id, { data: [
        { itemId: 'call_long', processId: 'p-long', command: 'sleep 60', cwd: '/tmp', osPid: null, cpuPercent: null, rssKb: null },
        { itemId: 'call_devserver', processId: 'p-dev', command: 'npm run dev', cwd: '/tmp', osPid: null, cpuPercent: null, rssKb: null },
      ], nextCursor: null });
      return;

    case 'thread/backgroundTerminals/terminate':
      respond(id, { terminated: true });
      return;

    case 'account/login/start':
      if (params?.type === 'chatgpt') {
        respond(id, { type: 'chatgpt', authUrl: 'https://auth.openai.com/fake-login', loginId: 'login_1' });
        setTimeout(() => notify('account/login/completed', { loginId: 'login_1', success: true }), 20);
      } else respond(id, { type: params?.type ?? 'apiKey' });
      return;

    case 'account/logout':
      respond(id, {});
      return;

    case 'account/read':
      if (ACCOUNT === 'none') respond(id, { account: null, requiresOpenaiAuth: true });
      else if (ACCOUNT === 'apikey') respond(id, { account: { type: 'apiKey' }, requiresOpenaiAuth: true });
      else respond(id, { account: { type: 'chatgpt', email: 'dev@example.com', planType: 'pro' }, requiresOpenaiAuth: true });
      return;

    // Both of these are absent from older binaries, so they answer "method not
    // found" unless a test opts in — the provider must degrade, not fail.
    case 'account/rateLimits/read':
      if (!RATE_LIMITS_READ) { respondError(id, -32601, 'unknown method account/rateLimits/read'); return; }
      respond(id, {
        accountId: 'acct_1',
        ordinaryUsageAllowed: true,
        rateLimitResetCredits: null,
        rateLimitUpsell: null,
        rateLimits: {
          limitId: 'codex',
          limitName: 'Codex',
          primary: { usedPercent: 12.5, resetsAt: 1800000000, windowDurationMins: 300 },
          secondary: null,
          credits: null,
          individualLimit: null,
          normalModelSlug: null,
          planType: 'pro',
          rateLimitReachedType: null,
          spendControlReached: false,
        },
        rateLimitsByLimitId: null,
      });
      return;

    case 'mcpServerStatus/list': {
      if (!MCP_STATUS) { respondError(id, -32601, 'unknown method mcpServerStatus/list'); return; }
      const server = (name, runtimeStatus, toolsError) => ({
        name,
        authStatus: 'unknown',
        pluginId: null,
        resources: [],
        resourceTemplates: [],
        runtimeStatus,
        serverInfo: null,
        tools: {},
        toolsError: toolsError ?? null,
      });
      const data = MCP_STATUS === 'failed'
        ? [server('healthy', 'connected', null), server('broken', 'failed', null), server('nocatalog', 'connected', 'tool discovery timed out')]
        : [server('healthy', 'connected', null)];
      respond(id, { data, nextCursor: null });
      return;
    }

    case 'skills/extraRoots/set':
      skillRoots = params?.extraRoots ?? null;
      respond(id, {});
      return;

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
