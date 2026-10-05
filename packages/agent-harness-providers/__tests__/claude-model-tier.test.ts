import { describe, expect, it } from 'vitest';
import { mapClaudeModelInfo } from '../src/providers/claude-agent/ClaudeAgentProvider.js';

const info = (value: string, description: string, displayName = value) =>
  ({ value, displayName, description }) as unknown as Parameters<typeof mapClaudeModelInfo>[0];

describe('mapClaudeModelInfo tiers', () => {
  it('tiers the default alias as the model it resolves to', () => {
    expect(mapClaudeModelInfo(info('default', 'Opus 5.5 · Best for everyday, complex tasks', 'Default (recommended)')).category).toBe('powerful');
    expect(mapClaudeModelInfo(info('default', 'Sonnet 5.5 · Balanced', 'Default (recommended)')).category).toBe('versatile');
  });
  it('keeps tiering named aliases by id', () => {
    expect(mapClaudeModelInfo(info('sonnet', 'Most efficient for simpler tasks')).category).toBe('versatile');
    expect(mapClaudeModelInfo(info('haiku', 'Fastest for quick answers')).category).toBe('lightweight');
    expect(mapClaudeModelInfo(info('opus', 'For complex work')).category).toBe('powerful');
  });
});
