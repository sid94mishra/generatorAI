import { describe, expect, it } from 'vitest';
import { maskCode, needsWholeDocument, splitMarkdownBlocks } from './markdownBlocks.js';

const REPORT = [
  '## Summary',
  '',
  'The slug keeps letters and digits.',
  '',
  '```ts',
  "export const slug = (s: string) => s.replace(/[^a-z0-9]+/g, '-');",
  '```',
  '',
  'Inline `[^x]` is code too.',
  '',
  '- one',
  '- two',
].join('\n');

describe('markdown blocks (D-88)', () => {
  it('splits an answer whose code contains a regex character class into its blocks', () => {
    const blocks = splitMarkdownBlocks(REPORT);
    expect(blocks.length).toBeGreaterThan(3);
    // Slices of the original text, in order, covering all of it.
    expect(blocks.join('')).toBe(REPORT);
    expect(blocks.some((b) => b.includes('[^a-z0-9]'))).toBe(true);
  });

  it('keeps a document with a real footnote or a link reference definition whole', () => {
    expect(needsWholeDocument('See this[^note].\n\n[^note]: the note')).toBe(true);
    expect(needsWholeDocument('A [link][ref].\n\n[ref]: https://example.com')).toBe(true);
    expect(splitMarkdownBlocks('Text[^1].\n\nMore.\n\n[^1]: n')).toHaveLength(1);
    expect(needsWholeDocument(REPORT)).toBe(false);
  });

  it('masks fenced and inline code without changing the length', () => {
    const masked = maskCode(REPORT);
    expect(masked).toHaveLength(REPORT.length);
    expect(masked).not.toContain('[^');
    expect(masked).toContain('## Summary');
  });

  it('treats an unterminated fence (still streaming) as code to the end', () => {
    const streaming = 'Intro\n\n```ts\nconst r = /[^a-z]/;\n';
    expect(needsWholeDocument(streaming)).toBe(false);
    expect(splitMarkdownBlocks(streaming).join('')).toBe(streaming);
  });
});
