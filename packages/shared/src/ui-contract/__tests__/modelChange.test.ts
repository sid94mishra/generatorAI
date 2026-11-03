import { describe, expect, it } from 'vitest';
import { settleModelChange, type CatalogModel } from '../modelChange.js';

const catalog: CatalogModel[] = [
  { id: 'claude-opus-5-5', provider: 'claude-agent', reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-5-5', provider: 'copilot' },
  { id: 'gpt-5.6-terra', provider: 'codex', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium' },
  { id: 'gpt-5.6-luna', provider: 'codex', reasoningEfforts: ['minimal'], defaultReasoningEffort: 'minimal' },
  { id: 'auto', provider: 'copilot' },
];

describe('settleModelChange', () => {
  it('moves the chat to the provider that offers the model when only the model was sent', () => {
    expect(settleModelChange({ model: 'gpt-5.6-terra', currentProvider: 'claude-agent', catalog })).toEqual({ provider: 'codex' });
  });

  it('keeps the chat on its provider when that one offers the model too', () => {
    expect(settleModelChange({ model: 'claude-opus-5-5', currentProvider: 'copilot', catalog })).toEqual({ provider: 'copilot' });
  });

  it('takes the provider the request named', () => {
    expect(settleModelChange({ model: 'claude-opus-5-5', requestedProvider: 'copilot', currentProvider: 'claude-agent', catalog }).provider).toBe('copilot');
  });

  it('never reads a "let the provider pick" model as a provider', () => {
    expect(settleModelChange({ model: 'auto', currentProvider: 'claude-agent', catalog }).provider).toBe('claude-agent');
  });

  it('brings an effort the model does not take down to the highest it does, else to its default', () => {
    expect(settleModelChange({ model: 'gpt-5.6-terra', currentProvider: 'claude-agent', effort: 'max', catalog }).effort).toBe('xhigh');
    expect(settleModelChange({ model: 'gpt-5.6-terra', currentProvider: 'claude-agent', effort: 'high', catalog }).effort).toBe('high');
    expect(settleModelChange({ model: 'gpt-5.6-luna', currentProvider: 'codex', effort: 'high', catalog }).effort).toBe('minimal');
    // Levels unknown (not in the catalog): left as it is.
    expect(settleModelChange({ model: 'claude-opus-5-5', currentProvider: 'copilot', effort: 'max', catalog }).effort).toBe('max');
  });
});
