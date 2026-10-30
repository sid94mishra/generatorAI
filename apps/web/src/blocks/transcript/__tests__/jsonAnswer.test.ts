import { describe, expect, it } from 'vitest';
import { jsonAnswerMarkdown } from '../AssistantText/jsonAnswer.js';

describe('jsonAnswerMarkdown', () => {
  it('renders a finished JSON answer as one pretty-printed block', () => {
    expect(jsonAnswerMarkdown('{"verdict":"approve","concerns":[]}')).toBe(
      '```json\n{\n  "verdict": "approve",\n  "concerns": []\n}\n```',
    );
  });

  it('keeps a streaming answer as it is, inside the block', () => {
    expect(jsonAnswerMarkdown('{"verdict":"appr', true)).toBe('```json\n{"verdict":"appr\n```');
  });

  it('uses a longer fence when the JSON holds a code fence', () => {
    const out = jsonAnswerMarkdown(JSON.stringify({ body: 'Run:\n```sh\npnpm test\n```' }));
    expect(out.startsWith('````json\n')).toBe(true);
    expect(out.endsWith('\n````')).toBe(true);
  });

  it('leaves prose alone, including prose that opens with a link', () => {
    expect(jsonAnswerMarkdown('All good.')).toBe('All good.');
    expect(jsonAnswerMarkdown('[PR #12](https://x) is open')).toBe('[PR #12](https://x) is open');
    expect(jsonAnswerMarkdown('"quoted"')).toBe('"quoted"');
  });

  it('shows brace-led text that does not parse as a block too', () => {
    expect(jsonAnswerMarkdown('{"body":"cut…')).toBe('```json\n{"body":"cut…\n```');
  });
});
