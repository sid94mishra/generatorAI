// ────────────────────────────────────────────────────────────────
// What a composer line means (open question #19).
//
// The tracker logged this as "`/attach` → `chat.send`'s `flags.attach`
// threading has no dedicated test". The COMMAND half turned out to be
// covered already (`chat-send.test.ts` pins the `sendWithAttachments`
// routing and the unreadable-path failure); what had no test was the
// decision the TUI makes — which is now here, and pure.
//
// The failure it guards is the one that never announces itself: a message
// sent WITHOUT the file the user attached, reported as a success.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { parseComposerInput, queueAttachment, SLASH_COMMANDS } from '../composerInput.js';

describe('parseComposerInput — ordinary text', () => {
  it('sends plain text with no attachments', () => {
    expect(parseComposerInput('hello there')).toEqual({
      kind: 'send',
      prompt: 'hello there',
      attachments: [],
    });
  });

  it('carries the queued attachments on the NEXT message, which is what /attach promises', () => {
    expect(parseComposerInput('look at this', ['a.md', 'b.csv'])).toEqual({
      kind: 'send',
      prompt: 'look at this',
      attachments: ['a.md', 'b.csv'],
    });
  });

  it('copies the queue rather than passing the caller’s array through', () => {
    // The caller clears the queue right after sending; sharing the array
    // would empty the payload it just handed over.
    const pending = ['a.md'];
    const intent = parseComposerInput('x', pending);
    expect(intent.kind === 'send' && intent.attachments).not.toBe(pending);
    expect(intent.kind === 'send' && intent.attachments).toEqual(['a.md']);
  });

  it('treats text that merely CONTAINS a slash as text', () => {
    const intent = parseComposerInput('what does src/app.ts do?');
    expect(intent.kind).toBe('send');
  });

  it('keeps a multi-line prompt intact', () => {
    const intent = parseComposerInput('line one\nline two');
    expect(intent.kind === 'send' && intent.prompt).toBe('line one\nline two');
  });
});

describe('parseComposerInput — slash commands', () => {
  it('recognises every declared command', () => {
    for (const command of SLASH_COMMANDS) {
      expect(parseComposerInput(`/${command}`)).toEqual({ kind: 'slash', command, argument: '' });
    }
  });

  it('splits the argument off, collapsing the whitespace between', () => {
    expect(parseComposerInput('/attach   ./notes.md')).toEqual({
      kind: 'slash',
      command: 'attach',
      argument: './notes.md',
    });
  });

  it('keeps an argument containing spaces whole', () => {
    expect(parseComposerInput('/model  claude sonnet 5')).toEqual({
      kind: 'slash',
      command: 'model',
      argument: 'claude sonnet 5',
    });
  });

  it('reports an unknown command instead of sending it as a prompt', () => {
    // Silently sending `/attahc ./x.md` to the model as text is the worst
    // outcome: the user believes a file was queued and it never was.
    expect(parseComposerInput('/attahc ./x.md')).toEqual({
      kind: 'unknown-slash',
      command: 'attahc',
    });
  });

  it('treats a bare slash as an unknown command, not as a send', () => {
    expect(parseComposerInput('/')).toEqual({ kind: 'unknown-slash', command: '' });
  });

  it('never sends the queued attachments on a slash command', () => {
    // `/clear` is not a message; attaching files to it would consume the
    // queue without sending them anywhere.
    const intent = parseComposerInput('/clear', ['a.md']);
    expect(intent.kind).toBe('slash');
    expect('attachments' in intent).toBe(false);
  });
});

describe('queueAttachment', () => {
  it('appends, so /attach twice means two files', () => {
    expect(queueAttachment(['a.md'], 'b.csv')).toEqual(['a.md', 'b.csv']);
  });

  it('collapses a duplicate — attaching the same path twice uploads it twice', () => {
    expect(queueAttachment(['a.md'], 'a.md')).toEqual(['a.md']);
  });

  it('trims, and ignores an empty path', () => {
    expect(queueAttachment([], '  ./notes.md  ')).toEqual(['./notes.md']);
    expect(queueAttachment(['a.md'], '   ')).toEqual(['a.md']);
  });

  it('never mutates the queue it was given', () => {
    const pending = ['a.md'];
    queueAttachment(pending, 'b.csv');
    expect(pending).toEqual(['a.md']);
  });
});
