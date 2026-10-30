import { describe, expect, it } from 'vitest';
import { pickReviewModel, turnChangedFiles, type HarnessCatalogModel } from '../models/pickerCatalog.js';

const m = (id: string, provider: string) => ({ id, name: id, provider }) as unknown as HarnessCatalogModel;

describe('second review after a Codex turn (evaluation)', () => {
  it('reviews on the first ready Claude Sonnet, else any Claude model, else nothing', () => {
    expect(pickReviewModel([m('gpt-5.6-terra', 'codex'), m('claude-opus-5-5', 'claude-agent'), m('claude-sonnet-5-5', 'claude-agent')])?.id).toBe('claude-sonnet-5-5');
    expect(pickReviewModel([m('claude-opus-5-5', 'claude-agent')])?.id).toBe('claude-opus-5-5');
    expect(pickReviewModel([m('gpt-5.6-terra', 'codex')])).toBeUndefined();
    expect(pickReviewModel(undefined)).toBeUndefined();
  });

  it('a turn changed files when a call recorded a file operation or a writing tool completed', () => {
    expect(turnChangedFiles([{ tool: 'shell' }, { tool: 'apply_patch', success: true }])).toBe(true);
    expect(turnChangedFiles([{ tool: 'Edit' }])).toBe(true);
    expect(turnChangedFiles([{ tool: 'shell', fileOp: { kind: 'edit' } }])).toBe(true);
    expect(turnChangedFiles([{ tool: 'apply_patch', success: false }])).toBe(false);
    expect(turnChangedFiles([{ tool: 'shell' }, { tool: 'Read' }])).toBe(false);
    expect(turnChangedFiles(undefined)).toBe(false);
  });
});
