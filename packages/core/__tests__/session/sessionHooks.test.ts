// W-54 — a registered session hook fires for a chat.
//
// `buildHookBridge` was never assigned in a composition root, so no chat hook
// could ever run. The registry + factory is what the server now wires; this
// proves the whole path: registration → the chat's conversation config gets a
// bridge → the provider's pre-tool-use call runs the hook and honours it.

import { afterEach, describe, expect, it } from 'vitest';
import { sessionHookBridgeFactory } from '../../src/services/SessionHookRegistry.js';
import { bootCore, type TestEnv } from './boot.js';

const envs: TestEnv[] = [];
afterEach(() => {
  for (const e of envs.splice(0)) e.dispose();
});

describe('session hooks (W-54)', () => {
  it('a chat hook fires through the conversation hook bridge and can deny a tool', async () => {
    const env = bootCore();
    envs.push(env);
    const { sessionHookRegistry, hookInterceptor, eventBus, chatManagementService } = env.services;
    env.extensions.buildHookBridge = sessionHookBridgeFactory(sessionHookRegistry, hookInterceptor, eventBus);

    const seen: string[] = [];
    sessionHookRegistry.register('extension:test', 'pre_tool_use', (ctx) => {
      seen.push(ctx.event?.toolName ?? '?');
      return ctx.event?.toolName === 'Bash' ? { abort: true, abortReason: 'no shell' } : undefined;
    });

    await chatManagementService.createChat({ name: 'hooked' });
    const params = env.harness.calls.at(-1)!.params!;
    expect(params.hooks?.onPreToolUse).toBeTypeOf('function');

    const denied = await params.hooks!.onPreToolUse!({ toolName: 'Bash', toolArgs: { command: 'ls' }, timestamp: 0, cwd: '' }, { sessionId: 's' });
    expect(denied).toMatchObject({ decision: 'deny' });
    const allowed = await params.hooks!.onPreToolUse!({ toolName: 'Read', toolArgs: {}, timestamp: 0, cwd: '' }, { sessionId: 's' });
    expect((allowed as { decision?: string }).decision).toBeUndefined();
    expect(seen).toEqual(['Bash', 'Read']);
  });

  it('with nothing registered a chat gets no bridge (the config is unchanged)', async () => {
    const env = bootCore();
    envs.push(env);
    const { sessionHookRegistry, hookInterceptor, eventBus, chatManagementService } = env.services;
    env.extensions.buildHookBridge = sessionHookBridgeFactory(sessionHookRegistry, hookInterceptor, eventBus);
    await chatManagementService.createChat({ name: 'plain' });
    expect(env.harness.calls.at(-1)!.params!.hooks).toBeUndefined();
  });
});
