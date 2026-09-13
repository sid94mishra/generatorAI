// ────────────────────────────────────────────────────────────────
// Sub-agent visibility across providers.
//
// All three SDKs can delegate, and all three used to report it in a way the
// transcript could not render: Claude opened a sub-agent step that nothing
// ever settled, Copilot's nested tool calls arrived as top-level ones, and
// Codex's collab items were dropped on the floor. These tests pin the
// provider-neutral events each mapper now produces.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { mapClaudeAgentMessageToAgentEvents } from '../src/providers/claude-agent/event-mapper.js';
import {
  mapSdkEventToAgentEvent,
  _resetCopilotSubagentNesting,
} from '../src/providers/copilot/event-mapper.js';

type AnyEvent = { kind: string; data: Record<string, unknown> };

const claude = (message: unknown): AnyEvent[] =>
  mapClaudeAgentMessageToAgentEvents(message as never) as unknown as AnyEvent[];

const copilot = (type: string, data?: unknown, extra: Record<string, unknown> = {}): AnyEvent =>
  mapSdkEventToAgentEvent({ type, data, ...extra } as never) as unknown as AnyEvent;

const infoTypes = (events: AnyEvent[]): unknown[] =>
  events.filter((e) => e.kind === 'harness.session_info').map((e) => e.data['infoType']);

describe('claude-agent — Task/Agent tool calls are sub-agents', () => {
  it('announces subagent_started with the tool call id when a Task opens', () => {
    const events = claude({
      type: 'assistant',
      uuid: 'msg-1',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Task', input: { subagent_type: 'Explore', description: 'find the router' } },
        ],
      },
    });
    expect(events[0]?.kind).toBe('harness.tool_start');
    const started = events.find((e) => e.data['infoType'] === 'subagent_started');
    expect(started).toBeDefined();
    expect(started?.data['toolCallId']).toBe('toolu_1');
    expect(String(started?.data['message'])).toContain('Explore');
  });

  it('settles the step on tool_complete, while the turn is still live', () => {
    claude({
      type: 'assistant',
      uuid: 'm',
      message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Agent', input: {} }] },
    });
    const events = claude({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'found it', is_error: false }],
      },
    });
    const done = events.find((e) => e.data['infoType'] === 'subagent_completed');
    expect(done?.data['toolCallId']).toBe('toolu_2');
  });

  it('reports a failed sub-agent as subagent_failed', () => {
    claude({
      type: 'assistant',
      uuid: 'm',
      message: { content: [{ type: 'tool_use', id: 'toolu_3', name: 'Task', input: {} }] },
    });
    const events = claude({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'toolu_3', content: 'boom', is_error: true }],
      },
    });
    expect(infoTypes(events)).toContain('subagent_failed');
  });

  it('leaves an ordinary tool alone', () => {
    claude({
      type: 'assistant',
      uuid: 'm',
      message: { content: [{ type: 'tool_use', id: 'toolu_4', name: 'Read', input: { file_path: '/a' } }] },
    });
    const events = claude({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_4', content: 'ok' }] },
    });
    expect(infoTypes(events)).not.toContain('subagent_completed');
  });

  it('forwards task_progress and task_notification summaries as subagent_progress', () => {
    expect(infoTypes(claude({ type: 'system', subtype: 'task_progress', summary: 'read 12 files' })))
      .toContain('subagent_progress');
    expect(infoTypes(claude({ type: 'system', subtype: 'task_notification', status: 'running', summary: 'half way', task_id: 't1' })))
      .toContain('subagent_progress');
  });

  it('emits nothing extra when a progress message carries no text', () => {
    expect(infoTypes(claude({ type: 'system', subtype: 'task_progress' })))
      .not.toContain('subagent_progress');
  });
});

describe('copilot — sub-agent nesting', () => {
  beforeEach(() => _resetCopilotSubagentNesting());

  it('promotes the spawning toolCallId onto the sub-agent’s own tool events', () => {
    copilot('subagent.started', { agentName: 'explorer', agentDisplayName: 'Explorer', toolCallId: 'call-parent' }, { agentId: 'sub-1' });

    const start = copilot('tool.execution_start', { toolName: 'read', toolCallId: 'call-child', arguments: {} }, { agentId: 'sub-1' });
    expect(start.kind).toBe('harness.tool_start');
    expect(start.data['parentToolCallId']).toBe('call-parent');

    const done = copilot('tool.execution_complete', { toolName: 'read', toolCallId: 'call-child', success: true }, { agentId: 'sub-1' });
    expect(done.data['parentToolCallId']).toBe('call-parent');
  });

  it('leaves the MAIN agent’s tool calls un-nested', () => {
    copilot('subagent.started', { agentName: 'explorer', toolCallId: 'call-parent' }, { agentId: 'sub-1' });
    const start = copilot('tool.execution_start', { toolName: 'read', toolCallId: 'c1', arguments: {} });
    expect(start.data['parentToolCallId']).toBeUndefined();
  });

  it('an explicit parentToolCallId from the SDK still wins', () => {
    copilot('subagent.started', { toolCallId: 'call-parent' }, { agentId: 'sub-1' });
    const start = copilot(
      'tool.execution_start',
      { toolName: 'read', toolCallId: 'c1', parentToolCallId: 'explicit' },
      { agentId: 'sub-1' },
    );
    expect(start.data['parentToolCallId']).toBe('explicit');
  });

  it('forgets the binding once the sub-agent settles', () => {
    copilot('subagent.started', { toolCallId: 'call-parent' }, { agentId: 'sub-1' });
    copilot('subagent.completed', { agentName: 'explorer', toolCallId: 'call-parent' }, { agentId: 'sub-1' });
    const late = copilot('tool.execution_start', { toolName: 'read', toolCallId: 'c9' }, { agentId: 'sub-1' });
    expect(late.data['parentToolCallId']).toBeUndefined();
  });

  it('still emits started/completed/failed so the step spins and settles', () => {
    expect(copilot('subagent.started', { agentName: 'x', toolCallId: 't' }).data['infoType']).toBe('subagent_started');
    expect(copilot('subagent.completed', { agentName: 'x', toolCallId: 't' }).data['infoType']).toBe('subagent_completed');
    expect(copilot('subagent.failed', { agentName: 'x', toolCallId: 't', error: 'nope' }).data['infoType']).toBe('subagent_failed');
  });
});
