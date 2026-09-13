// ────────────────────────────────────────────────────────────────
// "Copy transcript" renders the conversation, not the machinery.
//
// The formatter is shared by web and mobile precisely so the copied document
// cannot drift between them, which makes its exact output the contract —
// including the parts that are deliberately ABSENT (thinking text, tool and
// system rows as sections of their own).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { formatTranscriptMarkdown, type TranscriptMessage } from '../api/transcript.js';

const T1 = '2026-01-02T03:04:05.000Z';
const T2 = '2026-01-02T03:05:06.000Z';

describe('formatTranscriptMarkdown', () => {
  it('renders the chat name and the user/assistant exchange with ISO stamps', () => {
    const md = formatTranscriptMarkdown('Ship the parser', [
      { role: 'user', content: 'fix the lexer', timestamp: T1 },
      { role: 'assistant', content: 'Fixed it.', timestamp: T2 },
    ]);

    expect(md).toBe(
      [
        '# Ship the parser',
        '',
        `## You  <sub>${T1}</sub>`,
        '',
        'fix the lexer',
        '',
        `## Assistant  <sub>${T2}</sub>`,
        '',
        'Fixed it.',
        '',
      ].join('\n'),
    );
  });

  it('omits system and tool rows, and never prints thinking text', () => {
    const messages: TranscriptMessage[] = [
      { role: 'system', content: 'session resumed', timestamp: T1 },
      { role: 'tool', content: 'raw tool output', timestamp: T1 },
      {
        role: 'assistant',
        content: 'Done.',
        timestamp: T2,
        // `thinkingText` is not part of TranscriptMessage; a metadata bag that
        // carries it must still not leak it into the document.
        metadata: { textSegments: [{ content: 'Done.' }] } as TranscriptMessage['metadata'],
      },
    ];
    const md = formatTranscriptMarkdown('Chat', messages);

    expect(md).not.toContain('session resumed');
    expect(md).not.toContain('raw tool output');
    expect(md).toContain('Done.');
  });

  it('renders tool calls as a compact Actions list with file stats and failures', () => {
    const md = formatTranscriptMarkdown('Chat', [
      {
        role: 'assistant',
        content: 'All set.',
        timestamp: T2,
        metadata: {
          toolCalls: [
            { tool: 'Edit', args: { file_path: 'src/a.ts' }, fileOp: { additions: 3, deletions: 1 } },
            { tool: 'Bash', args: { command: 'pnpm test' }, success: false },
            { tool: 'Think', args: undefined },
          ],
        },
      },
    ]);

    expect(md).toContain('<details><summary>Actions (3)</summary>');
    expect(md).toContain('- `Edit` src/a.ts (+3 −1)');
    expect(md).toContain('- `Bash` pnpm test — failed');
    expect(md).toContain('- `Think`');
    expect(md).toContain('</details>');
  });

  it('prints every text segment of an agentic turn, not just the closing one', () => {
    const md = formatTranscriptMarkdown('Chat', [
      {
        role: 'assistant',
        content: 'wave 2 done',
        timestamp: T2,
        metadata: {
          textSegments: [{ content: 'planning…' }, { content: 'wave 1 done' }, { content: 'wave 2 done' }],
        },
      },
    ]);

    expect(md).toContain('planning…');
    expect(md).toContain('wave 1 done');
    expect(md).toContain('wave 2 done');
  });

  it('notes a turn the user stopped part-way', () => {
    const md = formatTranscriptMarkdown('Chat', [
      { role: 'assistant', content: 'half an ans', timestamp: T2, metadata: { partial: true } },
    ]);
    expect(md).toContain('*Stopped before the response finished.*');
  });

  it('lists user attachments by name', () => {
    const md = formatTranscriptMarkdown('Chat', [
      { role: 'user', content: 'look at these', timestamp: T1, attachments: [{ name: 'a.png' }, { name: 'b.log' }] },
    ]);
    expect(md).toContain('*Attachments:* `a.png`, `b.log`');
  });

  it('falls back to createdAt, and drops the stamp entirely when there is no usable time', () => {
    expect(formatTranscriptMarkdown('Chat', [{ role: 'user', content: 'hi', createdAt: T1 }])).toContain(
      `## You  <sub>${T1}</sub>`,
    );
    // An unparseable time must not produce `Invalid Date` — or throw.
    const md = formatTranscriptMarkdown('Chat', [{ role: 'user', content: 'hi', timestamp: 'not a date' }]);
    expect(md).toContain('## You\n');
    expect(md).not.toContain('Invalid');
  });

  it('collapses blank runs and always ends with exactly one newline', () => {
    const md = formatTranscriptMarkdown('Chat', [
      { role: 'user', content: '   ', timestamp: T1 },
      { role: 'assistant', content: '', timestamp: T2 },
    ]);
    expect(md).not.toMatch(/\n{3}/);
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('renders an empty chat as just its heading', () => {
    expect(formatTranscriptMarkdown('Empty', [])).toBe('# Empty\n');
  });
});
