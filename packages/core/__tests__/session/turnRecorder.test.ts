// WP-2.9 — the TurnRecorder (chats and stages).

import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@generatorai/shared';
import { TurnRecorder } from '../../src/services/session/TurnRecorder.js';

const ev = (kind: string, data: Record<string, unknown> = {}) => ({ kind, data }) as unknown as AgentEvent;

describe('TurnRecorder', () => {
  it('a completed turn is complete; a stopped one is partial with its calls settled (RV-10)', () => {
    let n = 0;
    const r = new TurnRecorder({ takeSequence: () => n++ });
    r.begin({ turnId: 't1', agentMode: 'auto' });
    r.observe(ev('harness.tool_start', { callId: 'c1', tool: 'bash', args: { cmd: 'ls' } }));
    r.observe(ev('harness.token', { text: 'Half an ans' }));
    const stopped = r.take({ partial: true });
    expect(stopped).toMatchObject({ content: 'Half an ans', complete: false, metadata: { partial: true, turnId: 't1' } });
    expect(stopped!.metadata.toolCalls![0]).toMatchObject({ status: 'complete', success: false, sequence: 0 });
    expect(r.take()).toBeUndefined(); // once per turn

    r.begin({ turnId: 't2' });
    expect(r.take()).toBeUndefined(); // a completed turn needs text
    r.observe(ev('harness.message_complete', { content: 'All done', providerMessageId: 'm-1' }));
    expect(r.take()).toMatchObject({
      content: 'All done',
      complete: true,
      metadata: { turnId: 't2', providerAnchor: { kind: 'message', id: 'm-1' } },
    });
  });

  it('snapshot/restore round-trips a settled turn and marks it persisted', () => {
    const r = new TurnRecorder();
    r.begin();
    r.observe(ev('harness.reasoning_delta', { text: 'hmm' }));
    r.observe(ev('harness.message_complete', { content: 'ok' }));
    const snap = r.snapshot();
    const replayed = new TurnRecorder();
    replayed.restore(snap);
    expect(replayed.content).toBe('ok');
    expect(replayed.persisted).toBe(true);
    expect(replayed.snapshot()).toEqual(snap);
  });
});
