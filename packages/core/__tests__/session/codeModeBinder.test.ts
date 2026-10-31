// D-182: `run_code` is bound last, only when the owner's `codeMode` group is on, over the tools bound before it —
// and a script's calls go through those tools' own (gated) handlers.

import { describe, expect, it, vi } from 'vitest';
import { PlatformToolBinder, type BindTarget } from '../../src/services/session/PlatformToolBinder.js';
import { askBeforeRunning } from '../../src/services/session/gates.js';
import type { TurnContext } from '../../src/services/session/types.js';
import type { ToolDefinition } from '../../src/domain/ports/IAgentHarness.js';

const targetWith = (codeMode: boolean): BindTarget => ({
  owner: { kind: 'chat', chatId: 'c1', sessionId: 's1' },
  sessionId: 's1',
  conversationId: 'conv-1',
  groups: { codeMode } as never,
});

const plain = (name: string, handler: ToolDefinition['handler']): ToolDefinition => ({
  name,
  description: `${name}.`,
  parametersSchema: { type: 'object', properties: {} },
  handler,
});

describe('PlatformToolBinder.codeMode', () => {
  it('binds nothing when the group is off', () => {
    const cfg: Record<string, unknown> = { tools: [plain('a', async () => 1)] };
    new PlatformToolBinder({}).codeMode(cfg, targetWith(false));
    expect((cfg['tools'] as ToolDefinition[]).map((t) => t.name)).toEqual(['a']);
  });

  it('appends run_code last, listing the tools before it, and calls their gated handlers', async () => {
    const permission = vi.fn(async () => ({ granted: false, reason: 'Declined by the user.' }));
    const navigate = vi.fn(async () => 'navigated');
    const [gated] = askBeforeRunning([plain('navigate_page', navigate)], {
      turnOf: () => ({ permissionMode: 'default' }) as unknown as TurnContext,
      port: { permission },
    });
    const cfg: Record<string, unknown> = { tools: [plain('list_items', async () => JSON.stringify([1, 2])), gated] };
    new PlatformToolBinder({}).codeMode(cfg, targetWith(true));
    const tools = cfg['tools'] as ToolDefinition[];
    expect(tools.map((t) => t.name)).toEqual(['list_items', 'navigate_page', 'run_code']);
    const runCode = tools[2]!;
    expect(runCode.description).toContain('- list_items(');
    expect(runCode.description).toContain('- navigate_page(');

    const report = JSON.parse(
      (await runCode.handler({
        code: 'const items = await tools.list_items({}); try { await tools.navigate_page({}); } catch (e) { return [items.length, e.message]; }',
      })) as string,
    );
    expect(report.result).toEqual([2, 'tools.navigate_page failed: Declined by the user.']);
    expect(permission).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });
});
