// ────────────────────────────────────────────────────────────────
// OpenCodeProvider (OpenCode 2) — against a real server process.
//
// Every test runs the provider against `fixtures/fakeOpenCodeServe.mjs`, a
// stand-in for `opencode serve --stdio --port 0` that follows the 2.2.7
// contract (schemas/opencode/openapi.json): the `{"url"}` handshake and stdin
// lease, Basic auth, `/api/*` routes, admission-then-execution prompts, the
// V2 event envelope, permission asks, question forms, compaction, fork,
// revert and a client-hosted MCP WebSocket. The provider spawns it exactly as
// it would spawn OpenCode.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCodeProvider, OWNER_METADATA_KEY, INSTRUCTION_KEY } from '../OpenCodeProvider.js';
import { runCapabilityDeclarationConformance, runFullConformance } from '../../../conformance/index.js';
import type { AgentEvent } from '@generatorai/shared';
import type { CreateConversationParams, ToolDefinition } from '@generatorai/core';
import type { OpenCodeProviderOptions } from '../../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'fakeOpenCodeServe.mjs');

const live: OpenCodeProvider[] = [];
const procs: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.shutdown().catch(() => undefined)));
  for (const p of procs.splice(0)) { p.stdin?.end(); p.kill(); }
});

function make(overrides: Partial<OpenCodeProviderOptions> = {}): OpenCodeProvider {
  const p = new OpenCodeProvider({
    autoStart: true,
    binaryPath: process.execPath,
    binaryArgs: [FIXTURE],
    configFile: join(mkdtempSync(join(tmpdir(), 'oc-test-')), 'generatorai.json'),
    ...overrides,
  });
  live.push(p);
  return p;
}

async function started(overrides: Partial<OpenCodeProviderOptions> = {}): Promise<OpenCodeProvider> {
  const p = make(overrides);
  await p.initialize();
  return p;
}

/** The fixture's address, as the provider learned it. */
const urlOf = (p: OpenCodeProvider): string => (p as unknown as { baseUrl: string }).baseUrl;

async function testHook<T>(url: string, hook: string, body?: unknown): Promise<T> {
  const r = await fetch(`${url}/__test/${hook}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  return (r.status === 204 ? undefined : await r.json()) as T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recorded wire bodies are read field by field
interface Recorded { method: string; path: string; query: string; body: any }
const recorded = (p: OpenCodeProvider): Promise<Recorded[]> => testHook<Recorded[]>(urlOf(p), 'requests');

function collect(p: OpenCodeProvider, id: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  p.onConversationEvent(id, (e) => events.push(e));
  return events;
}

const CONV = (id: string, extra: Partial<CreateConversationParams> = {}): CreateConversationParams => ({ conversationId: id, ...extra });

const kinds = (events: AgentEvent[]) => events.map((e) => e.kind);
const infos = (events: AgentEvent[]) =>
  events.filter((e) => e.kind === 'harness.session_info').map((e) => (e.data as { infoType: string }).infoType);

/** Spawn the fixture ourselves (an "external" server) and read its URL. */
async function externalServer(): Promise<{ url: string; password: string; auth: string }> {
  const password = 'external-secret';
  const proc = spawn(process.execPath, [FIXTURE, 'serve', '--stdio', '--port', '0'], { env: { ...process.env, OPENCODE_PASSWORD: password }, stdio: ['pipe', 'pipe', 'pipe'] });
  procs.push(proc);
  const url = await new Promise<string>((resolve) => {
    proc.stdout!.setEncoding('utf8');
    proc.stdout!.on('data', (c: string) => { const m = /\{"url":"([^"]+)"\}/.exec(c); if (m) resolve(m[1]!); });
  });
  return { url, password, auth: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
}

describe('start-up: spawn, auth and the version gate', () => {
  it('starts `serve --stdio`, authenticates, and passes every W44 conformance suite', async () => {
    const p = await started();
    expect(p.getClientState()).toBe('running');
    expect(await p.ping()).toBe(true);
    await expect(runFullConformance(p, {
      toolCall: { prompt: 'TOOL_OK please', expectedToolResult: 'file body' },
      cancellationInBand: { prompt: 'SERVER_CANCEL now' },
      cancellationCallerAbort: { prompt: 'HANG forever', duringTurn: (h, id) => (h as OpenCodeProvider).abortConversation(id) },
      truncation: { prompt: 'TOOL_TRUNCATE now' },
    })).resolves.toBeUndefined();
  }, 60_000);

  it('declares what it implements (L9)', () => {
    const p = make();
    expect(() => runCapabilityDeclarationConformance(p)).not.toThrow();
    expect(p.capabilities()).toMatchObject({
      approvalGating: 'per_call', hostTools: 'full', structuredOutput: 'tool', skills: 'directories',
      conversationFork: true, conversationRewind: true, conversationCompact: true, compactInstructions: false,
      planMode: false, mcpServers: true, sessionPersistence: true,
    });
  });

  it('refuses an OpenCode older than 2.0.0 with an update message', async () => {
    const p = make({ env: { FAKE_OC_VERSION: '1.19.5' } });
    await expect(p.initialize()).rejects.toThrow(/OpenCode 1\.19\.5.*2\.0\.0 or later.*Update OpenCode/s);
    expect(p.getClientState()).toBe('error');
  });

  it('recognises an OpenCode 1 binary (no `serve --stdio`) and says to update', async () => {
    const p = make({ env: { FAKE_OC_V1: '1' } });
    await expect(p.initialize()).rejects.toThrow(/OpenCode 1.*Update OpenCode/s);
  });

  it("reports the server's own failure when it exits before it is ready", async () => {
    const p = make({ env: { FAKE_OC_EXIT_EARLY: '1' } });
    await expect(p.initialize()).rejects.toThrow(/exited with code 3[\s\S]*fatal: boom/);
  });

  it('says OpenCode is not installed when there is no binary', async () => {
    const p = make({ binaryPath: undefined });
    await expect(p.initialize()).rejects.toThrow(/not installed/);
  });

  it('an external server needs its password', async () => {
    const ext = await externalServer();
    const p = make({ autoStart: false, baseUrl: ext.url });
    await expect(p.initialize()).rejects.toThrow(/password/);
    const ok = make({ autoStart: false, baseUrl: ext.url, password: ext.password });
    await expect(ok.initialize()).resolves.toBeUndefined();
  });
});

describe('a session carries explicit rules, metadata, instructions and environment', () => {
  it('creates the session at the working directory with the mode rules, owner metadata and model variant', async () => {
    const p = await started();
    await p.getModels();
    await p.createConversation(CONV('c1', {
      workingDirectory: '/work/repo',
      additionalDirectories: ['/work/other'],
      model: 'anthropic/claude-sonnet-5-5',
      reasoningEffort: 'high',
      permissionMode: 'default',
      systemMessage: { mode: 'append', content: 'SYSTEM APPEND' },
      env: { GENERATORAI_SCRATCH_DIR: '/scratch' },
    }));
    const reqs = await recorded(p);
    const create = reqs.find((r) => r.method === 'POST' && r.path === '/api/session')!;
    expect(create.body.location).toEqual({ directory: '/work/repo' });
    expect(create.body.model).toEqual({ providerID: 'anthropic', id: 'claude-sonnet-5-5', variant: 'high' });
    expect(create.body.metadata).toEqual({ [OWNER_METADATA_KEY]: 'c1' });
    const rules = create.body.permissions as Array<{ action: string; resource: string; effect: string }>;
    expect(rules[0]).toEqual({ action: '*', resource: '*', effect: 'ask' });
    expect(rules).toContainEqual({ action: 'read', resource: '*', effect: 'allow' });
    expect(rules).toContainEqual({ action: 'external_directory', resource: '/work/other/*', effect: 'allow' });
    expect(rules.at(-1)).toEqual({ action: 'execute', resource: '*', effect: 'deny' });
    expect(rules).not.toContainEqual({ action: 'edit', resource: '*', effect: 'allow' });

    const sessions = await testHook<Array<{ id: string; env: Record<string, string>; instructions: Record<string, string> }>>(urlOf(p), 'sessions');
    const s = sessions.find((x) => x.id === p.getProviderSessionId('c1'))!;
    expect(s.instructions[INSTRUCTION_KEY]).toBe('SYSTEM APPEND');
    expect(s.env['GENERATORAI_SCRATCH_DIR']).toBe('/scratch');
    expect(s.env['PATH']).toBeDefined();
  });

  it("bypassPermissions allows everything but still keeps Code Mode off; acceptEdits allows edits", async () => {
    const p = await started();
    await p.createConversation(CONV('bypass', { permissionMode: 'bypassPermissions' }));
    await p.createConversation(CONV('edits', { permissionMode: 'acceptEdits' }));
    const creates = (await recorded(p)).filter((r) => r.method === 'POST' && r.path === '/api/session');
    expect(creates[0]!.body.permissions[0]).toEqual({ action: '*', resource: '*', effect: 'allow' });
    expect(creates[0]!.body.permissions.at(-1)).toEqual({ action: 'execute', resource: '*', effect: 'deny' });
    expect(creates[1]!.body.permissions).toContainEqual({ action: 'edit', resource: '*', effect: 'allow' });
  });

  it("a turn's mode is applied to the session before the prompt, and only when it changes", async () => {
    const p = await started();
    await p.createConversation(CONV('m', { permissionMode: 'bypassPermissions' }));
    await p.sendPromptAndWait('m', 'hi', undefined, undefined, { agentMode: 'plan' });
    await p.sendPromptAndWait('m', 'hi again', undefined, undefined, { agentMode: 'plan' });
    const reqs = await recorded(p);
    const patches = reqs.filter((r) => r.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body.permissions[0]).toEqual({ action: '*', resource: '*', effect: 'ask' });
    const firstPrompt = reqs.findIndex((r) => r.path.endsWith('/prompt'));
    expect(reqs.indexOf(patches[0]!)).toBeLessThan(firstPrompt);
  });

  it('warns honestly about what OpenCode cannot take', async () => {
    const p = await started();
    await p.createConversation(CONV('w', {
      systemMessage: { mode: 'replace', content: 'x' },
      customAgents: [{ name: 'a', description: 'd', instructions: 'i' }],
      maxTurns: 3,
      model: 'bare-model',
    }));
    const fields = p.getConversationWarnings('w').map((w) => w.params['field']);
    expect(fields).toEqual(expect.arrayContaining(['systemMessage.mode', 'customAgents', 'maxTurns', 'model']));
  });
});

describe('a turn', () => {
  it('streams deltas, closes each step with its message id, and reports usage and context', async () => {
    const p = await started();
    await p.getModels();
    await p.createConversation(CONV('t', { model: 'anthropic/claude-sonnet-5-5', autoCompact: { enabled: true, thresholdPct: 80 } }));
    const events = collect(p, 't');
    const res = await p.sendPromptAndWait('t', 'say hello');
    expect(res.content).toBe('hello world');
    const tokens = events.filter((e) => e.kind === 'harness.token').map((e) => (e.data as { text: string }).text);
    expect(tokens.join('')).toBe('hello world');
    const done = events.find((e) => e.kind === 'harness.message_complete')!.data as { content: string; providerMessageId: string };
    expect(done.content).toBe('hello world');
    expect(done.providerMessageId).toMatch(/^msg_/);
    const usage = events.find((e) => e.kind === 'harness.usage')!.data as unknown as Record<string, unknown>;
    expect(usage).toMatchObject({ inputTokens: 1200, outputTokens: 35, cacheReadTokens: 800, costUsd: 0.001 });
    const ctx = events.find((e) => e.kind === 'harness.context_usage')!.data as unknown as Record<string, unknown>;
    expect(ctx).toMatchObject({ currentTokens: 2030, promptTokenLimit: 1_000_000, compactionThreshold: 800_000, source: 'derived' });
    expect(kinds(events).at(-1)).toBe('harness.idle');
  });

  it('streams reasoning and completes it', async () => {
    const p = await started();
    await p.createConversation(CONV('r'));
    const events = collect(p, 'r');
    await p.sendPromptAndWait('r', 'REASON');
    expect(events.filter((e) => e.kind === 'harness.reasoning_delta').map((e) => (e.data as { text: string }).text).join('')).toBe('let me think');
    expect(events.find((e) => e.kind === 'harness.reasoning_complete')?.data).toEqual({ content: 'let me think' });
  });

  it('a failed run rejects and reports the error', async () => {
    const p = await started();
    await p.createConversation(CONV('f'));
    const events = collect(p, 'f');
    await expect(p.sendPromptAndWait('f', 'FAIL_TURN')).rejects.toThrow('model exploded');
    expect(kinds(events)).toContain('harness.error');
  });

  it('sends attachments as file:// URIs', async () => {
    const p = await started();
    await p.createConversation(CONV('a'));
    await p.sendPromptAndWait('a', 'look', [{ type: 'file', path: join(tmpdir(), 'pic.png'), displayName: 'pic.png' }]);
    const prompt = (await recorded(p)).find((r) => r.path.endsWith('/prompt'))!;
    expect(prompt.body.files[0].uri).toMatch(/^file:\/\/.*pic\.png$/);
    expect(prompt.body.files[0].name).toBe('pic.png');
  });

  it('abort interrupts the run and the conversation stays usable', async () => {
    const p = await started();
    await p.createConversation(CONV('x'));
    const events = collect(p, 'x');
    const turn = p.sendPromptAndWait('x', 'HANG forever');
    await new Promise((r) => setTimeout(r, 150));
    await p.abortConversation('x');
    await expect(turn).resolves.toMatchObject({ content: 'thinking ' });
    expect(kinds(events)).toContain('harness.cancelled');
    expect(kinds(events)).not.toContain('harness.error');
    await expect(p.sendPromptAndWait('x', 'again')).resolves.toMatchObject({ content: 'hello world' });
  });
});

describe('gates', () => {
  it('routes a permission ask to onPermissionRequest and replies once', async () => {
    const p = await started();
    const asked: unknown[] = [];
    await p.createConversation(CONV('p', { onPermissionRequest: async (r) => { asked.push(r); return { granted: true }; } }));
    const events = collect(p, 'p');
    await p.sendPromptAndWait('p', 'ASK_PERMISSION');
    expect(asked[0]).toMatchObject({ type: 'shell_exec', description: 'Run: rm -rf build', details: { action: 'shell', command: 'rm -rf build' } });
    const reply = (await recorded(p)).find((r) => r.path.includes('/permission/'))!;
    expect(reply.body).toEqual({ decision: 'once' });
    expect(events.find((e) => e.kind === 'harness.tool_complete')?.data).toMatchObject({ tool: 'shell', success: true });
  });

  it('a denial is a reject with the reason; "don\'t ask again" becomes a session rule, never OpenCode\'s project-wide always', async () => {
    const p = await started();
    let answer = { granted: false, reason: 'not now' } as { granted: boolean; reason?: string; remember?: boolean };
    await p.createConversation(CONV('d', { onPermissionRequest: async () => answer }));
    const events = collect(p, 'd');
    await p.sendPromptAndWait('d', 'ASK_PERMISSION');
    expect(events.find((e) => e.kind === 'harness.tool_complete')?.data).toMatchObject({ success: false });
    answer = { granted: true, remember: true };
    await p.sendPromptAndWait('d', 'ASK_PERMISSION');
    const reqs = await recorded(p);
    const replies = reqs.filter((r) => r.path.includes('/permission/')).map((r) => r.body);
    expect(replies).toEqual([{ decision: 'reject', message: 'not now' }, { decision: 'once' }]);
    const patch = reqs.filter((r) => r.method === 'PATCH').at(-1)!;
    expect(patch.body.permissions).toContainEqual({ action: 'shell', resource: 'rm *', effect: 'allow' });
  });

  it('with no handler, an ask is rejected rather than left waiting', async () => {
    const p = await started();
    await p.createConversation(CONV('n'));
    await p.sendPromptAndWait('n', 'ASK_PERMISSION');
    const reply = (await recorded(p)).find((r) => r.path.includes('/permission/'))!;
    expect(reply.body.decision).toBe('reject');
  });

  it('asks the question tool through onQuestionRequest and replies with the picked labels', async () => {
    const p = await started();
    const seen: unknown[] = [];
    await p.createConversation(CONV('q', {
      onQuestionRequest: async (req) => { seen.push(req); return { answers: { q0: ['bun'], q1: ['lint', 'test'] } }; },
    }));
    const res = await p.sendPromptAndWait('q', 'ASK_QUESTION');
    expect(seen[0]).toMatchObject({
      questions: [
        { id: 'q0', header: 'Pkg', question: 'Which package manager?', multiSelect: false, allowFreeform: true, options: [{ label: 'bun', description: 'fast' }, { label: 'npm' }] },
        { id: 'q1', multiSelect: true },
      ],
    });
    expect(res.content).toBe('answered:{"q0":"bun","q1":["lint","test"]}');
  });

  it('a free reply instead of an answer cancels the form with the reply as feedback', async () => {
    const p = await started();
    await p.createConversation(CONV('q2', { onQuestionRequest: async () => ({ answers: {}, freeformResponse: 'use pnpm' }) }));
    expect((await p.sendPromptAndWait('q2', 'ASK_QUESTION')).content).toBe('cancelled:use pnpm');
  });

  it('a form that is not a question is cancelled with a reason the model can act on', async () => {
    const p = await started();
    await p.createConversation(CONV('e', { onQuestionRequest: async () => ({ answers: {} }) }));
    expect((await p.sendPromptAndWait('e', 'ELICIT')).content).toMatch(/^cancelled:GeneratorAI cannot show this form/);
  });
});

describe('host tools over client-hosted MCP', () => {
  const echo = (calls: unknown[]): ToolDefinition => ({
    name: 'echo',
    description: 'echo',
    parametersSchema: { type: 'object', properties: { value: { type: 'number' } } },
    handler: async (args) => { calls.push(args); return { echoed: args['value'] }; },
  });

  it('lists the platform tools at the location and runs the calling conversation\'s handler', async () => {
    const p = await started();
    const calls: unknown[] = [];
    await p.createConversation(CONV('h', { workingDirectory: '/proj', tools: [echo(calls)] }));
    const mcp = await testHook<Record<string, string[]>>(urlOf(p), 'mcp');
    expect(mcp['/proj']).toEqual(['echo']);
    const events = collect(p, 'h');
    await p.sendPromptAndWait('h', 'HOST_TOOL echo');
    expect(calls).toEqual([{ value: 42 }]);
    const start = events.find((e) => e.kind === 'harness.tool_start')!.data as { tool: string };
    expect(start.tool).toBe('echo'); // `generatorai_echo` on the wire
    expect(events.find((e) => e.kind === 'harness.tool_complete')?.data).toMatchObject({ result: '{"echoed":42}', success: true });
  });

  it("a conversation without the tool gets an error, never another chat's handler", async () => {
    const p = await started();
    const calls: unknown[] = [];
    await p.createConversation(CONV('owner', { workingDirectory: '/proj', tools: [echo(calls)] }));
    await p.createConversation(CONV('other', { workingDirectory: '/proj' }));
    const events = collect(p, 'other');
    await p.sendPromptAndWait('other', 'HOST_TOOL echo');
    expect(calls).toEqual([]);
    expect(events.find((e) => e.kind === 'harness.tool_complete')?.data).toMatchObject({ success: false });
  });
});

describe('subagents', () => {
  it("forwards a child session's tool calls under the spawning call, without its prose", async () => {
    const p = await started();
    await p.createConversation(CONV('s'));
    const events = collect(p, 's');
    const res = await p.sendPromptAndWait('s', 'SUBAGENT');
    expect(res.content).not.toContain('child prose');
    const starts = events.filter((e) => e.kind === 'harness.tool_start').map((e) => e.data as { tool: string; callId: string; parentToolCallId?: string });
    const parent = starts.find((s) => s.tool === 'subagent')!;
    const child = starts.find((s) => s.tool === 'grep')!;
    expect(child.parentToolCallId).toBe(parent.callId);
  });
});

describe('compaction (docs/compaction)', () => {
  it('manual: start, one boundary with the summary, then idle', async () => {
    const p = await started();
    await p.createConversation(CONV('k'));
    await p.sendPromptAndWait('k', 'hi');
    const events = collect(p, 'k');
    await p.compactConversation('k');
    expect(infos(events)).toEqual(['compaction_start', 'compact_boundary']);
    const boundary = events.find((e) => e.kind === 'harness.session_info' && (e.data as { infoType: string }).infoType === 'compact_boundary')!.data;
    expect(boundary).toMatchObject({ trigger: 'manual', summary: 'SUMMARY', preTokens: 2030 });
    expect(kinds(events).at(-1)).toBe('harness.idle');
    // the conversation keeps working
    await expect(p.sendPromptAndWait('k', 'more')).resolves.toMatchObject({ content: 'hello world' });
  });

  it('a failed compaction rejects and is reported', async () => {
    const p = await started();
    await p.createConversation(CONV('kf'));
    await testHook(urlOf(p), 'knobs', { compact: 'fail' });
    const events = collect(p, 'kf');
    await expect(p.compactConversation('kf')).rejects.toThrow('summary failed');
    expect(infos(events)).toEqual(['compaction_start', 'compaction_failed']);
  });

  it('a compaction can be stopped', async () => {
    const p = await started();
    await p.createConversation(CONV('ks'));
    await testHook(urlOf(p), 'knobs', { compact: 'hang' });
    const events = collect(p, 'ks');
    const run = p.compactConversation('ks');
    await new Promise((r) => setTimeout(r, 100));
    await p.abortConversation('ks');
    await expect(run).rejects.toThrow('Compaction stopped');
    expect(kinds(events)).toContain('harness.cancelled');
  });

  it("reports OpenCode's own compaction inside a turn as auto", async () => {
    const p = await started();
    await p.createConversation(CONV('ka'));
    const events = collect(p, 'ka');
    await p.sendPromptAndWait('ka', 'AUTO_COMPACT');
    const auto = events.filter((e) => e.kind === 'harness.session_info').map((e) => e.data as unknown as { infoType: string; trigger: string; summary?: string });
    expect(auto.map((a) => [a.infoType, a.trigger])).toEqual([['compaction_start', 'auto'], ['compact_boundary', 'auto']]);
    expect(auto[1]!.summary).toBe('auto summary');
  });

  it("writes the app's setting into GeneratorAI's own config layer", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-cfg-'));
    const configFile = join(dir, 'generatorai.json');
    const p = await started({ configFile });
    await p.createConversation(CONV('cfg', { autoCompact: { enabled: true, thresholdPct: 70 }, skillDirectories: ['/skills/a'] }));
    const cfg = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(cfg).toMatchObject({ compaction: { auto: true, buffer: '30%' }, skills: ['/skills/a'] });
    await p.resumeConversation('cfg', CONV('cfg', { autoCompact: { enabled: false } }));
    expect(JSON.parse(readFileSync(configFile, 'utf8')).compaction).toEqual({ auto: false });
  });
});

describe('fork, rewind and resume', () => {
  it('forks through an anchor (copying before the next message) and maps the re-keyed ids', async () => {
    const p = await started();
    await p.createConversation(CONV('src'));
    const anchors: string[] = [];
    p.onConversationEvent('src', (e) => { if (e.kind === 'harness.message_complete') anchors.push((e.data as { providerMessageId: string }).providerMessageId); });
    await p.sendPromptAndWait('src', 'one');
    await p.sendPromptAndWait('src', 'two');
    const result = await p.forkConversation('src', { newConversationId: 'fork', throughAnchor: { kind: 'message', id: anchors[0]! }, params: CONV('fork') });
    const fork = (await recorded(p)).find((r) => r.path.endsWith('/fork'))!;
    const sessions = await testHook<Array<{ id: string; metadata: Record<string, string>; messages: Array<{ id: string }> }>>(urlOf(p), 'sessions');
    const src = sessions.find((s) => s.id === p.getProviderSessionId('src'))!;
    expect(fork.body.before).toBe(src.messages[2]!.id); // [user1, assistant1, user2, assistant2]
    const forked = sessions.find((s) => s.id === result.providerSessionId)!;
    expect(forked.messages).toHaveLength(2);
    expect(result.anchorMap?.[anchors[0]!]).toBe(forked.messages[1]!.id);
    expect(forked.metadata[OWNER_METADATA_KEY]).toBe('fork');
    expect(p.hasLiveConversation('fork')).toBe(true);
  });

  it('rewinds by staging and committing a revert at the first dropped message, files untouched', async () => {
    const p = await started();
    await p.createConversation(CONV('rw'));
    const anchors: string[] = [];
    p.onConversationEvent('rw', (e) => { if (e.kind === 'harness.message_complete') anchors.push((e.data as { providerMessageId: string }).providerMessageId); });
    await p.sendPromptAndWait('rw', 'one');
    await p.sendPromptAndWait('rw', 'two');
    await p.rewindConversation('rw', { keepThrough: { kind: 'message', id: anchors[0]! }, droppedTurns: 1, params: CONV('rw') });
    const stage = (await recorded(p)).find((r) => r.path.endsWith('/revert/stage'))!;
    expect(stage.body.files).toBe(false);
    const sessions = await testHook<Array<{ id: string; messages: unknown[] }>>(urlOf(p), 'sessions');
    expect(sessions.find((s) => s.id === p.getProviderSessionId('rw'))!.messages).toHaveLength(2);
    expect((await p.getMessages('rw')).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('resumes a persisted session (re-applying rules and environment) and refuses one OpenCode no longer has', async () => {
    const p = await started();
    await p.createConversation(CONV('orig'));
    const sid = p.getProviderSessionId('orig')!;
    const q = await started({ autoStart: false, baseUrl: urlOf(p), password: (p as unknown as { server: { password: string } }).server.password });
    await q.createConversation(CONV('orig', { resumeProviderSessionId: sid, permissionMode: 'acceptEdits' }));
    expect(q.getProviderSessionId('orig')).toBe(sid);
    const patch = (await recorded(p)).filter((r) => r.method === 'PATCH').at(-1)!;
    expect(patch.body.permissions).toContainEqual({ action: 'edit', resource: '*', effect: 'allow' });
    expect(await q.providerSessionExists(sid)).toBe(true);
    expect(await q.providerSessionExists('ses_gone')).toBe(false);
    await expect(q.createConversation(CONV('gone', { resumeProviderSessionId: 'ses_gone' }))).rejects.toThrow(/no longer has it/);
  });
});

describe('unattended recovery', () => {
  it('on connect, interrupts a session of ours the server still runs — and leaves other sessions alone', async () => {
    const ext = await externalServer();
    const create = async (metadata: Record<string, string>) =>
      ((await (await fetch(`${ext.url}/api/session`, { method: 'POST', headers: { Authorization: ext.auth }, body: JSON.stringify({ metadata }) })).json()) as { data: { id: string } }).data.id;
    const ours = await create({ [OWNER_METADATA_KEY]: 'old-chat' });
    const theirs = await create({});
    await testHook(ext.url, 'active', { sessionID: ours });
    await testHook(ext.url, 'active', { sessionID: theirs });
    const p = await started({ autoStart: false, baseUrl: ext.url, password: ext.password });
    const interrupts = (await recorded(p)).filter((r) => r.path.endsWith('/interrupt')).map((r) => r.path);
    expect(interrupts).toEqual([`/api/session/${ours}/interrupt`]);
  });

  it('shutdown interrupts every in-flight turn before it lets go', async () => {
    const ext = await externalServer();
    const p = await started({ autoStart: false, baseUrl: ext.url, password: ext.password });
    await p.createConversation(CONV('busy'));
    const sid = p.getProviderSessionId('busy')!;
    const turn = p.sendPromptAndWait('busy', 'HANG forever').catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 150));
    await p.shutdown();
    await turn;
    const reqs = (await testHook<Recorded[]>(ext.url, 'requests')).map((r) => r.path);
    expect(reqs).toContain(`/api/session/${sid}/interrupt`);
  });
});

describe('catalog and agents', () => {
  it('lists usable chat models with limits, vision and effort variants', async () => {
    const p = await started();
    const models = await p.getModels();
    expect(models.map((m) => m.id)).toEqual(['anthropic/claude-sonnet-5-5', 'openai/gpt-5.6-terra']);
    expect(models[0]).toMatchObject({ isDefault: true, supportsVision: true, supportsReasoning: true, reasoningEfforts: ['low', 'high', 'max'], promptTokenLimit: 1_000_000, maxOutputTokens: 64_000 });
    expect(models[1]).toMatchObject({ supportsVision: false, supportsReasoning: false, promptTokenLimit: 200_000, totalContextWindow: 258_000 });
  });

  it('lists primary, visible agents and switches the session agent', async () => {
    const p = await started();
    await p.createConversation(CONV('ag'));
    expect((await p.listAgents('ag')).map((a) => a.name)).toEqual(['build', 'plan']);
    await p.selectAgent('ag', 'plan');
    const sw = (await recorded(p)).find((r) => r.method === 'POST' && r.path.endsWith('/agent'))!;
    expect(sw.body).toEqual({ agent: 'plan' });
    await p.selectAgent('ag', 'general');
    expect(p.getConversationWarnings('ag').map((w) => w.code)).toContain('AGENT_NOT_REGISTERED');
  });
});
