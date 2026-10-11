import { describe, expect, it } from 'vitest';
import { reviewOutputMarkdown } from './reviewOutput.js';

describe('reviewOutputMarkdown (U-19)', () => {
  it('shows a single text field of a JSON contract as its Markdown', () => {
    expect(reviewOutputMarkdown('{"body":"## Summary\\n\\nDone."}')).toBe('## Summary\n\nDone.');
  });
  it('shows a mixed contract field by field: short values first, long text as Markdown', () => {
    const out = reviewOutputMarkdown(JSON.stringify({ pr_description: '## Summary\n\nFixed.', verdict: 'approve', concerns: [] }));
    expect(out).toBe('**Verdict:** approve\n\n**Concerns:** none\n\n#### Pr description\n\n## Summary\n\nFixed.');
  });
  it('lists string arrays and fences nested values', () => {
    expect(reviewOutputMarkdown('{"files":["a.ts","b.ts"]}')).toBe('**Files:**\n\n- a.ts\n- b.ts');
    expect(reviewOutputMarkdown('{"meta":{"n":1}}')).toBe('**Meta:**\n\n```json\n{\n  "n": 1\n}\n```');
  });
  it('keeps plain text and fences broken JSON', () => {
    expect(reviewOutputMarkdown('All good.')).toBe('All good.');
    expect(reviewOutputMarkdown('{"body":"cut…')).toBe('```json\n{"body":"cut…\n```');
  });
});

describe('readableAnswer (U-21)', () => {
  it('renders a JSON answer and leaves prose alone', async () => {
    const { readableAnswer } = await import('./reviewOutput.js');
    expect(readableAnswer('{"verdict":"approve","summary":"Looks good"}')).toBe('**Verdict:** approve\n\n**Summary:** Looks good');
    expect(readableAnswer('Done. {not json}')).toBe('Done. {not json}');
  });
});
