import { describe, expect, it } from 'vitest';
import { reviewOutputMarkdown } from './reviewOutput.js';

describe('reviewOutputMarkdown (U-19)', () => {
  it('shows a single text field of a JSON contract as its Markdown', () => {
    expect(reviewOutputMarkdown('{"body":"## Summary\\n\\nDone."}')).toBe('## Summary\n\nDone.');
  });
  it('heads several text fields by name', () => {
    expect(reviewOutputMarkdown('{"title":"T","body":"B"}')).toBe('#### title\n\nT\n\n#### body\n\nB');
  });
  it('shows other JSON as a code block', () => {
    expect(reviewOutputMarkdown('{"count":3}')).toBe('```json\n{\n  "count": 3\n}\n```');
  });
  it('keeps plain text and fences broken JSON', () => {
    expect(reviewOutputMarkdown('All good.')).toBe('All good.');
    expect(reviewOutputMarkdown('{"body":"cut…')).toBe('```json\n{"body":"cut…\n```');
  });
});
