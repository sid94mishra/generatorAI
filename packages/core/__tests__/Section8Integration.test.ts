// ────────────────────────────────────────────────────────────────
// Section 8 + HKS-01 integration tests
//
// Exercises the whole new surface end-to-end, without a real harness:
//
//   • CustomToolRegistry + gated tool execution
//   • PermissionPolicy evaluation (all four modes)
//   • makePolicyHookBridge → HookBridge (TOL-04)
//   • HookInterceptor.buildHookBridge → HookBridge (HKS-01)
//   • mergeHookBridges composition
//   • IMcpHub pass-through + override
//
// A `FakeHarness` stands in for the Copilot adapter. It records which
// fields it received on `createConversation` and invokes the supplied
// `hooks.onPreToolUse` synchronously so tests can assert on the
// harness-agnostic contract.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  CustomToolRegistry,
  withPermissionGate,
  ToolPermissionDeniedError,
  evaluateToolPermissions,
  makePolicyHookBridge,
  mergeHookBridges,
  InMemoryMcpHub,
} from '../src/index.js';
import type {
  ToolDefinition,
  PermissionPolicy,
  HookBridge,
  PreToolUseHookInput,
  PreToolUseHookOutput,
  HookContext,
} from '../src/index.js';
import { HookExecutor } from '../src/services/HookExecutor.js';
import { HookInterceptor } from '../src/services/HookInterceptor.js';
import { EventBus } from '../src/events/EventBus.js';

// ── TOL-01: CustomToolRegistry ────────────────────────────────────

describe('CustomToolRegistry (TOL-01)', () => {
  const sampleTool: ToolDefinition = {
    name: 'fs.write',
    description: 'Write a file',
    parametersSchema: { type: 'object', properties: { path: { type: 'string' } } },
    handler: async () => 'ok',
    requiredPermissions: [{ kind: 'file_write' }],
    owner: 'test-suite',
  };

  it('registers + lists + looks up by name', () => {
    const r = new CustomToolRegistry();
    r.register(sampleTool);
    expect(r.size).toBe(1);
    expect(r.get('fs.write')).toBe(sampleTool);
    expect(r.list()).toEqual([sampleTool]);
    expect(r.listNames()).toEqual(['fs.write']);
  });

  it('rejects duplicate registration', () => {
    const r = new CustomToolRegistry();
    r.register(sampleTool);
    expect(() => r.register(sampleTool)).toThrow(/already registered/);
  });

  it('unregister returns whether the removal happened', () => {
    const r = new CustomToolRegistry();
    r.register(sampleTool);
    expect(r.unregister('fs.write')).toBe(true);
    expect(r.unregister('fs.write')).toBe(false);
    expect(r.size).toBe(0);
  });

  it('getSubset preserves request order and silently drops unknowns', () => {
    const r = new CustomToolRegistry();
    r.register({ ...sampleTool, name: 'a' });
    r.register({ ...sampleTool, name: 'b' });
    r.register({ ...sampleTool, name: 'c' });
    const subset = r.getSubset(['c', 'x', 'a']);
    expect(subset.map((t) => t.name)).toEqual(['c', 'a']);
  });
});

// ── TOL-02: gatedTool + TOL-04: PermissionPolicy ─────────────────

describe('withPermissionGate (TOL-02) + PermissionPolicy (TOL-04)', () => {
  const writeTool: ToolDefinition = {
    name: 'fs.write',
    description: 'Write a file',
    parametersSchema: {},
    handler: async () => 'wrote',
    requiredPermissions: [{ kind: 'file_write' }],
  };

  const shellTool: ToolDefinition = {
    name: 'shell.exec',
    description: 'Execute a shell command',
    parametersSchema: {},
    handler: async () => 'ran',
    requiredPermissions: [{ kind: 'shell_exec' }],
  };

  const safeTool: ToolDefinition = {
    name: 'meta.ping',
    description: 'No-op',
    parametersSchema: {},
    handler: async () => 'pong',
    skipPermission: true,
  };

  it('acceptEdits auto-allows file writes but gates shell exec', async () => {
    const policy: PermissionPolicy = { mode: 'acceptEdits', rules: [] };
    const gated = [writeTool, shellTool].map((t) => withPermissionGate(t, { policy }));

    // write runs
    await expect(gated[0]!.handler({})).resolves.toBe('wrote');
    // shell surfaces as 'ask' (no rule) — wrapper allows 'ask' through
    await expect(gated[1]!.handler({})).resolves.toBe('ran');
  });

  it('plan mode turns every tool into ask (wrapper allows)', async () => {
    const policy: PermissionPolicy = { mode: 'plan', rules: [] };
    const gated = withPermissionGate(writeTool, { policy });
    await expect(gated.handler({})).resolves.toBe('wrote');
  });

  it('rule-based deny throws ToolPermissionDeniedError', async () => {
    const policy: PermissionPolicy = {
      mode: 'default',
      rules: [{ name: 'block-shell', action: 'deny', tool: 'shell.*' }],
    };
    const gated = withPermissionGate(shellTool, { policy });
    await expect(gated.handler({})).rejects.toBeInstanceOf(ToolPermissionDeniedError);
  });

  it('skipPermission bypasses the gate entirely', async () => {
    const policy: PermissionPolicy = {
      mode: 'default',
      rules: [{ name: 'deny-all', action: 'deny' }],
    };
    const gated = withPermissionGate(safeTool, { policy });
    await expect(gated.handler({})).resolves.toBe('pong');
  });

  it('bypassPermissions allows everything', () => {
    const policy: PermissionPolicy = { mode: 'bypassPermissions', rules: [] };
    const d = evaluateToolPermissions(policy, 'anything.goes', [{ kind: 'shell_exec' }]);
    expect(d.action).toBe('allow');
  });

  it('default mode with no matching rule → ask', () => {
    const policy: PermissionPolicy = { mode: 'default', rules: [] };
    const d = evaluateToolPermissions(policy, 'some.tool', [{ kind: 'network' }]);
    expect(d.action).toBe('ask');
  });
});

// ── HKS-01: policyHookBridge + mergeHookBridges ──────────────────

describe('PolicyHookBridge + mergeHookBridges (TOL-04 + HKS-01)', () => {
  const registry = new CustomToolRegistry();
  registry.register({
    name: 'fs.write',
    description: 'w',
    parametersSchema: {},
    handler: async () => 'ok',
    requiredPermissions: [{ kind: 'file_write' }],
  });

  const input: PreToolUseHookInput = {
    timestamp: Date.now(),
    cwd: '/tmp',
    toolName: 'fs.write',
    toolArgs: { path: '/x.txt' },
  };

  it('plan mode → bridge returns decision=ask', async () => {
    const bridge = makePolicyHookBridge({
      policy: { mode: 'plan', rules: [] },
      registry,
    });
    const out = await bridge.onPreToolUse!(input, { sessionId: 's1' });
    expect((out as PreToolUseHookOutput).decision).toBe('ask');
  });

  it('explicit deny rule → bridge returns decision=deny with reason', async () => {
    const bridge = makePolicyHookBridge({
      policy: {
        mode: 'default',
        rules: [{ name: 'no-writes', action: 'deny', kind: 'file_write' }],
      },
      registry,
    });
    const out = (await bridge.onPreToolUse!(input, { sessionId: 's1' })) as PreToolUseHookOutput;
    expect(out.decision).toBe('deny');
    expect(out.reason).toContain('no-writes');
  });

  it('mergeHookBridges — first deny wins across bridges', async () => {
    const allowBridge: HookBridge = {
      onPreToolUse: async () => ({ decision: 'allow', reason: 'a' }),
    };
    const denyBridge: HookBridge = {
      onPreToolUse: async () => ({ decision: 'deny', reason: 'b' }),
    };
    const merged = mergeHookBridges(allowBridge, denyBridge);
    const out = (await merged.onPreToolUse!(input, { sessionId: 's1' })) as PreToolUseHookOutput;
    expect(out.decision).toBe('deny');
    expect(out.reason).toBe('b');
  });

  it('mergeHookBridges — all-allow stays allow', async () => {
    const b1: HookBridge = { onPreToolUse: async () => ({ decision: 'allow' }) };
    const b2: HookBridge = { onPreToolUse: async () => ({ decision: 'allow' }) };
    const merged = mergeHookBridges(b1, b2);
    const out = (await merged.onPreToolUse!(input, { sessionId: 's1' })) as PreToolUseHookOutput;
    expect(out.decision).toBe('allow');
  });
});

// ── HKS-01: HookInterceptor.buildHookBridge end-to-end ───────────

describe('HookInterceptor.buildHookBridge (HKS-01)', () => {
  it('pre_tool_use hook with failurePolicy=abort denies via bridge', async () => {
    const eventBus = new EventBus();
    const hookExecutor = new HookExecutor(
      { run: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 0 }), isAvailable: async () => true },
      { request: async () => ({ status: 200, headers: {}, body: '' }) },
      eventBus,
    );
    const interceptor = new HookInterceptor(hookExecutor, eventBus);

    // Register an in-process function hook that always fails, with
    // failurePolicy=abort so the phase returns false → bridge returns
    // decision='deny'.
    hookExecutor.registerFunctionHandler('gate', async () => {
      throw new Error('gate denied');
    });

    const bridge = interceptor.buildHookBridge(
      [{
        id: 'h1',
        name: 'gate-hook',
        phase: 'pre_tool_use',
        type: 'function',
        priority: 0,
        enabled: true,
        failurePolicy: 'abort',
        timeoutMs: 500,
        retries: 0,
        config: { type: 'function', handlerName: 'gate' },
      }],
      {
        sessionId: 's1',
        workflowId: 'w1',
        workspacePath: '/tmp',
        variables: {},
        eventBus,
      } satisfies HookContext,
    );

    const out = (await bridge.onPreToolUse!(
      { timestamp: Date.now(), cwd: '/tmp', toolName: 'shell.exec', toolArgs: {} },
      { sessionId: 's1' },
    )) as PreToolUseHookOutput;
    expect(out.decision).toBe('deny');
    expect(out.reason).toContain('pre_tool_use hook denied');
  });
});

// ── TOL-06: IMcpHub ──────────────────────────────────────────────

describe('InMemoryMcpHub (TOL-06)', () => {
  it('pass-through resolve returns declared servers unchanged', async () => {
    const hub = new InMemoryMcpHub();
    const resolved = await hub.resolveForRun({
      workflowDefinitionId: 'd1',
      workflowRunId: 'r1',
      declared: {
        github: { type: 'http', url: 'https://api.github.com/mcp' },
        local: { type: 'stdio', command: 'node', args: ['./mcp.js'] },
      },
    });
    expect(Object.keys(resolved.servers)).toEqual(['github', 'local']);
  });

  it('disable() drops the server from the resolved config', async () => {
    const hub = new InMemoryMcpHub();
    hub.disable('github');
    const resolved = await hub.resolveForRun({
      workflowDefinitionId: 'd1',
      workflowRunId: 'r1',
      declared: {
        github: { type: 'http', url: 'x' },
        local: { type: 'stdio', command: 'c' },
      },
    });
    expect(Object.keys(resolved.servers)).toEqual(['local']);
    expect(hub.isDisabled('github')).toBe(true);
  });
});
