// ────────────────────────────────────────────────────────────────
// RV-26 — the platform tool surface survives the agent host.
//
// A session's host tools, its permission gate, its hook bridge and its
// per-turn options are functions and options the gateway builds. With the
// agent host ON they have to cross IPC; with it OFF they reach the provider
// directly. The same contract runs against both: whatever the provider calls
// must reach the gateway's function and come back with its answer.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import type { AgentHostRequest, AgentHostResponse } from '@generatorai/shared';
import {
  AgentHostClient,
  CustomToolRegistry,
  PlatformToolBinder,
  type CreateConversationParams,
  type HostSupervisor,
  type IAgentHarness,
  type PermissionRequest,
} from '@generatorai/core';
import { AgentHostServer } from '../AgentHostServer.js';
import { FakeHarness, silentLogger } from './helpers/fakeHarness.js';

class RecordingHarness extends FakeHarness {
  readonly turnOptions: unknown[] = [];
  override async sendPrompt(conversationId: string, prompt: string, _a?: unknown, options?: unknown): Promise<void> {
    await super.sendPrompt(conversationId, prompt);
    this.turnOptions.push(options);
  }
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

/** A gateway-side config: one custom tool, the permission gate and a hook bridge. */
function composedConfig(calls: string[]): CreateConversationParams {
  const registry = new CustomToolRegistry();
  registry.register({
    name: 'lookup',
    description: 'Look something up',
    parametersSchema: { type: 'object' },
    handler: async (args) => {
      calls.push(`tool:${JSON.stringify(args)}`);
      return { answer: 42, echo: args };
    },
  });
  const binder = new PlatformToolBinder({
    customToolRegistry: registry,
    buildHookBridge: () => ({
      onPreToolUse: async (input) => {
        calls.push(`hook:${input.toolName}`);
        return { decision: input.toolName === 'Bash' ? 'deny' : 'allow' };
      },
    }),
  });
  const cfg: Record<string, unknown> = { conversationId: 'conv-1', model: 'fake-1' };
  const target = {
    owner: { kind: 'chat' as const, chatId: 'chat-1', sessionId: 'sess-1' },
    sessionId: 'sess-1',
    conversationId: 'conv-1',
    groups: {
      browser: true,
      widgets: true,
      extensionAuthoring: false,
      orchestration: false,
      fileRead: true,
      fileWrite: true,
      shell: true,
      web: true,
    },
  };
  binder.custom(cfg, target);
  binder.hooks(cfg, target);
  cfg['onPermissionRequest'] = async (req: PermissionRequest) => {
    calls.push(`permission:${req.type}`);
    return { granted: req.type !== 'shell_exec', reason: 'gateway decided' };
  };
  return cfg as unknown as CreateConversationParams;
}

/** The agent host ON: an AgentHostClient wired to an in-process AgentHostServer. */
function hostedHarness(provider: RecordingHarness): IAgentHarness {
  const pending = new Map<string, (r: AgentHostResponse) => void>();
  let client!: AgentHostClient;
  const server = new AgentHostServer({
    logger: silentLogger(),
    send: (msg, callback) => {
      setImmediate(() => {
        callback(null);
        const reqId = (msg as { reqId?: string }).reqId;
        if (reqId && pending.has(reqId)) {
          const resolve = pending.get(reqId)!;
          pending.delete(reqId);
          resolve(msg);
        } else if (msg.type === 'agent_event' || msg.type === 'session_ended' || msg.type === 'callback_invoke') {
          client.handleHostEvent(msg);
        }
      });
      return true;
    },
  });
  server.registerHarness(provider.asHarness());
  let seq = 0;
  const supervisor = {
    start: async () => undefined,
    stop: async () => undefined,
    getState: () => 'running',
    send: (req: Record<string, unknown>) =>
      new Promise<AgentHostResponse>((resolve) => {
        const reqId = `r-${++seq}`;
        pending.set(reqId, resolve);
        server.onMessage({ ...req, reqId } as AgentHostRequest);
      }),
  } as unknown as HostSupervisor;
  client = new AgentHostClient(supervisor, silentLogger());
  return client;
}

describe.each([
  ['off', (p: RecordingHarness) => p.asHarness()],
  ['on', hostedHarness],
] as const)('binder contract with the agent host %s (RV-26)', (_mode, wrap) => {
  it('tools, the permission gate, the hook bridge and turn options reach the gateway', async () => {
    const provider = new RecordingHarness();
    const harness = wrap(provider);
    const calls: string[] = [];
    const conversationId = await harness.createConversation(composedConfig(calls));
    await flush();

    const seen = provider.createParams.at(-1) as unknown as CreateConversationParams;
    // What the provider holds is callable, whichever side of the IPC it is on.
    const tool = seen.tools!.find((t) => t.name === 'lookup')!;
    expect(tool.description).toBe('Look something up');
    await expect(tool.handler({ q: 'x' })).resolves.toEqual({ answer: 42, echo: { q: 'x' } });

    await expect(
      seen.onPermissionRequest!({ type: 'shell_exec', description: 'rm -rf /' } as PermissionRequest),
    ).resolves.toEqual({ granted: false, reason: 'gateway decided' });
    await expect(
      seen.onPermissionRequest!({ type: 'file_write', description: 'edit a file' } as PermissionRequest),
    ).resolves.toEqual({ granted: true, reason: 'gateway decided' });

    await expect(
      seen.hooks!.onPreToolUse!({ toolName: 'Bash', toolArgs: {}, timestamp: 0, cwd: '' }, { sessionId: 's' }),
    ).resolves.toEqual({ decision: 'deny' });

    expect(calls).toEqual(['tool:{"q":"x"}', 'permission:shell_exec', 'permission:file_write', 'hook:Bash']);

    await harness.sendPrompt(conversationId, 'go', undefined, { agentMode: 'plan', permissionMode: 'plan' });
    await flush();
    expect(provider.turnOptions.at(-1)).toEqual({ agentMode: 'plan', permissionMode: 'plan' });
  });
});
