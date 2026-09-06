// ────────────────────────────────────────────────────────────────
// dictationText — how one utterance joins the next in the composer.
//
// Every shape here was observed live: the recogniser cuts at pauses and
// capitalizes whatever follows, and a spoken symbol that straddles the cut
// arrives in two halves.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  applyScratchCommand,
  splitScratchCommand,
  stripLocaleTags,
  dictationSeparator,
  continueCase,
  stitchDictation,
} from '../dictationText.js';

describe('dictationSeparator', () => {
  it('puts one space between two words', () => {
    expect(dictationSeparator('hello', 'world')).toBe(' ');
  });

  it('adds nothing at the start, or after whitespace or a newline', () => {
    expect(dictationSeparator('', 'world')).toBe('');
    expect(dictationSeparator('hello ', 'world')).toBe('');
    expect(dictationSeparator('hello\n', 'world')).toBe('');
  });

  it('joins across an utterance cut inside a symbol', () => {
    // "ping me at sign" | "Sid" and "source" | "forward slash server".
    expect(dictationSeparator('ping me@', 'Sid')).toBe('');
    expect(dictationSeparator('source', '/server/index.ts')).toBe('');
    expect(dictationSeparator('well-', 'known')).toBe('');
    expect(dictationSeparator('the ticket is #', '4219')).toBe('');
  });

  it('keeps closing punctuation attached to the previous word', () => {
    expect(dictationSeparator('hello', ', world')).toBe('');
    expect(dictationSeparator('(note', ')')).toBe('');
  });

  it('treats a sentence-final period as a sentence end, not a joiner', () => {
    expect(dictationSeparator('the plan.', 'Are we on track?')).toBe(' ');
  });

  it('knows which side of a quote it is on', () => {
    expect(dictationSeparator('she said "', 'hello')).toBe('');
    expect(dictationSeparator('she said "hello"', 'and left')).toBe(' ');
  });
});

describe('continueCase', () => {
  it('lowercases an ordinary word the model capitalized after a pause mid-sentence', () => {
    expect(continueCase('and returns JSON,', 'And the TypeScript client')).toBe('and the TypeScript client');
    expect(continueCase('I am worried about the rate limiter', 'Because it is new')).toBe('because it is new');
  });

  it('keeps the capital after a sentence end, a newline, or at the start', () => {
    expect(continueCase('the deployment plan.', 'Are we still on track?')).toBe('Are we still on track?');
    expect(continueCase('worries me!', 'Here is the breakdown')).toBe('Here is the breakdown');
    expect(continueCase('the breakdown:\n', 'One rebuild the index')).toBe('One rebuild the index');
    expect(continueCase('', 'Hey team')).toBe('Hey team');
    expect(continueCase('He said "done."', 'Then he left')).toBe('Then he left');
  });

  it('capitalizes a lowercase start when a sentence begins', () => {
    expect(continueCase('the plan.', 'are we on track')).toBe('Are we on track');
    expect(continueCase('', 'hello')).toBe('Hello');
  });

  it('never lowercases a proper noun, an acronym or I', () => {
    expect(continueCase('ping me on', 'Friday')).toBe('Friday');
    expect(continueCase('it caches responses in', 'Redis')).toBe('Redis');
    expect(continueCase('the', 'API uses OAuth')).toBe('API uses OAuth');
    expect(continueCase('and then', "I'm done")).toBe("I'm done");
    expect(continueCase('and then', 'I am done')).toBe('I am done');
  });

  it('leaves text that does not begin with a letter alone', () => {
    expect(continueCase('the ticket is', '#4219')).toBe('#4219');
    expect(continueCase('costs', '$250')).toBe('$250');
  });
});

describe('stitchDictation', () => {
  it('joins, cases and places the caret after the inserted text', () => {
    const r = stitchDictation('and returns JSON,', 'And the client', '');
    expect(r.text).toBe('and returns JSON, and the client');
    expect(r.start).toBe('and returns JSON, '.length);
    expect(r.end).toBe(r.text.length);
  });

  it('spaces off text after the caret, except punctuation', () => {
    expect(stitchDictation('Hello', 'there', 'world').text).toBe('Hello there world');
    expect(stitchDictation('Hello', 'there', '!').text).toBe('Hello there!');
    expect(stitchDictation('Hello', 'there', ' world').text).toBe('Hello there world');
  });

  it('handles an empty partial without adding a separator', () => {
    const r = stitchDictation('Hello', '', '');
    expect(r.text).toBe('Hello');
    expect(r.start).toBe(5);
    expect(r.end).toBe(5);
  });
});

describe('scratch that', () => {
  it('discards the words before it within one utterance', () => {
    expect(applyScratchCommand('send the report scratch that send the summary')).toBe('send the summary');
    expect(applyScratchCommand('send the report. Scratch that, send the summary')).toBe('send the summary');
    expect(applyScratchCommand('we need to um delete that never mind')).toBe('never mind');
  });

  it('passes a standalone command through in canonical form for the composer', () => {
    expect(applyScratchCommand('Scratch that.')).toBe('scratch that');
    expect(applyScratchCommand('scratch that send the summary')).toBe('scratch that send the summary');
    expect(applyScratchCommand('Undo that')).toBe('scratch that');
  });

  it('acts on the last occurrence only', () => {
    expect(applyScratchCommand('a scratch that b scratch that c')).toBe('c');
  });

  it('leaves ordinary text alone', () => {
    expect(applyScratchCommand('scratch the surface')).toBe('scratch the surface');
    expect(applyScratchCommand('delete the file')).toBe('delete the file');
  });

  it('splits the standalone form for the composer', () => {
    expect(splitScratchCommand('scratch that')).toEqual({ scratch: true, rest: '' });
    expect(splitScratchCommand('scratch that send the summary')).toEqual({ scratch: true, rest: 'send the summary' });
    expect(splitScratchCommand('send the summary')).toEqual({ scratch: false, rest: 'send the summary' });
  });
});

describe('stripLocaleTags', () => {
  it('removes the tag the multilingual model appends', () => {
    expect(stripLocaleTags('We need to migrate. <en-US> The rest').replace(/\s+/g, ' ')).toBe('We need to migrate. The rest');
  });
});
