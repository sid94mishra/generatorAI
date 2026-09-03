// ────────────────────────────────────────────────────────────────
// deriveTimeline extras — subagent nesting, fileOp meta, shell flags.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { deriveTimeline, isShellTool } from '../deriveTimeline.js';
import type { StreamBlock } from '@/stores/streamStore.js';

let nextId = 1;
function tool(
  tool: string,
  callId: string,
  extra: Partial<Extract<StreamBlock, { type: 'tool_call' }>> = {},
): StreamBlock {
  return {
    type: 'tool_call',
    blockId: nextId++,
    callId,
    tool,
    args: {},
    status: 'complete',
    ...extra,
  } as StreamBlock;
}

describe('subagent nesting', () => {
  it('nests a child step under its Agent parent instead of the top level', () => {
    const steps = deriveTimeline(
      [
        tool('Agent', 'agent-1', { args: { description: 'explore repo' } }),
        tool('Read', 'read-1', { parentCallId: 'agent-1' }),
        tool('Grep', 'grep-1', { parentCallId: 'agent-1' }),
        tool('Write', 'write-1'),
      ],
      { active: false },
    );
    const ids = steps.map((s) => s.id);
    expect(ids).toHaveLength(2); // Agent + Write, children folded in
    const agent = steps.find((s) => s.verb === 'Agent');
    expect(agent?.kind).toBe('subagent');
    expect(agent?.children?.map((c) => c.verb)).toEqual(['Read', 'Grep']);
  });

  it('falls back to top level when the parent is missing (clipped replay)', () => {
    const steps = deriveTimeline(
      [tool('Read', 'r1', { parentCallId: 'gone-agent' })],
      { active: false },
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]!.verb).toBe('Read');
  });
});

describe('fileOp on steps', () => {
  it('surfaces +A −D as the step meta and carries fileOp through', () => {
    const steps = deriveTimeline(
      [
        tool('Write', 'w1', {
          args: { file_path: 'src/a.ts' },
          fileOp: { kind: 'create', filePath: 'src/a.ts', additions: 12, deletions: 0 },
        }),
      ],
      { active: false },
    );
    expect(steps[0]!.meta).toBe('+12 −0');
    expect(steps[0]!.fileOp).toMatchObject({ additions: 12 });
    expect(steps[0]!.callId).toBe('w1');
  });
});

describe('isShellTool', () => {
  it('matches only the built-in shell tools', () => {
    expect(isShellTool('Bash')).toBe(true);
    expect(isShellTool('PowerShell')).toBe(true);
    expect(isShellTool('mcp__generatorai-tools__run_script')).toBe(false);
    expect(isShellTool('Write')).toBe(false);
  });

  it('flags shell steps for the terminal affordance', () => {
    const steps = deriveTimeline(
      [tool('PowerShell', 'p1', { args: { command: 'npm test' } })],
      { active: false },
    );
    expect(steps[0]!.isShell).toBe(true);
  });
});
