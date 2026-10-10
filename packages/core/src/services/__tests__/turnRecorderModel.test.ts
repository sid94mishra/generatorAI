import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@generatorai/shared';
import { TurnRecorder } from '../session/TurnRecorder.js';

const ev = (kind: string, data: Record<string, unknown>) => ({ kind, data }) as unknown as AgentEvent;

describe('TurnRecorder — the model a turn ran on', () => {
  it('keeps the model and provider of the turn’s own usage report, not a sub-agent’s', () => {
    const r = new TurnRecorder();
    r.begin({ turnId: 't1' });
    r.observe(ev('harness.usage', { model: 'claude-haiku-4-5', provider: 'claude-agent', agentId: 'sub-1' }));
    r.observe(ev('harness.usage', { model: 'claude-opus-5-5', provider: 'claude-agent' }));
    r.observe(ev('harness.message_complete', { content: 'Done.' }));
    const turn = r.take();
    expect(turn?.metadata.model).toBe('claude-opus-5-5');
    expect(turn?.metadata.provider).toBe('claude-agent');
  });

  it('records no model when the provider named none, and resets between turns', () => {
    const r = new TurnRecorder();
    r.begin({ turnId: 't1' });
    r.observe(ev('harness.usage', { model: 'gpt-6-luna', provider: 'codex' }));
    r.observe(ev('harness.message_complete', { content: 'One.' }));
    r.take();
    r.begin({ turnId: 't2' });
    r.observe(ev('harness.usage', { model: 'unknown', provider: 'copilot' }));
    r.observe(ev('harness.message_complete', { content: 'Two.' }));
    const turn = r.take();
    expect(turn?.metadata.model).toBeUndefined();
    expect(turn?.metadata.provider).toBe('copilot');
  });
});
