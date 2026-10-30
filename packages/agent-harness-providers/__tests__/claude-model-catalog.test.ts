import { describe, expect, it } from 'vitest';
import { claudeCatalog, mapClaudeModelInfo } from '../src/providers/claude-agent/ClaudeAgentProvider.js';

type Info = Parameters<typeof mapClaudeModelInfo>[0];

// Rows as the Claude Code CLI 2.1.291 `supportedModels()` returned them for a Max account (2026-10-10).
const DEFAULT: Info = {
  value: 'default',
  resolvedModel: 'claude-opus-5-5',
  displayName: 'Default (recommended)',
  description: 'Opus 5.5 · Best for everyday, complex tasks',
  supportsEffort: true,
  supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  supportsAdaptiveThinking: true,
  supportsFastMode: true,
  supportsAutoMode: true,
};
const OPUS: Info = { ...DEFAULT, value: 'opus', displayName: 'Opus 5.5', description: 'For complex work and everyday tasks' };
const HAIKU: Info = { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest for quick answers' };

const rows = (infos: Info[]) => infos.map((info) => ({ info, model: mapClaudeModelInfo(info, 'medium') }));

describe('mapClaudeModelInfo (D-131: only what the CLI returns)', () => {
  it('copies the name, description, resolved id, effort levels and capability flags', () => {
    expect(mapClaudeModelInfo(OPUS, 'medium')).toEqual({
      id: 'opus',
      name: 'Opus 5.5',
      provider: 'claude-agent',
      description: 'For complex work and everyday tasks',
      resolvedModel: 'claude-opus-5-5',
      features: ['Adaptive thinking', 'Fast mode', 'Auto mode'],
      supportsReasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: 'medium',
    });
  });

  it('invents nothing the CLI did not send: no tier, no context window, no effort for a model without one', () => {
    const haiku = mapClaudeModelInfo(HAIKU, 'medium');
    expect(haiku).toEqual({
      id: 'haiku',
      name: 'Haiku 4.5',
      provider: 'claude-agent',
      description: 'Fastest for quick answers',
      resolvedModel: 'claude-haiku-4-5-20251001',
    });
    expect(haiku.category).toBeUndefined();
    expect(haiku.promptTokenLimit).toBeUndefined();
  });
});

describe('claudeCatalog', () => {
  it('folds the default alias into the row it resolves to', () => {
    const out = claudeCatalog(rows([DEFAULT, OPUS, HAIKU])).map((r) => r.model);
    expect(out.map((m) => m.id)).toEqual(['opus', 'haiku']);
    expect(out.find((m) => m.id === 'opus')?.isDefault).toBe(true);
    expect(out.find((m) => m.id === 'haiku')?.isDefault).toBeUndefined();
  });

  it('keeps the alias row, flagged, when nothing else resolves to the same model', () => {
    const out = claudeCatalog(rows([DEFAULT, HAIKU])).map((r) => r.model);
    expect(out.map((m) => [m.id, m.isDefault ?? false])).toEqual([['default', true], ['haiku', false]]);
  });
});
