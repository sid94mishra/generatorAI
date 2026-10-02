import { expect, it } from 'vitest';
import { chatModelSummary } from '../src/services/chatModelSummary.js';
it('uses provider-scoped metadata without a ready-provider filter', () => {
  const models = [{ id: 'same', name: 'First', provider: 'copilot' }, { id: 'same', name: 'Second', provider: 'claude-agent' }];
  expect(chatModelSummary({ model: 'same', harnessConfig: { harnessType: 'claude-agent' } }, models)).toEqual({ id: 'same', label: 'Second', provider: 'claude-agent' });
});
it('falls back to real model id and omits absent models', () => {
  expect(chatModelSummary({ model: 'unknown' })).toEqual({ id: 'unknown', label: 'unknown' });
  expect(chatModelSummary({ harnessConfig: { model: 'configured' } })).toEqual({ id: 'configured', label: 'configured' });
  expect(chatModelSummary({})).toBeUndefined();
});
