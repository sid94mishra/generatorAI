// U-76: starting a workflow run asks a person in the asking modes. Providers pre-approve host tools,
// so without the server-side ask `run_workflow` ran unasked from an "Accept edits, ask for the rest" chat.

import { describe, expect, it, vi } from 'vitest';
import { PlatformToolBinder, type BindTarget } from '../../src/services/session/PlatformToolBinder.js';
import type { TurnContext } from '../../src/services/session/types.js';
import type { WorkflowToolHost } from '../../src/tools/workflows/WorkflowToolHost.js';

type Tool = { name: string; handler: (args: Record<string, unknown>) => Promise<unknown> };

const target: BindTarget = { owner: { kind: 'chat', chatId: 'c1', sessionId: 's1' }, sessionId: 's1', conversationId: 'conv-1', groups: {} as never };
const turnIn = (permissionMode: string) => ({ permissionMode }) as unknown as TurnContext;

function bind(mode: string, permission: (...a: unknown[]) => Promise<{ granted: boolean; reason?: string }>) {
  const host = {
    hasAuthoring: false,
    run: vi.fn(async () => ({ runId: 'r1' })),
    cancel: vi.fn(async () => ({ ok: true })),
    list: vi.fn(async () => ({ workflows: [] })),
  };
  const cfg: Record<string, unknown> = { conversationId: 'conv-1' };
  new PlatformToolBinder({ workflowTools: host as unknown as WorkflowToolHost }).workflows(cfg as never, target, {
    run: true,
    authoring: false,
    orchestrator: false,
    turnOf: () => undefined,
    port: { permission },
    gateTurnOf: () => turnIn(mode),
  });
  const tool = (name: string) => (cfg['tools'] as Tool[]).find((t) => t.name === name)!;
  return { host, tool };
}

describe('workflow tools ask before starting a run (U-76)', () => {
  it('run_workflow asks in Accept edits; reads and cancelling its own run do not', async () => {
    const permission = vi.fn(async () => ({ granted: true }));
    const { host, tool } = bind('acceptEdits', permission);
    await tool('run_workflow').handler({ workflowId: 'w1', reason: 'check develop' });
    await tool('cancel_workflow_run').handler({ runId: 'r1', reason: 'not needed' });
    await tool('list_workflows').handler({});
    expect(permission).toHaveBeenCalledTimes(1);
    expect(host.cancel).toHaveBeenCalledTimes(1);
    expect(permission).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ toolName: 'run_workflow' }) }), expect.anything());
    expect(host.run).toHaveBeenCalledTimes(1);
  });

  it('a denied start never reaches the host; full access does not ask', async () => {
    const denied = bind('acceptEdits', async () => ({ granted: false, reason: 'Not now.' }));
    await expect(denied.tool('run_workflow').handler({ workflowId: 'w1', reason: 'x' })).rejects.toThrow('Not now.');
    expect(denied.host.run).not.toHaveBeenCalled();

    const permission = vi.fn(async () => ({ granted: true }));
    const full = bind('bypassPermissions', permission);
    await full.tool('run_workflow').handler({ workflowId: 'w1', reason: 'x' });
    expect(permission).not.toHaveBeenCalled();
    expect(full.host.run).toHaveBeenCalledTimes(1);
  });
});
