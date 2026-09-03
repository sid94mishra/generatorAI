#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// fakeAcpAgent — a minimal REAL ACP agent (JSON-RPC over stdio) used only
// by AcpProvider.test.ts. Modeled directly on the SDK's own
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
//   - A prompt containing "CANCEL_ME" never resolves on its own; it waits
//     for a `session/cancel` notification and then returns
//     `{ stopReason: 'cancelled' }` — exercising AcpProvider's real
//     `abortConversation()` path end-to-end over the wire.
//
// This is a REAL child process speaking REAL ACP — the test suite proves
// AcpProvider works against actual JSON-RPC-over-stdio, not a mocked
// transport.
// ────────────────────────────────────────────────────────────────

import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

/** sessionId -> AbortController for the in-flight prompt, if any. */
const pending = new Map();

async function handlePrompt(params, cx) {
  const sessionId = params.sessionId;
  const text = params.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const ac = new AbortController();
  pending.set(sessionId, ac);

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
  .onRequest(acp.methods.agent.initialize, async () => {
    // FAKE_ACP_NO_INIT: accept the handshake and never answer it. Without a
    // client-side deadline this hangs harness bring-up forever.
    if (process.env['FAKE_ACP_NO_INIT'] === '1') await never();
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: 'fake-acp-agent', version: '0.0.1' },
    };
  })
  .onRequest(acp.methods.agent.session.new, async () => {
    if (process.env['FAKE_ACP_NO_SESSION_NEW'] === '1') await never();
    return { sessionId: crypto.randomUUID() };
  })
  .onRequest(acp.methods.agent.session.prompt, (ctx) => handlePrompt(ctx.params, ctx.client))
  .onNotification(acp.methods.agent.session.cancel, (ctx) => {
    pending.get(ctx.params.sessionId)?.abort();
  })
  .connect(stream);
