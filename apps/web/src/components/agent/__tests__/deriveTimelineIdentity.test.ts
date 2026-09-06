// ────────────────────────────────────────────────────────────────
// deriveTimeline — step identity is stable across derivations (review 6.4,
// plan item 18). `StepRow` is `React.memo`; it can only skip work if an
// unchanged step is the SAME object next frame. Remove the interning at the
// end of `deriveTimeline` and every `toBe` below fails.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { deriveTimeline, deriveStreamView } from '../deriveTimeline.js';
import type { StreamBlock } from '@/stores/streamStore.js';

let nextId = 1;
function tool(
  name: string,
  callId: string,
  extra: Partial<Extract<StreamBlock, { type: 'tool_call' }>> = {},
): StreamBlock {
  return {
    type: 'tool_call',
    blockId: nextId++,
    callId,
    tool: name,
    args: { file_path: `/src/${callId}.ts` },
    status: 'complete',
    ...extra,
  } as StreamBlock;
}
function text(content: string): StreamBlock {
  return { type: 'text', blockId: nextId++, content } as StreamBlock;
}
function thinking(t: string, isComplete = true): StreamBlock {
  return { type: 'thinking', blockId: nextId++, text: t, isComplete } as StreamBlock;
}
function sys(message: string, category: 'subagent' | 'error'): StreamBlock {
  return { type: 'system', blockId: nextId++, message, category } as StreamBlock;
}

describe('deriveTimeline — step object identity', () => {
  it('returns the same step objects when the blocks are unchanged (a token frame)', () => {
    const read = tool('Read', 'r1');
    // `kind` is 'create' | 'update' | 'edit' | 'delete' (ToolFileOp) — 'write'
    // was never a member, only true here because the test object is widened
    // via `as StreamBlock`. Matches the convention used for a Write tool
    // call elsewhere (deriveTimelineExtras.test.ts).
    const write = tool('Write', 'w1', { fileOp: { kind: 'create', filePath: 'a.ts', additions: 3, deletions: 1 } });
    const think = thinking('plan it');
    const err = sys('boom', 'error');
    const blocks1 = [think, read, write, err, text('Hello')];
    const first = deriveTimeline(blocks1, { active: true });

    // A streamed token appends/replaces a TEXT block; every step block keeps
    // its identity — which is exactly the case the memo has to win.
    const blocks2 = [think, read, write, err, text('Hello, wor')];
    const second = deriveTimeline(blocks2, { active: true });

    expect(second).toHaveLength(first.length);
    second.forEach((step, i) => expect(step).toBe(first[i]));
  });

  it('a changed block yields a new step, and only that step', () => {
    const read = tool('Read', 'r2', { status: 'running' });
    const grep = tool('Grep', 'g2');
    const first = deriveTimeline([read, grep], { active: true });

    const readDone = { ...read, status: 'complete', result: 'ok' } as StreamBlock;
    const second = deriveTimeline([readDone, grep], { active: true });

    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.status).toBe('done');
    expect(second[1]).toBe(first[1]);
  });

  it('the turn settling changes the status of an unresolved call — and its identity', () => {
    const pending = tool('Bash', 'b3', { status: 'running' });
    const live = deriveTimeline([pending], { active: true });
    const settled = deriveTimeline([pending], { active: false });
    expect(live[0]!.status).toBe('running');
    expect(settled[0]!.status).toBe('pending');
    expect(settled[0]).not.toBe(live[0]);
    // …and asking for the live view again returns the live object, not a third one.
    expect(deriveTimeline([pending], { active: true })[0]).toBe(live[0]);
  });

  it('a parent is reused only while its children are identical', () => {
    const agent = tool('Agent', 'a4', { args: { description: 'explore' } });
    const child1 = tool('Read', 'c4-1', { parentCallId: 'a4' });
    const first = deriveTimeline([agent, child1], { active: true });
    const again = deriveTimeline([agent, child1], { active: true });
    expect(again[0]).toBe(first[0]);
    expect(again[0]!.children![0]).toBe(first[0]!.children![0]);

    const child2 = tool('Grep', 'c4-2', { parentCallId: 'a4' });
    const grown = deriveTimeline([agent, child1, child2], { active: true });
    expect(grown[0]).not.toBe(first[0]);
    expect(grown[0]!.children).toHaveLength(2);
    // The unchanged child keeps its identity inside the new parent.
    expect(grown[0]!.children![0]).toBe(first[0]!.children![0]);
  });

  it('the subagent composite is stable while its messages are, and moves when they grow', () => {
    const started = sys('Sub-agent started: scout', 'subagent');
    const a = deriveTimeline([started], { active: true });
    const b = deriveTimeline([started], { active: true });
    expect(b[0]).toBe(a[0]);

    const done = sys('Sub-agent completed: scout', 'subagent');
    const c = deriveTimeline([started, done], { active: true });
    expect(c[0]).not.toBe(a[0]);
    expect(c[0]!.status).toBe('done');
    expect(c[0]!.children![0]).toBe(a[0]!.children![0]);
  });

  it('deriveStreamView keeps step identity across its full-list and per-segment derivations', () => {
    const read = tool('Read', 'r6');
    const scout = sys('Sub-agent started: scout', 'subagent');
    const blocks = [read, text('answer so far'), scout];
    const v1 = deriveStreamView(blocks, { active: true });
    const v2 = deriveStreamView([...blocks, text(' more')], { active: true });
    v2.steps.forEach((s, i) => expect(s).toBe(v1.steps[i]));
    const seg1 = v1.segments.filter((s) => s.type === 'steps');
    const seg2 = v2.segments.filter((s) => s.type === 'steps');
    expect(seg2).toHaveLength(seg1.length);
    seg2.forEach((s, i) => {
      if (s.type !== 'steps' || seg1[i]!.type !== 'steps') throw new Error('unexpected segment');
      s.steps.forEach((step, j) => expect(step).toBe((seg1[i] as { steps: unknown[] }).steps[j]));
    });
  });
});
