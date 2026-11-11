#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// fakeAcpAgent — a minimal REAL ACP agent (JSON-RPC over stdio) used only
// by the AcpAgentConnection / AcpProvider tests. Modeled directly on the SDK's own
// `dist/examples/agent.js`, trimmed to what the tests need to exercise:
//
//   - Normal turn: emits an `agent_message_chunk`, then ends with `end_turn`.
//   - A prompt containing "TOOL:<kind>" additionally emits a `tool_call` of
//     that kind, then requests permission for it before completing —
//     letting tests drive both the L16 Tier-B block path and the
//     domain-callback / default-approve paths. The tool's TITLE is model-
//     controlled free text (that is the point: the gate must not trust it),
//     so a prompt may also carry "TITLE:<word>" to set it.
//   - FAKE_ACP_NO_INIT=1 / FAKE_ACP_NO_SESSION_NEW=1 accept that request and
//     never answer it, so the client's own deadlines are what must fire.
//   - A prompt containing "ECHO_SESSION" replies with a JSON dump of the
//     `session/new` request this session was created from, so a test can
//     assert what actually crossed the wire (cwd, additionalDirectories)
//     rather than trusting a mock.
//   - A prompt containing "CANCEL_ME" never resolves on its own; it waits
//     for a `session/cancel` notification and then returns
//     `{ stopReason: 'cancelled' }` — exercising AcpProvider's real
//     `abortConversation()` path end-to-end over the wire.
//   - Compaction (docs/compaction): FAKE_ACP_COMMANDS=compact advertises a `compact` command right after
//     `session/new`, and reports `usage_update` then. A `/compact …` prompt echoes its text and, with
//     FAKE_ACP_COMPACTION_UPDATES=1, reports `compaction_update` in_progress → a summary chunk → completed
//     (FAKE_ACP_COMPACTION_FAIL=1: failed). "AUTO_COMPACT" in a prompt reports the agent's own compaction.
//     "ECHO_CLIENT_CAPS" replies with the client capabilities of `initialize`.
//   - Capabilities: `session/close`, `systemPrompt`, `additionalDirectories` (unless
//     FAKE_ACP_NO_ADDITIONAL_DIRS=1), prompt images + embedded context, http MCP servers.
//   - Config options (docs/acp ACP-2): FAKE_ACP_MODELS=1 publishes a grouped `model` select
//     (fast | smart), a `thought_level` select (low/medium/high; `max` too on `smart`) and a
//     `mode` select (ask/code/plan). `session/set_config_option` changes them per session and
//     answers the full list. FAKE_ACP_SESSION_OPTIONS=1 advertises `session/options` (and initial
//     `configOptions` on setup requests). "ECHO_CONFIG" replies with the session's current values;
//     "ECHO_PROMPT" with the prompt's content blocks.
//   - Sign-in (ACP-8): FAKE_ACP_AUTH=agent|terminal advertises one auth method; until signed in,
//     `session/new` / `session/options` / `session/resume` answer -32000. `authenticate` signs an
//     agent method in; a terminal method is the agent run with `--login`, which writes
//     FAKE_ACP_AUTH_FILE and exits 0 (a new process reads it). FAKE_ACP_AUTH_STATUS=1 advertises
//     `auth/status`; FAKE_ACP_LOGOUT=1 advertises `logout`.
//   - Persistence: FAKE_ACP_RESUME=1 advertises `session/resume` and `session/fork`; sessions are
//     remembered in FAKE_ACP_SESSIONS_FILE so a NEW process can resume them.
//
// This is a REAL child process speaking REAL ACP — the test suite proves
// AcpProvider works against actual JSON-RPC-over-stdio, not a mocked
// transport.
// ────────────────────────────────────────────────────────────────

import * as acp from '@agentclientprotocol/sdk/unstable';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';

const env = process.env;
const AUTH_FILE = env['FAKE_ACP_AUTH_FILE'];
const SESSIONS_FILE = env['FAKE_ACP_SESSIONS_FILE'];

// Terminal sign-in: the agent's own command plus the method's args, run by the host in a terminal.
if (process.argv.includes('--login')) {
  if (AUTH_FILE) writeFileSync(AUTH_FILE, 'signed-in');
  process.exit(0);
}

let authenticated = !env['FAKE_ACP_AUTH'] || (AUTH_FILE ? existsSync(AUTH_FILE) : false);
const requireAuth = () => {
  if (!authenticated) throw acp.RequestError.authRequired();
};

/** sessionId -> { model, effort, mode } (FAKE_ACP_MODELS). */
const sessionConfig = new Map();
const knownSessions = new Set(SESSIONS_FILE && existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) : []);
function rememberSession(id) {
  knownSessions.add(id);
  if (SESSIONS_FILE) writeFileSync(SESSIONS_FILE, JSON.stringify([...knownSessions]));
}

function configOptionsFor(cfg) {
  if (env['FAKE_ACP_MODELS'] !== '1') return undefined;
  const levels = ['low', 'medium', 'high', ...(cfg.model === 'smart' ? ['max'] : [])];
  return [
    {
      type: 'select', id: 'model', name: 'Model', category: 'model', currentValue: cfg.model,
      options: [
        { group: 'speed', name: 'Fast models', options: [{ value: 'fast', name: 'Fast', description: 'Quick answers' }] },
        { group: 'brains', name: 'Smart models', options: [{ value: 'smart', name: 'Smart' }] },
      ],
    },
    {
      type: 'select', id: 'effort', name: 'Thinking', category: 'thought_level', currentValue: cfg.effort,
      options: levels.map((l) => ({ value: l, name: l })),
    },
    {
      type: 'select', id: 'mode', name: 'Mode', category: 'mode', currentValue: cfg.mode,
      options: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }, { value: 'plan', name: 'Plan' }],
    },
  ];
}

const DEFAULT_CONFIG = () => ({ model: 'fast', effort: 'medium', mode: 'code' });

/** Apply initial `configOptions` from a setup request. */
function withInitial(cfg, initial) {
  for (const o of initial ?? []) {
    if (o.configId === 'model' && ['fast', 'smart'].includes(o.value)) cfg.model = o.value;
    if (o.configId === 'effort') cfg.effort = o.value;
    if (o.configId === 'mode') cfg.mode = o.value;
  }
  return cfg;
}

/** sessionId -> AbortController for the in-flight prompt, if any. */
const pending = new Map();
/** sessionId -> the `session/new` request that created it. */
const sessionRequests = new Map();
/** The client capabilities `initialize` declared. */
let clientCapabilities = null;

async function reportCompaction(cx, sessionId, compactionId, { fail = false } = {}) {
  const update = (u) => cx.notify(acp.methods.client.session.update, { sessionId, update: u });
  await update({ sessionUpdate: 'compaction_update', compactionId, status: 'in_progress' });
  if (fail) {
    await update({ sessionUpdate: 'compaction_update', compactionId, status: 'failed', error: 'summary model unavailable' });
    return;
  }
  await update({ sessionUpdate: 'compaction_summary_chunk', compactionId, content: { type: 'text', text: 'the summary' } });
  await update({ sessionUpdate: 'compaction_update', compactionId, status: 'completed' });
  await update({ sessionUpdate: 'usage_update', used: 1200, size: 200000 });
}

async function handlePrompt(params, cx) {
  const sessionId = params.sessionId;
  const text = params.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const ac = new AbortController();
  pending.set(sessionId, ac);

  if (text.startsWith('/compact')) {
    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `ran ${text}` } },
    });
    if (process.env['FAKE_ACP_COMPACTION_UPDATES'] === '1') {
      await reportCompaction(cx, sessionId, 'cmp_1', { fail: process.env['FAKE_ACP_COMPACTION_FAIL'] === '1' });
    }
    pending.delete(sessionId);
    return { stopReason: 'end_turn' };
  }

  if (text.includes('AUTO_COMPACT')) await reportCompaction(cx, sessionId, 'cmp_auto');

  if (text.includes('ECHO_CONFIG') || text.includes('ECHO_PROMPT')) {
    const body = text.includes('ECHO_CONFIG') ? sessionConfig.get(sessionId) ?? null : params.prompt;
    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(body) } },
    });
    pending.delete(sessionId);
    return { stopReason: 'end_turn' };
  }

  if (text.includes('ECHO_CLIENT_CAPS')) {
    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(clientCapabilities) } },
    });
    pending.delete(sessionId);
    return { stopReason: 'end_turn' };
  }

  // Answered BEFORE the greeting so the turn's whole content is the JSON — a
  // test can then parse it without stripping anything.
  if (text.includes('ECHO_SESSION')) {
    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: JSON.stringify(sessionRequests.get(sessionId) ?? null) },
      },
    });
    pending.delete(sessionId);
    return { stopReason: 'end_turn' };
  }

  await cx.notify(acp.methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello from fake agent.' } },
  });

  const toolMatch = /TOOL:(\w+)/.exec(text);
  if (toolMatch) {
    const kind = toolMatch[1];
    const titleMatch = /TITLE:(\S+)/.exec(text);
    const title = titleMatch ? titleMatch[1] : `Fake ${kind} tool call`;
    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_1',
        title,
        kind,
        status: 'pending',
        rawInput: { note: 'fixture tool call' },
      },
    });

    const permissionResponse = await cx.request(acp.methods.client.session.requestPermission, {
      sessionId,
      toolCall: { toolCallId: 'call_1', title, kind, status: 'pending' },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });

    const outcome = permissionResponse.outcome;
    const approved = outcome.outcome === 'selected' && outcome.optionId === 'allow';
    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_1',
        status: approved ? 'completed' : 'failed',
        rawOutput: approved ? { ok: true } : { denied: true },
      },
    });
  }

  if (text.includes('TRUNCATE')) {
    // Announce a tool call, resolve nothing, and stop on `max_tokens` — ACP's
    // own truncation stop reason. The client's W13-B1 guard must fail the
    // open call rather than reporting a clean idle.
    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_open',
        title: 'Fake write tool call',
        kind: 'edit',
        status: 'pending',
      },
    });
    pending.delete(sessionId);
    return { stopReason: 'max_tokens' };
  }

  if (text.includes('SERVER_CANCEL')) {
    // In-band cancellation: the agent ends the turn as cancelled on its own,
    // with no `session/cancel` from the client.
    pending.delete(sessionId);
    return { stopReason: 'cancelled' };
  }

  if (text.includes('CANCEL_ME')) {
    // Wait indefinitely for cancel() to abort this controller.
    await new Promise((resolve, reject) => {
      ac.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }).catch(() => { /* expected: cancel() rejects the wait */ });
    pending.delete(sessionId);
    return { stopReason: 'cancelled' };
  }

  pending.delete(sessionId);
  return { stopReason: 'end_turn' };
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);

/** Never settles — used to prove the client's own deadlines actually fire. */
const never = () => new Promise(() => { /* deliberately never resolves */ });

acp
  .agent({ name: 'fake-acp-agent' })
  .onRequest(acp.methods.agent.initialize, async (ctx) => {
    clientCapabilities = ctx.params?.clientCapabilities ?? null;
    // FAKE_ACP_NO_INIT: accept the handshake and never answer it. Without a
    // client-side deadline this hangs harness bring-up forever.
    if (env['FAKE_ACP_NO_INIT'] === '1') await never();
    const authMethods = env['FAKE_ACP_AUTH'] === 'agent'
      ? [{ id: 'browser', name: 'Sign in with a browser' }]
      : env['FAKE_ACP_AUTH'] === 'terminal'
        ? [{ id: 'cli', name: 'Sign in from a terminal', type: 'terminal', args: ['--login'], env: { FAKE_LOGIN_MODE: '1' } }]
        : [];
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: true, embeddedContext: true },
        mcpCapabilities: { http: true },
        ...(env['FAKE_ACP_AUTH_STATUS'] === '1' || env['FAKE_ACP_LOGOUT'] === '1'
          ? { auth: { ...(env['FAKE_ACP_AUTH_STATUS'] === '1' ? { status: {} } : {}), ...(env['FAKE_ACP_LOGOUT'] === '1' ? { logout: {} } : {}) } }
          : {}),
        sessionCapabilities: {
          close: {},
          systemPrompt: {},
          ...(env['FAKE_ACP_NO_ADDITIONAL_DIRS'] === '1' ? {} : { additionalDirectories: {} }),
          ...(env['FAKE_ACP_SESSION_OPTIONS'] === '1' ? { options: {} } : {}),
          ...(env['FAKE_ACP_RESUME'] === '1' ? { resume: {}, fork: {} } : {}),
        },
      },
      authMethods,
      agentInfo: { name: 'fake-acp-agent', title: 'Fake Agent', version: '0.0.1' },
    };
  })
  .onRequest(acp.methods.agent.authenticate, async (ctx) => {
    if (ctx.params.methodId !== 'browser') throw acp.RequestError.invalidParams(undefined, 'unknown method');
    authenticated = true;
    return {};
  })
  .onRequest(acp.methods.agent.logout, async () => {
    authenticated = false;
    if (AUTH_FILE && existsSync(AUTH_FILE)) writeFileSync(AUTH_FILE, '');
    return {};
  })
  .onRequest(acp.methods.agent.auth.status, async () => ({ state: authenticated ? 'authenticated' : 'unauthenticated' }))
  .onRequest(acp.methods.agent.session.options, async (ctx) => {
    requireAuth();
    return { configOptions: configOptionsFor(withInitial(DEFAULT_CONFIG(), [])) ?? [] };
  })
  .onRequest(acp.methods.agent.session.new, async (ctx) => {
    if (env['FAKE_ACP_NO_SESSION_NEW'] === '1') await never();
    requireAuth();
    const sessionId = crypto.randomUUID();
    sessionRequests.set(sessionId, ctx.params ?? null);
    rememberSession(sessionId);
    const cfg = withInitial(DEFAULT_CONFIG(), ctx.params?.configOptions);
    sessionConfig.set(sessionId, cfg);
    if (env['FAKE_ACP_COMMANDS'] === 'compact') {
      // Like a real agent: the commands follow the session/new answer, before any prompt.
      setTimeout(() => {
        void ctx.client.notify(acp.methods.client.session.update, {
          sessionId,
          update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact the conversation' }] },
        });
        void ctx.client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: 'usage_update', used: 90000, size: 200000 } });
      }, 20);
    }
    const configOptions = configOptionsFor(cfg);
    return { sessionId, ...(configOptions ? { configOptions } : {}) };
  })
  .onRequest(acp.methods.agent.session.resume, async (ctx) => {
    requireAuth();
    if (!knownSessions.has(ctx.params.sessionId)) throw acp.RequestError.sessionNotFound(ctx.params.sessionId);
    sessionRequests.set(ctx.params.sessionId, { ...ctx.params, resumed: true });
    const cfg = sessionConfig.get(ctx.params.sessionId) ?? withInitial(DEFAULT_CONFIG(), ctx.params.configOptions);
    sessionConfig.set(ctx.params.sessionId, cfg);
    const configOptions = configOptionsFor(cfg);
    return configOptions ? { configOptions } : {};
  })
  .onRequest(acp.methods.agent.session.fork, async (ctx) => {
    requireAuth();
    if (!knownSessions.has(ctx.params.sessionId)) throw acp.RequestError.sessionNotFound(ctx.params.sessionId);
    const sessionId = crypto.randomUUID();
    rememberSession(sessionId);
    sessionRequests.set(sessionId, { ...ctx.params, forkedFrom: ctx.params.sessionId });
    const cfg = { ...(sessionConfig.get(ctx.params.sessionId) ?? DEFAULT_CONFIG()) };
    sessionConfig.set(sessionId, cfg);
    const configOptions = configOptionsFor(cfg);
    return { sessionId, ...(configOptions ? { configOptions } : {}) };
  })
  .onRequest(acp.methods.agent.session.close, async () => ({}))
  .onRequest(acp.methods.agent.session.setConfigOption, async (ctx) => {
    const cfg = sessionConfig.get(ctx.params.sessionId);
    if (!cfg) throw acp.RequestError.sessionNotFound(ctx.params.sessionId);
    const key = ctx.params.configId === 'effort' ? 'effort' : ctx.params.configId;
    if (!['model', 'effort', 'mode'].includes(key)) throw acp.RequestError.invalidParams(undefined, 'unknown option');
    cfg[key] = ctx.params.value;
    return { configOptions: configOptionsFor(cfg) ?? [] };
  })
  .onRequest(acp.methods.agent.session.prompt, (ctx) => handlePrompt(ctx.params, ctx.client))
  .onNotification(acp.methods.agent.session.cancel, (ctx) => {
    pending.get(ctx.params.sessionId)?.abort();
  })
  .connect(stream);
