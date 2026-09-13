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

describe('tool failure + screenshots', () => {
  it('a provider-flagged failure renders as a failed step', () => {
    const steps = deriveTimeline([tool('Bash', 'b1', { args: { command: 'x' }, result: 'boom', error: true })], { active: false });
    expect(steps[0]!.status).toBe('failed');
  });

  it('the browser tools ok:false envelope counts as a failure (object or JSON string)', () => {
    const asObject = deriveTimeline([tool('click_element', 'c1', { result: { ok: false, error: 'stale ref' } })], { active: false });
    const asString = deriveTimeline([tool('click_element', 'c2', { result: JSON.stringify({ ok: false, error: 'stale ref' }) })], { active: false });
    const fine = deriveTimeline([tool('click_element', 'c3', { result: { ok: true } })], { active: false });
    expect(asObject[0]!.status).toBe('failed');
    expect(asString[0]!.status).toBe('failed');
    expect(fine[0]!.status).toBe('done');
  });

  it('surfaces a browser screenshot artifact on the step', () => {
    const steps = deriveTimeline(
      [tool('screenshot_page', 's1', { result: JSON.stringify({ ok: true, artifactPath: 'browser/screenshots/page-1.png', artifactType: 'browser_screenshot' }) })],
      { active: false },
    );
    expect(steps[0]!.image).toEqual({ relativePath: 'browser/screenshots/page-1.png', label: 'page-1.png' });
    const none = deriveTimeline([tool('read_page', 'r1', { result: { ok: true, artifactPath: 'browser/dom/x.html', artifactType: 'browser_dom' } })], { active: false });
    expect(none[0]!.image).toBeUndefined();
  });
});

// ── A plan the agent published used to land in the `system` category and be
// dropped outright, so a Codex/Claude checklist reached nobody. ──

describe('plan updates render as one collapsed step with the checklist as children', () => {
  function planBlock(message: string): StreamBlock {
    return { type: 'system', blockId: nextId++, message, category: 'plan' } as StreamBlock;
  }

  it('summarises the plan on the row and keeps each step as a child', () => {
    const steps = deriveTimeline(
      [planBlock('Plan: 1/3 done\nThree steps.\n[x] read the parser\n[~] fix the bug\n[ ] add a test')],
      { active: true },
    );
    expect(steps).toHaveLength(1);
    const plan = steps[0]!;
    expect(plan.verb).toBe('Plan');
    // The "Plan: " prefix is the row's own label, not part of the target.
    expect(plan.target).toBe('1/3 done');
    // The explanation is a child alongside the steps rather than being lost.
    expect(plan.children?.map((c) => c.target)).toEqual([
      'Three steps.',
      'read the parser',
      'fix the bug',
      'add a test',
    ]);
    // Each step carries its OWN state, so a half-finished plan does not read
    // as though every line were done.
    expect(plan.children?.map((c) => c.status)).toEqual(['done', 'done', 'running', 'pending']);
  });

  it('renders a plan with no steps without inventing children', () => {
    const steps = deriveTimeline([planBlock('Plan updated')], { active: false });
    expect(steps[0]!.target).toBe('Plan updated');
    expect(steps[0]!.children).toBeUndefined();
  });
});
