// docs/acp ACP-1…ACP-3, ACP-8 — the `acp` provider multiplexing real ACP agent processes
// (fixtures/fakeAcpAgent.mjs over stdio): model discovery from config options, routing by
// `<agentId>/<value>`, applying model/effort/mode, sign-in gating (-32000), agent and terminal
// sign-in, resume across processes, the live agent set, attachments and MCP servers.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateConversationParams } from '@generatorai/core';
import type { AcpAgentLaunch } from '../../../types.js';
import { AcpProvider } from '../AcpProvider.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fakeAcpAgent.mjs');

function agent(id: string, env: Record<string, string> = {}): AcpAgentLaunch {
  return { id, label: id[0]!.toUpperCase() + id.slice(1), command: process.execPath, args: [FIXTURE], env, tierB: false };
}

const live: AcpProvider[] = [];
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'gai-acp-mux-'));
});
afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.shutdown().catch(() => undefined)));
  await rm(dir, { recursive: true, force: true });
});

async function started(agents: AcpAgentLaunch[], onChange?: () => void): Promise<AcpProvider> {
  const p = new AcpProvider({ agents, requestTimeoutMs: 10_000, ...(onChange ? { onChange } : {}) });
  live.push(p);
  await p.initialize();
  return p;
}

const conv = (id: string, extra: Partial<CreateConversationParams> = {}) => ({ conversationId: id, ...extra }) as CreateConversationParams;
const echo = async (p: AcpProvider, id: string, what: string) => JSON.parse((await p.sendPromptAndWait(id, what)).content) as Record<string, unknown>;

describe('AcpProvider — catalog (ACP-2/3/9)', () => {
  it('with no agent enabled lists nothing and says why', async () => {
    const p = await started([]);
    expect(await p.getModels()).toEqual([]);
    expect(p.getLastModelProbeError()).toMatch(/No ACP agents enabled/);
    expect(p.getSubProviders()).toEqual([]);
  });

  it('lists every enabled agent’s models as <agentId>/<value> with subProvider; an agent without a model option offers its default', async () => {
    const p = await started([agent('alpha', { FAKE_ACP_MODELS: '1' }), agent('beta')]);
    const models = await p.getModels();
    expect(models.map((m) => [m.id, m.subProvider, m.provider])).toEqual([
      ['alpha/fast', 'alpha', 'acp'],
      ['alpha/smart', 'alpha', 'acp'],
      ['beta', 'beta', 'acp'],
    ]);
    expect(models[0]).toMatchObject({ name: 'Fast', category: 'Fast models', isDefault: true, reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' });
    expect(models[1]).toMatchObject({ category: 'Smart models' });
    expect(models[1]!.reasoningEfforts).toBeUndefined();
    expect(models[2]).toMatchObject({ name: "Beta (agent's default model)" });
    expect(p.getSubProviders()).toEqual([
      expect.objectContaining({ id: 'alpha', label: 'Alpha', ready: true, connected: true, authState: 'not_required', authenticated: true, modelCount: 2 }),
      expect.objectContaining({ id: 'beta', ready: true, modelCount: 1 }),
    ]);
  }, 20_000);

  it('uses session/options when advertised (no throwaway session)', async () => {
    const p = await started([agent('alpha', { FAKE_ACP_MODELS: '1', FAKE_ACP_SESSION_OPTIONS: '1' })]);
    expect((await p.getModels()).map((m) => m.id)).toEqual(['alpha/fast', 'alpha/smart']);
  }, 20_000);

  it('the agent set is live: an added agent starts, a removed one stops and leaves the catalog', async () => {
    const changes: number[] = [];
    const p = await started([agent('alpha')], () => changes.push(1));
    expect((await p.getModels()).map((m) => m.id)).toEqual(['alpha']);
    await p.setAgents([agent('alpha'), agent('beta', { FAKE_ACP_MODELS: '1' })]);
    expect((await p.getModels()).map((m) => m.id)).toEqual(['alpha', 'beta/fast', 'beta/smart']);
    await p.setAgents([agent('beta', { FAKE_ACP_MODELS: '1' })]);
    expect((await p.getModels()).map((m) => m.subProvider)).toEqual(['beta', 'beta']);
    expect(p.peekAgent('alpha')).toBeNull();
    expect(changes.length).toBeGreaterThan(0);
  }, 30_000);

  it('a launch that cannot start is that agent’s error, not the provider’s', async () => {
    const p = await started([agent('alpha'), { id: 'ghost', label: 'Ghost', command: path.join(dir, 'no-such-agent'), args: [] }]);
    expect((await p.getModels()).map((m) => m.id)).toEqual(['alpha']);
    const ghost = p.getSubProviders().find((s) => s.id === 'ghost')!;
    expect(ghost).toMatchObject({ ready: false, connected: false, installed: false });
    expect(ghost.error).toMatch(/not found/);
  }, 20_000);
});

describe('AcpProvider — routing and config (ACP-1/2)', () => {
  it('routes by model prefix, applies model + effort on creation, and changes them mid-chat', async () => {
    const p = await started([agent('alpha', { FAKE_ACP_MODELS: '1' }), agent('beta')]);
    await p.getModels();
    await p.createConversation(conv('c1', { model: 'alpha/smart', reasoningEffort: 'high' }));
    expect(await echo(p, 'c1', 'ECHO_CONFIG')).toEqual({ model: 'smart', effort: 'high', mode: 'code' });
    // The smart model offers `max`: the conversation's capabilities follow its options.
    expect(p.capabilitiesFor('c1').reasoningEfforts).toEqual(['low', 'medium', 'high', 'max']);

    await p.resumeConversation('c1', conv('c1', { model: 'alpha/fast', reasoningEffort: 'low' }));
    expect(await echo(p, 'c1', 'ECHO_CONFIG')).toEqual({ model: 'fast', effort: 'low', mode: 'code' });
    expect(p.getConversationWarnings('c1').some((w) => w.code === 'CONVERSATION_RESTARTED')).toBe(false);

    await p.createConversation(conv('c2', { model: 'beta' }));
    expect(p.getProviderSessionId('c2')).toMatch(/^beta\//);
    expect((await p.sendPromptAndWait('c2', 'hi')).content).toBe('Hello from fake agent.');
  }, 30_000);

  it('passes the chosen model as initial configOptions when the agent accepts them', async () => {
    const p = await started([agent('alpha', { FAKE_ACP_MODELS: '1', FAKE_ACP_SESSION_OPTIONS: '1' })]);
    await p.getModels();
    await p.createConversation(conv('c1', { model: 'alpha/smart' }));
    expect((await echo(p, 'c1', 'ECHO_SESSION'))['configOptions']).toEqual([{ configId: 'model', value: 'smart' }]);
    expect(await echo(p, 'c1', 'ECHO_CONFIG')).toMatchObject({ model: 'smart' });
  }, 20_000);

  it('moving a chat to another agent starts a session there and reports the restart', async () => {
    const p = await started([agent('alpha', { FAKE_ACP_MODELS: '1' }), agent('beta')]);
    await p.createConversation(conv('c1', { model: 'alpha/fast' }));
    await p.resumeConversation('c1', conv('c1', { model: 'beta' }));
    expect(p.getProviderSessionId('c1')).toMatch(/^beta\//);
    expect(p.getConversationWarnings('c1')).toContainEqual(expect.objectContaining({ code: 'CONVERSATION_RESTARTED' }));
    expect((await p.sendPromptAndWait('c1', 'hi')).content).toBe('Hello from fake agent.');
  }, 20_000);

  it("plan turns switch to the agent's plan mode and the next turn restores the mode", async () => {
    const p = await started([agent('alpha', { FAKE_ACP_MODELS: '1' })]);
    await p.createConversation(conv('c1', { model: 'alpha/fast' }));
    const planning = JSON.parse((await p.sendPromptAndWait('c1', 'ECHO_CONFIG', undefined, undefined, { agentMode: 'plan' })).content);
    expect(planning.mode).toBe('plan');
    expect((await echo(p, 'c1', 'ECHO_CONFIG'))['mode']).toBe('code');
  }, 20_000);

  it('sends images and text files as content blocks, and stdio + http MCP servers on session/new', async () => {
    const p = await started([agent('alpha')]);
    const png = path.join(dir, 'shot.png');
    const notes = path.join(dir, 'notes.md');
    await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(notes, '# hi');
    await p.createConversation(conv('c1', {
      mcpServers: {
        files: { type: 'stdio', command: 'mcp-files', args: ['--root', '/x'], env: { A: '1' } },
        web: { type: 'http', url: 'https://mcp.example/x', headers: { Authorization: 'Bearer t' } },
        old: { type: 'sse', url: 'https://mcp.example/sse' },
      },
      systemMessage: { mode: 'append', content: 'Be brief.' },
    }));
    const session = await echo(p, 'c1', 'ECHO_SESSION');
    expect(session['mcpServers']).toEqual([
      { name: 'files', command: 'mcp-files', args: ['--root', '/x'], env: [{ name: 'A', value: '1' }] },
      { type: 'http', name: 'web', url: 'https://mcp.example/x', headers: [{ name: 'Authorization', value: 'Bearer t' }] },
    ]);
    expect(session['systemPrompt']).toEqual({ mode: 'append', content: [{ type: 'text', text: 'Be brief.' }] });
    expect(p.getConversationWarnings('c1')).toContainEqual(expect.objectContaining({ params: expect.objectContaining({ field: 'mcpServers.old' }) }));

    const blocks = JSON.parse((await p.sendPromptAndWait('c1', 'ECHO_PROMPT', [
      { type: 'file', path: png, mimeType: 'image/png' },
      { type: 'file', path: notes },
    ])).content) as Array<Record<string, unknown>>;
    expect(blocks[0]).toEqual({ type: 'text', text: 'ECHO_PROMPT' });
    expect(blocks[1]).toMatchObject({ type: 'image', mimeType: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') });
    expect(blocks[2]).toMatchObject({ type: 'resource', resource: { text: '# hi' } });
  }, 20_000);

  it('omits additionalDirectories (with a warning) for an agent that does not advertise them', async () => {
    const p = await started([agent('alpha', { FAKE_ACP_NO_ADDITIONAL_DIRS: '1' })]);
    await p.createConversation(conv('c1', { workingDirectory: dir, additionalDirectories: ['/work/docs'] }));
    expect((await echo(p, 'c1', 'ECHO_SESSION'))['additionalDirectories']).toBeUndefined();
    expect(p.getConversationWarnings('c1')).toContainEqual(expect.objectContaining({ params: expect.objectContaining({ field: 'additionalDirectories' }) }));
  }, 20_000);
});

describe('AcpProvider — sign-in (ACP-8)', () => {
  it('a -32000 agent is signed out with no models (never an empty-but-ready catalog); authenticate signs it in', async () => {
    const p = await started([agent('alpha', { FAKE_ACP_AUTH: 'agent', FAKE_ACP_MODELS: '1' }), agent('beta')]);
    expect((await p.getModels()).map((m) => m.id)).toEqual(['beta']);
    const alpha = () => p.getSubProviders().find((s) => s.id === 'alpha')!;
    expect(alpha()).toMatchObject({ authState: 'unauthenticated', authenticated: false, ready: false, modelCount: 0 });
    expect(alpha().error).toMatch(/Sign in/);
    expect(p.agentStatus('alpha')!.authMethods).toEqual([{ id: 'browser', name: 'Sign in with a browser' }]);

    await p.ensureAgent('alpha').then((c) => c.authenticate('browser'));
    expect((await p.getModels()).map((m) => m.id)).toEqual(['alpha/fast', 'alpha/smart', 'beta']);
    expect(alpha()).toMatchObject({ authState: 'authenticated', ready: true });
  }, 20_000);

  it('reads auth/status when advertised, and signs out with logout', async () => {
    const p = await started([agent('alpha', { FAKE_ACP_AUTH: 'agent', FAKE_ACP_AUTH_STATUS: '1', FAKE_ACP_LOGOUT: '1' })]);
    expect(p.agentStatus('alpha')).toMatchObject({ authState: 'unauthenticated', supportsLogout: true });
    const c = await p.ensureAgent('alpha');
    await c.authenticate('browser');
    expect(p.agentStatus('alpha')!.authState).toBe('authenticated');
    await c.logout();
    expect(p.agentStatus('alpha')!.authState).toBe('unauthenticated');
    expect(await p.getModels()).toEqual([]);
  }, 20_000);

  it('a terminal method is the agent’s own command + its args; after it exits 0 a restart is signed in', async () => {
    const authFile = path.join(dir, 'signed-in');
    const env = { FAKE_ACP_AUTH: 'terminal', FAKE_ACP_AUTH_FILE: authFile };
    const p = await started([agent('alpha', env)]);
    expect(await p.getModels()).toEqual([]);
    const [method] = p.agentStatus('alpha')!.authMethods;
    expect(method).toMatchObject({ id: 'cli', type: 'terminal', args: ['--login'], env: { FAKE_LOGIN_MODE: '1' } });
    await expect(p.ensureAgent('alpha').then((c) => c.authenticate('cli'))).rejects.toThrow(/terminal/);

    // What the host runs in a terminal: the launch command + launch args + the method's args.
    const launch = agent('alpha', env);
    execFileSync(launch.command, [...launch.args, ...(method as { args: string[] }).args], { env: { ...process.env, ...env } });
    await p.restartAgent('alpha');
    expect((await p.getModels()).map((m) => m.id)).toEqual(['alpha']);
  }, 20_000);

  it('declares auth.terminal, configOptions.boolean, notices and plan to the agent', async () => {
    const p = await started([agent('alpha')]);
    await p.createConversation(conv('c1'));
    expect(await echo(p, 'c1', 'ECHO_CLIENT_CAPS')).toMatchObject({
      auth: { terminal: true },
      session: { compaction: {}, configOptions: { boolean: {} }, notices: {} },
      plan: {},
    });
  }, 20_000);
});

describe('AcpProvider — persistence', () => {
  it('resumes the agent session in a NEW process from the provider session id; forks when advertised', async () => {
    const sessions = path.join(dir, 'sessions.json');
    const env = { FAKE_ACP_RESUME: '1', FAKE_ACP_SESSIONS_FILE: sessions, FAKE_ACP_MODELS: '1' };
    const first = await started([agent('alpha', env)]);
    await first.createConversation(conv('c1', { model: 'alpha/smart' }));
    const providerSessionId = first.getProviderSessionId('c1')!;
    expect(providerSessionId).toMatch(/^alpha\//);
    expect(first.capabilitiesFor('c1')).toMatchObject({ sessionPersistence: true, conversationFork: true });

    const forked = await first.forkConversation('c1', { newConversationId: 'c1-fork', params: conv('c1-fork') });
    expect(forked.providerSessionId).toMatch(/^alpha\//);
    expect((await echo(first, 'c1-fork', 'ECHO_SESSION'))['forkedFrom']).toBe(providerSessionId.slice('alpha/'.length));
    await first.shutdown();

    const second = await started([agent('alpha', env)]);
    expect(await second.providerSessionExists(providerSessionId)).toBe(true);
    await second.resumeConversation('c1', conv('c1', { model: 'alpha/smart', resumeProviderSessionId: providerSessionId, resumeProviderSessionHarness: 'acp' }));
    expect(second.getProviderSessionId('c1')).toBe(providerSessionId);
    expect((await echo(second, 'c1', 'ECHO_SESSION'))['resumed']).toBe(true);
    expect(second.getConversationWarnings('c1').some((w) => w.code === 'CONVERSATION_RESTARTED')).toBe(false);

    // An unknown session cannot be resumed: a new session, reported as restarted.
    await second.createConversation(conv('c2', { resumeProviderSessionId: 'alpha/not-a-session' }));
    expect(second.getConversationWarnings('c2')).toContainEqual(expect.objectContaining({ code: 'CONVERSATION_RESTARTED' }));
    expect(second.hasLiveConversation('c2')).toBe(true);
  }, 30_000);

  it('a restarted agent resumes the sessions its conversations had', async () => {
    const env = { FAKE_ACP_RESUME: '1', FAKE_ACP_SESSIONS_FILE: path.join(dir, 's.json') };
    const p = await started([agent('alpha', env)]);
    await p.createConversation(conv('c1'));
    const before = p.getProviderSessionId('c1');
    await p.restartAgent('alpha');
    expect(p.hasLiveConversation('c1')).toBe(false);
    await p.resumeConversation('c1', conv('c1'));
    expect(p.getProviderSessionId('c1')).toBe(before);
    expect((await echo(p, 'c1', 'ECHO_SESSION'))['resumed']).toBe(true);
  }, 20_000);
});
