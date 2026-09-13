// ────────────────────────────────────────────────────────────────
// liveCounters — the strip above the composer.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  computeLiveCounters,
  countRunningBackgroundTasks,
  formatLiveCounters,
} from '../liveCounters.js';
import type { StreamBlock } from '@/stores/streamStore.js';

let nextId = 1;

function tool(name: string, status: 'running' | 'complete', extra: Record<string, unknown> = {}): StreamBlock {
  return {
    type: 'tool_call',
    blockId: nextId++,
    callId: `c${nextId}`,
    tool: name,
    args: {},
    status,
    ...extra,
  } as StreamBlock;
}

function worker(status: string): StreamBlock {
  return {
    type: 'background_task',
    blockId: nextId++,
    taskId: `w${nextId}`,
    taskName: `task-${nextId}`,
    status,
    toolCalls: 0,
    startedAt: 0,
  } as StreamBlock;
}

describe('computeLiveCounters', () => {
  it('is idle with no blocks', () => {
    expect(computeLiveCounters(undefined)).toMatchObject({ tools: 0, subagents: 0, pending: 0, idle: true });
    expect(computeLiveCounters([])).toMatchObject({ idle: true });
  });

  it('counts running tool calls and ignores settled ones', () => {
    const counters = computeLiveCounters([
      tool('Read', 'running'),
      tool('Bash', 'running'),
      tool('Write', 'complete'),
    ]);
    expect(counters).toMatchObject({ tools: 2, subagents: 0, pending: 0, idle: false });
  });

  it('counts a running Task/Agent call as a sub-agent, not a tool', () => {
    const counters = computeLiveCounters([tool('Task', 'running'), tool('Agent', 'running'), tool('Read', 'running')]);
    expect(counters).toMatchObject({ tools: 1, subagents: 2 });
  });

  it('separates running workers from spawned-but-not-started ones', () => {
    const counters = computeLiveCounters([
      worker('running'),
      worker('running'),
      worker('spawned'),
      worker('completed'),
      worker('failed'),
    ]);
    expect(counters).toMatchObject({ tools: 0, subagents: 2, pending: 1, idle: false });
  });

  it('counts a sub-agent’s nested tool calls too', () => {
    const counters = computeLiveCounters([
      tool('Task', 'running', { callId: 'agent-1' }),
      tool('Read', 'running', { parentCallId: 'agent-1' }),
      tool('Grep', 'running', { parentCallId: 'agent-1' }),
    ]);
    expect(counters).toMatchObject({ tools: 2, subagents: 1 });
  });
});

describe('formatLiveCounters', () => {
  it('renders the three parts joined by a middle dot', () => {
    expect(formatLiveCounters({ tools: 2, subagents: 3, pending: 1, idle: false }))
      .toBe('2 tools running · 3 sub-agents running · 1 pending');
  });

  it('singularises and omits empty parts', () => {
    expect(formatLiveCounters({ tools: 1, subagents: 0, pending: 0, idle: false })).toBe('1 tool running');
    expect(formatLiveCounters({ tools: 0, subagents: 1, pending: 0, idle: false })).toBe('1 sub-agent running');
    expect(formatLiveCounters({ tools: 0, subagents: 0, pending: 2, idle: false })).toBe('2 pending');
  });

  it('is null when there is nothing to say, so the strip renders nothing', () => {
    expect(formatLiveCounters({ tools: 0, subagents: 0, pending: 0, idle: true })).toBeNull();
  });
});

describe('countRunningBackgroundTasks', () => {
  it('counts running and pending workers only', () => {
    expect(countRunningBackgroundTasks([
      worker('running'), worker('spawned'), worker('completed'), worker('failed'), tool('Read', 'running'),
    ])).toBe(2);
    expect(countRunningBackgroundTasks(undefined)).toBe(0);
  });
});
