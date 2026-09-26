// G-01 — the pure helpers behind the attention feed: step labels (both path
// separators), gate descriptions, the per-scope redaction rule, and the
// streaming registry's start times and change notifications.
import { describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@generatorai/shared';
import {
  describeInteraction,
  describeToolStep,
  redactAttentionEventPayload,
  redactAttentionItem,
} from '../AttentionService.js';
import { StreamingChatRegistry } from '../StreamingChatRegistry.js';

describe('describeToolStep', () => {
  it('names the command, the file (either separator) or the target', () => {
    expect(describeToolStep('Bash', { command: 'pnpm build\npnpm test' })).toBe('Running pnpm build');
    expect(describeToolStep('Edit', { file_path: '/repo/src/App.tsx' })).toBe('Edit App.tsx');
    expect(describeToolStep('Edit', { path: 'C:\\repo\\src\\App.tsx' })).toBe('Edit App.tsx');
    expect(describeToolStep('Grep', { pattern: 'TODO' })).toBe('Grep TODO');
    expect(describeToolStep('think', undefined)).toBe('think');
    expect(describeToolStep('', {})).toBeUndefined();
  });
});

describe('describeInteraction', () => {
  it('summarises each gate kind with its actions', () => {
    expect(describeInteraction({ kind: 'tool_permission', payload: { toolName: 'Bash', inputSummary: 'git push' } })).toEqual({
      summary: 'Allow Bash?',
      detail: 'git push',
      actions: ['allow_once', 'deny', 'open'],
    });
    expect(
      describeInteraction({ kind: 'question', payload: { questions: [{ question: 'Which DB?' }, { question: 'Why?' }] } }),
    ).toEqual({ summary: 'Which DB?', detail: '2 questions', actions: ['answer', 'open'] });
    expect(describeInteraction({ kind: 'plan_review', payload: { title: 'Migrate auth' } })).toEqual({
      summary: 'Review plan “Migrate auth”',
      actions: ['approve', 'reject', 'open'],
    });
  });
});

describe('redactAttentionItem', () => {
  const chat: AttentionItem = {
    key: 'chat:c1',
    entity: 'chat',
    entityId: 'c1',
    title: 'Fix build',
    href: '/chats/c1',
    state: 'running',
    since: '2026-09-26T10:00:00.000Z',
    progress: { label: 'Running rm -rf dist' },
    stoppable: true,
  };
  const run: AttentionItem = {
    ...chat,
    key: 'workflow_run:r1:s1',
    entity: 'workflow_run',
    entityId: 'r1',
    state: 'needs_you',
    progress: { label: 'Apply', step: 2, of: 5 },
    ask: { kind: 'stage_approval', id: 's1', summary: 'Approve “Apply”', detail: 'secret', actions: ['approve'] },
  };

  it('keeps everything for unauthenticated loopback and for a principal that may read the entity', () => {
    expect(redactAttentionItem(chat, null)).toBe(chat);
    expect(redactAttentionItem(chat, ['read:chats'])).toBe(chat);
    expect(redactAttentionItem(run, ['read:workflows'])).toBe(run);
  });

  it('strips detail and label otherwise, keeping step counts', () => {
    expect(redactAttentionItem(chat, ['read:activity'])).not.toHaveProperty('progress');
    const r = redactAttentionItem(run, ['read:activity', 'read:chats']);
    expect(r.ask).toEqual({ kind: 'stage_approval', id: 's1', summary: 'Approve “Apply”', actions: ['approve'] });
    expect(r.progress).toEqual({ step: 2, of: 5 });
    expect(run.ask?.detail).toBe('secret'); // the original is never mutated
  });

  it('P2-R15: replaces the free-text summary of a question or plan review, keeps a tool name', () => {
    const question: AttentionItem = {
      ...chat,
      key: 'chat:c1:q1',
      state: 'needs_you',
      ask: { kind: 'question', id: 'q1', summary: 'Delete /Users/me/.ssh/id_rsa?', actions: ['answer', 'open'] },
    };
    expect(redactAttentionItem(question, ['read:activity']).ask?.summary).toBe('Your agent has a question');
    expect(redactAttentionItem(question, ['read:chats'])).toBe(question);
    const plan: AttentionItem = {
      ...question,
      ask: { kind: 'plan_review', id: 'p1', summary: 'Review plan “Rotate prod keys”', actions: ['approve'] },
    };
    expect(redactAttentionItem(plan, ['read:activity']).ask?.summary).toBe('Review the plan');
    const permission: AttentionItem = {
      ...question,
      ask: { kind: 'tool_permission', id: 't1', summary: 'Allow Bash?', detail: 'rm -rf /', actions: ['deny'] },
    };
    expect(redactAttentionItem(permission, ['read:activity']).ask).toEqual({
      kind: 'tool_permission',
      id: 't1',
      summary: 'Allow Bash?',
      actions: ['deny'],
    });
  });

  it('redacts only attention.upsert payloads', () => {
    const payload = { seq: 3, item: run };
    expect(redactAttentionEventPayload('attention.remove', { seq: 3, key: 'x' }, [])).toEqual({ seq: 3, key: 'x' });
    const out = redactAttentionEventPayload('attention.upsert', payload, ['read:activity']) as typeof payload;
    expect(out.seq).toBe(3);
    expect(out.item.ask).not.toHaveProperty('detail');
  });
});

describe('StreamingChatRegistry', () => {
  it('records start times, restarts them per turn, and notifies on change', () => {
    const registry = new StreamingChatRegistry();
    const listener = vi.fn();
    const off = registry.onChange(listener);
    registry.set('c1', () => {});
    const first = registry.since().get('c1');
    expect(first).toBeInstanceOf(Date);
    expect(listener).toHaveBeenLastCalledWith('c1', true);
    expect(registry.delete('c1')).toBe(true);
    expect(registry.delete('c1')).toBe(false);
    expect(registry.since().has('c1')).toBe(false);
    expect(listener).toHaveBeenLastCalledWith('c1', false);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    registry.set('c2', () => {});
    expect(listener).toHaveBeenCalledTimes(2);
    expect([...registry.keys()]).toEqual(['c2']);
  });

  it('a throwing listener never breaks the turn lifecycle', () => {
    const registry = new StreamingChatRegistry();
    registry.onChange(() => {
      throw new Error('boom');
    });
    expect(() => registry.set('c1', () => {})).not.toThrow();
    expect(registry.has('c1')).toBe(true);
  });
});
