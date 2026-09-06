// ────────────────────────────────────────────────────────────────
// RuleBasedTextFormatter — deterministic, so every case is a direct
// input/output assertion. Covers both passes (punctuation commands, filler
// removal) individually and interacting with each other, plus the
// deliberate conservatism of the filler list (see the class's file header).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { RuleBasedTextFormatter } from '../RuleBasedTextFormatter.js';

describe('RuleBasedTextFormatter', () => {
  const formatter = new RuleBasedTextFormatter();

  it('names itself "rule-based"', () => {
    expect(formatter.name).toBe('rule-based');
  });

  describe('spoken punctuation commands', () => {
    it('period / full stop', async () => {
      expect(await formatter.format('this is a test period')).toBe('this is a test.');
      expect(await formatter.format('this is a test full stop')).toBe('this is a test.');
    });

    it('comma — attaches to the preceding word, keeps the following word separated', async () => {
      expect(await formatter.format('hello comma world')).toBe('hello, world');
    });

    it('question mark', async () => {
      expect(await formatter.format('how are you question mark')).toBe('how are you?');
    });

    it('exclamation mark / point', async () => {
      expect(await formatter.format('watch out exclamation mark')).toBe('watch out!');
      expect(await formatter.format('watch out exclamation point')).toBe('watch out!');
    });

    it('colon and semicolon', async () => {
      expect(await formatter.format('one thing colon apples')).toBe('one thing: apples');
      expect(await formatter.format('done for today semicolon see you tomorrow')).toBe('done for today; see you tomorrow');
    });

    it('hyphen and dash JOIN the words either side', async () => {
      // This used to assert 'well- known'. That was the bug, not the contract:
      // every command consumed only the space BEFORE it, which is right for a
      // full stop and wrong for a joiner, so a dictated hyphen left the two
      // words it was meant to join still separated.
      expect(await formatter.format('well hyphen known')).toBe('well-known');
      expect(await formatter.format('a state of the art dash system')).toBe('a state of the art-system');
    });

    it('is case-insensitive', async () => {
      expect(await formatter.format('this is a test PERIOD')).toBe('this is a test.');
      expect(await formatter.format('how are you Question Mark')).toBe('how are you?');
    });

    it('new line / newline breaks the text and absorbs surrounding spaces', async () => {
      expect(await formatter.format('first line new line second line')).toBe('first line\nSecond line');
      expect(await formatter.format('first line newline second line')).toBe('first line\nSecond line');
    });

    it('handles multiple commands in one utterance', async () => {
      expect(await formatter.format('hello comma how are you question mark')).toBe('hello, how are you?');
    });
  });

  describe('filler word removal (deliberately conservative list)', () => {
    it('removes clear interjection fillers', async () => {
      expect(await formatter.format('um so I think uh we should go')).toBe('so I think we should go');
    });

    it('removes a filler with a trailing comma from the transcript', async () => {
      expect(await formatter.format('um, I think this works')).toBe('I think this works');
    });

    it('removes fillers at the very start and end of the utterance', async () => {
      expect(await formatter.format('um hello there uh')).toBe('hello there');
    });

    it('is case-insensitive for fillers too', async () => {
      expect(await formatter.format('Um, that is correct')).toBe('that is correct');
    });

    it('does NOT remove "like" — too many legitimate uses to strip unconditionally', async () => {
      expect(await formatter.format('I like this a lot')).toBe('I like this a lot');
    });

    it('does NOT remove "you know" — a legitimate, meaningful phrase most of the time', async () => {
      expect(await formatter.format('you know the answer already')).toBe('you know the answer already');
    });

    it('does NOT remove "sort of" / "kind of" — ordinary descriptive phrases', async () => {
      expect(await formatter.format('it is a sort of pasta dish')).toBe('it is a sort of pasta dish');
      expect(await formatter.format('that is kind of surprising')).toBe('that is kind of surprising');
    });

    it('does not false-positive on words that merely CONTAIN a filler as a substring', async () => {
      // "her" contains no filler, but this guards the word-boundary regex
      // against a naive non-boundary match of "er" inside other words.
      expect(await formatter.format('herald the erosion')).toBe('herald the erosion');
    });

    it('REGRESSION (adversarial review) — does not mangle hyphenated acknowledgement words that start with a filler token', async () => {
      expect(await formatter.format('uh-huh that is right')).toBe('uh-huh that is right');
      expect(await formatter.format('uh-oh we have a problem')).toBe('uh-oh we have a problem');
      expect(await formatter.format('um-hmm sounds good')).toBe('um-hmm sounds good');
    });

    it('still strips a filler that is merely followed by a space and a separately hyphenated word', async () => {
      // The hyphen guard must be narrow — only protect a filler token that
      // is ITSELF directly touching the hyphen, not any filler anywhere
      // near unrelated hyphenated text later in the sentence.
      expect(await formatter.format('um well-known fact')).toBe('well-known fact');
    });
  });

  describe('period/noun ambiguity guard (REGRESSION — adversarial review)', () => {
    it('does not convert "period" preceded by a determiner (the ordinary noun sense)', async () => {
      expect(await formatter.format('my grace period ends soon')).toBe('my grace period ends soon');
      expect(await formatter.format('a trial period of three months')).toBe('a trial period of three months');
      expect(await formatter.format('the menstrual period lasted a week')).toBe('the menstrual period lasted a week');
      expect(await formatter.format('her period started today')).toBe('her period started today');
    });

    it('still converts "period" used as a command when not preceded by a determiner', async () => {
      expect(await formatter.format('this is a test period')).toBe('this is a test.');
      expect(await formatter.format('let us meet tomorrow period')).toBe('let us meet tomorrow.');
    });

    it('the placeholder used internally to protect noun-sense "period" never leaks into the output', async () => {
      const result = await formatter.format('my grace period ends soon period');
      expect(result).not.toContain('PERIOD_NOUN');
      expect(result).toBe('my grace period ends soon.');
    });
  });

  describe('adjacent punctuation collapse (REGRESSION — adversarial review)', () => {
    it('collapses two adjacent spoken commands into just the last mark, not both', async () => {
      expect(await formatter.format('test period comma end')).toBe('test, end');
    });

    it('does not affect normal, non-adjacent punctuation commands', async () => {
      expect(await formatter.format('hello comma how are you question mark')).toBe('hello, how are you?');
    });
  });

  describe('combined punctuation + filler + whitespace normalization', () => {
    it('handles a realistic dictated sentence end to end', async () => {
      const input = 'um so uh I think comma we should meet tomorrow period';
      expect(await formatter.format(input)).toBe('so I think, we should meet tomorrow.');
    });

    it('collapses whitespace left over from filler removal', async () => {
      expect(await formatter.format('I  um   really think so')).toBe('I really think so');
    });

    it('trims the whole result and each line', async () => {
      expect(await formatter.format('  hello world  ')).toBe('hello world');
      expect(await formatter.format('line one new line   line two  ')).toBe('line one\nLine two');
    });

    it('passes through plain text with nothing to clean up unchanged', async () => {
      expect(await formatter.format('the quick brown fox')).toBe('the quick brown fox');
    });

    it('handles empty input', async () => {
      expect(await formatter.format('')).toBe('');
    });
  });
});

describe('RuleBasedTextFormatter — symbols and attachment (added after a live dictation review)', () => {
  const f = new RuleBasedTextFormatter();

  it('attaches quotes and brackets to the correct side', async () => {
    // 'open quote hello close quote' used to yield '" hello"' — both quote
    // rules ate the space before them, which is right only for a closer.
    expect(await f.format('open quote hello close quote')).toBe('"hello"');
    expect(await f.format('open paren note close paren')).toBe('(note)');
    expect(await f.format('left square bracket a right square bracket')).toBe('[a]');
    expect(await f.format('left curly brace b right curly brace')).toBe('{b}');
  });

  it('alternates symmetric quotes, which do not say which side they are', async () => {
    expect(await f.format('double quote hello double quote and single quote x single quote'))
      .toBe(`"hello" and 'x'`);
  });

  it('handles the symbols a technical dictation needs', async () => {
    expect(await f.format('src slash utils slash index')).toBe('src/utils/index');
    expect(await f.format('issue hash ten')).toBe('issue #10');
    expect(await f.format('hashtag urgent')).toBe('#urgent');
    expect(await f.format('user at sign example dot com')).toBe('user@example.com');
    expect(await f.format('this ampersand that')).toBe('this&that');
    expect(await f.format('dollar sign five')).toBe('$5');
    expect(await f.format('fifty percent sign')).toBe('50%');
  });

  it('keeps deliberate mark sequences but still folds a self-correction', async () => {
    // "question mark exclamation mark exclamation point" collapsed to a bare
    // "!", discarding two marks the speaker plainly meant.
    expect(await f.format('what question mark exclamation mark')).toBe('what?!');
    // A separator in the run still reads as someone changing their mind.
    expect(await f.format('done period comma')).toBe('done,');
  });

  it('normalizes spoken numbers, including the shapes from the live session', async () => {
    expect(await f.format('one thousand two hundred and thirty four')).toBe('1234');
    expect(await f.format('number one zero zero two')).toBe('number 1002');
    expect(await f.format('ten eleven twelve thirteen')).toBe('10 11 12 13');
    expect(await f.format('thirty one point eight')).toBe('31.8');
    expect(await f.format('point number one')).toBe('point number 1');
  });

  it('accepts the joined spellings the recogniser actually produces', async () => {
    // Measured against a live session: "double quote" came back as
    // "doublequote", and "sign" ran into the following word. Commands that
    // were spoken correctly were silently not substituted.
    expect(await f.format('config doublequote value doublequote')).toBe('config "value"');
    expect(await f.format('mail user atsign example dot com')).toBe('mail user@example.com');
    // …but "dotcom" is a real word and must survive: the tolerance is for
    // joined MULTI-WORD commands, not for gluing a single-word command onto
    // whatever follows it.
    expect(await f.format('the dotcom boom')).toBe('the dotcom boom');
    expect(await f.format('a backslash b')).toBe('a\\b');
  });

  it('does not turn ordinary prose into digits', async () => {
    expect(await f.format('one thing at a time')).toBe('one thing at a time');
  });
});

describe('spoken commands the model punctuated in the middle', () => {
  // Nemotron infers punctuation from prosody, and a spoken command carries
  // the prosody of the thing it names — so it lands a mark INSIDE the phrase
  // and capitalises the next word. These are verbatim shapes observed from
  // the model, not hypotheticals.
  const fmt = new RuleBasedTextFormatter();

  it('recovers "question mark" from "question? Mark"', async () => {
    expect(await fmt.format('Are we still on track question? Mark the rate limiter worries me', {}))
      .toContain('on track?');
  });

  it('does not leave the literal command words behind', async () => {
    const out = await fmt.format('Are we still on track question? Mark the rate limiter', {});
    expect(out.toLowerCase()).not.toContain('question');
    expect(out).not.toContain('Mark the');
  });

  it('still matches a cleanly transcribed command', async () => {
    expect(await fmt.format('Are we still on track question mark', {})).toContain('track?');
  });

  it('leaves ordinary prose alone', async () => {
    // "open" and "paren" never co-occur this way in real text, but a sentence
    // that merely contains one of the words must be untouched.
    const out = await fmt.format('I will open the door. Mark said it was fine.', {});
    expect(out).toContain('open the door');
    expect(out).toContain('Mark said');
  });
});

describe('sentence case, line breaks and corrections (2026-09 dictation review)', () => {
  const f = new RuleBasedTextFormatter();

  it('capitalizes after a spoken terminal mark, but never the start of a segment', async () => {
    // The model had already put its own "?" and lowercase continuation in.
    expect(await f.format('Are we still on track? Question mark the rate limiter worries me exclamation mark here is the breakdown colon'))
      .toBe('Are we still on track? The rate limiter worries me! Here is the breakdown:');
    // A segment often continues a sentence; only the composer can case its
    // first word, because only it can see what precedes it.
    expect(await f.format('and the client caches responses')).toBe('and the client caches responses');
  });

  it('absorbs the punctuation the model hangs on "new line" and starts the line capitalized', async () => {
    expect(await f.format('Here is the checklist. New line. One, rebuild the index. New line two. Restart the workers.'))
      .toBe('Here is the checklist.\nOne, rebuild the index.\nTwo. Restart the workers.');
    expect(await f.format('here is the checklist colon new line one rebuild the index new line two restart the workers'))
      .toBe('here is the checklist:\nOne rebuild the index\nTwo restart the workers');
  });

  it('"new paragraph" leaves a blank line', async () => {
    expect(await f.format('and then new paragraph next section')).toBe('and then\n\nNext section');
    expect(await f.format('one new paragraph new paragraph two')).toBe('one\n\nTwo');
  });

  it('accepts the semicolon spellings the recogniser produces', async () => {
    expect(await f.format('Staging is fine some a colon production is not period')).toBe('Staging is fine; production is not.');
    expect(await f.format('fine semi colon production')).toBe('fine; production');
  });

  it('handles the extra symbols and the quote forms', async () => {
    expect(await f.format('a pipe symbol b')).toBe('a|b');
    expect(await f.format('tilde home')).toBe('~home');
    expect(await f.format('backtick code backtick')).toBe('`code`');
    expect(await f.format('quote hello end quote')).toBe('"hello"');
    expect(await f.format('x greater than sign y')).toBe('x>y');
    expect(await f.format('twenty degrees sign')).toBe('20°');
  });

  it('resolves "scratch that" inside an utterance and passes the standalone form through', async () => {
    expect(await f.format('send the report scratch that send the summary period')).toBe('send the summary.');
    expect(await f.format('Scratch that.')).toBe('scratch that');
  });

  it('strips a locale tag the multilingual model appended', async () => {
    expect(await f.format('We need to migrate. <en-US>')).toBe('We need to migrate.');
  });

  it('normalizes the numbers, times and units a chat message contains', async () => {
    expect(await f.format('the cluster handles twelve thousand requests per second comma with latency around three point five milliseconds period'))
      .toBe('the cluster handles 12,000 requests per second, with latency around 3.5 milliseconds.');
    expect(await f.format('meet at ten thirty a m on the fifth')).toBe('meet at 10:30 AM on the fifth');
    expect(await f.format('the price is dollar sign fifty nine point nine nine comma about twenty percent off'))
      .toBe('the price is $59.99, about 20% off');
  });
});
