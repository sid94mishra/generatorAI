// ────────────────────────────────────────────────────────────────
// Sub-agent derivation — orchestrator background workers and the SDKs'
// own delegation tools (`Task` / `Agent`).
//
// Two distinct things end up as `kind: 'subagent'` steps:
//   • a `background_task` block (an orchestrator worker, live events), and
//   • a `spawn_background_agent` tool call (the same worker, replayed from
//     persisted history, where no background_task block exists).
// Both must carry the worker's chat id so the row can link to it.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { deriveTimeline, backgroundTaskStatus, spawnWorkerRef, backgroundDigests } from '../deriveTimeline.js';
import type { StreamBlock } from '@/stores/streamStore.js';

let nextId = 1;

function worker(over: Partial<Extract<StreamBlock, { type: 'background_task' }>> = {}): StreamBlock {
  return {
    type: 'background_task',
    blockId: nextId++,
    taskId: 'chat-w1',
    taskName: 'research-react',
    status: 'running',
    toolCalls: 0,
    startedAt: 1_700_000_000_000,
    ...over,
  } as StreamBlock;
}

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
    args: {},
    status: 'complete',
    ...extra,
  } as StreamBlock;
}

describe('background_task → subagent step', () => {
  it('derives a Worker step with the task name as its target', () => {
    const steps = deriveTimeline([worker()], { active: true });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'subagent',
      verb: 'Worker',
      target: 'research-react',
      status: 'running',
      workerChatId: 'chat-w1',
    });
  });

  it('spins while the WORKER runs, whether or not the orchestrator turn is live', () => {
    expect(deriveTimeline([worker()], { active: true })[0]?.status).toBe('running');
    // Workers outlive the turn that spawned them: the orchestrator says
    // "spawned" and goes idle while they work. The row must keep spinning
    // until the worker's own terminal event lands.
    expect(deriveTimeline([worker()], { active: false })[0]?.status).toBe('running');
    expect(deriveTimeline([worker({ status: 'completed' })], { active: false })[0]?.status).toBe('done');
  });

  it('maps worker statuses onto step statuses', () => {
    expect(backgroundTaskStatus('failed')).toBe('failed');
    expect(backgroundTaskStatus('cancelled')).toBe('failed');
    expect(backgroundTaskStatus('completed')).toBe('done');
    expect(backgroundTaskStatus('needs_review')).toBe('done');
    expect(backgroundTaskStatus('spawned')).toBe('running');
  });

  it('exposes the current step, text excerpt and model as children', () => {
    const steps = deriveTimeline(
      [worker({ currentStep: 'Bash', lastText: 'running tests', model: 'sonnet', toolCalls: 4 })],
      { active: true },
    );
    const children = steps[0]?.children ?? [];
    expect(children.map((c) => c.target)).toEqual([
      'Running Bash',
      'running tests',
      'sonnet',
    ]);
    expect(steps[0]?.meta).toBe('4 tool calls');
  });

  it('humanises the synthetic step names', () => {
    const thinking = deriveTimeline([worker({ currentStep: 'thinking' })], { active: true });
    expect(thinking[0]?.children?.[0]?.target).toBe('Thinking…');
    const writing = deriveTimeline([worker({ currentStep: 'writing' })], { active: true });
    expect(writing[0]?.children?.[0]?.target).toBe('Writing…');
  });

  it('nests the worker under the spawn call that created it', () => {
    const steps = deriveTimeline(
      [
        tool('spawn_background_agent', 'call-1', {
          args: { taskName: 'research-react' },
          result: { ok: true, taskId: 'chat-w1', taskName: 'research-react' },
        }),
        worker({ parentCallId: 'call-1' }),
      ],
      { active: true },
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]?.children?.some((c) => c.verb === 'Worker')).toBe(true);
  });

  it('renders as a top-level step when its spawn call is missing', () => {
    const steps = deriveTimeline([worker({ parentCallId: 'gone' })], { active: true });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.verb).toBe('Worker');
  });
});

describe('persisted history — the spawn tool call alone', () => {
  it('renders a settled worker step with a link, from the tool result', () => {
    const steps = deriveTimeline(
      [
        tool('spawn_background_agent', 'call-1', {
          args: { taskName: 'research-react', objective: 'read the docs' },
          result: { ok: true, taskId: 'chat-w1', taskName: 'research-react', status: 'running' },
        }),
      ],
      { active: false },
    );
    expect(steps[0]).toMatchObject({
      kind: 'subagent',
      verb: 'Delegated',
      target: 'research-react',
      status: 'done',
      workerChatId: 'chat-w1',
    });
  });

  it('shows the digest a later check call reported as the worker step summary', () => {
    const steps = deriveTimeline(
      [
        tool('spawn_background_agent', 'call-1', {
          args: { taskName: 'research-react' },
          result: { ok: true, taskId: 'chat-w1', taskName: 'research-react' },
        }),
        tool('check_background_agents', 'call-2', {
          result: {
            count: 1,
            digests: [{ taskId: 'chat-w1', taskName: 'research-react', status: 'completed', summary: 'React 19 notes written' }],
          },
        }),
      ],
      { active: false },
    );
    expect(steps[0]?.children?.[0]?.target).toBe('React 19 notes written');
  });

  it('reads digests out of a single-worker check too, and out of a JSON string result', () => {
    const map = backgroundDigests([
      tool('check_background_agent', 'c', {
        result: JSON.stringify({ taskId: 'w9', taskName: 'solo', status: 'completed', summary: 'done it' }),
      }),
    ]);
    expect(map.get('w9')).toBe('done it');
    expect(map.get('solo')).toBe('done it');
  });

  it('falls back to the args taskName when the spawn failed and returned no id', () => {
    const ref = spawnWorkerRef(
      tool('spawn_background_agent', 'c', {
        args: { taskName: 'doomed' },
        result: { ok: false, error: 'worker limit reached' },
      }) as Extract<StreamBlock, { type: 'tool_call' }>,
    );
    expect(ref).toEqual({ taskName: 'doomed' });
  });
});

describe('SDK delegation tools', () => {
  it('treats Task and Agent as sub-agents regardless of case', () => {
    for (const name of ['Task', 'task', 'Agent', 'agent']) {
      const steps = deriveTimeline([tool(name, `c-${name}`)], { active: false });
      expect(steps[0]?.kind, name).toBe('subagent');
    }
  });

  it('still classifies ordinary tools by their shape', () => {
    expect(deriveTimeline([tool('Read', 'r')], { active: false })[0]?.kind).toBe('read');
    expect(deriveTimeline([tool('Bash', 'b')], { active: false })[0]?.kind).toBe('run');
    expect(deriveTimeline([tool('list_models', 'm')], { active: false })[0]?.kind).toBe('tool');
  });
});
