import { describe, expect, it } from 'vitest';
import { INITIAL_PACER_STATE, advancePacer, flushPacer, snapToWordEnd, type TextPacerState } from '../transcript/textPacer.js';

const FRAME = 1000 / 60;

function run(text: string, ms: number, state: TextPacerState = INITIAL_PACER_STATE, options = {}): TextPacerState {
  let s = state;
  for (let t = 0; t < ms; t += FRAME) s = advancePacer(s, text, FRAME, options);
  return s;
}

describe('text pacer (D-91)', () => {
  it('drains a burst within about the drain time, never all at once', () => {
    const burst = 'word '.repeat(120); // 600 characters arrive in one chunk
    const afterOneFrame = advancePacer(INITIAL_PACER_STATE, burst, FRAME);
    expect(afterOneFrame.shown).toBeGreaterThan(0);
    expect(afterOneFrame.shown).toBeLessThan(40);
    expect(run(burst, 600).shown).toBeLessThan(burst.length);
    expect(run(burst, 1400).shown).toBe(burst.length);
  });

  it('speeds up with the backlog so a long answer never falls far behind', () => {
    const small = 'x '.repeat(50);
    const large = 'x '.repeat(2000);
    const smallStep = advancePacer(INITIAL_PACER_STATE, small, FRAME).shown;
    const largeStep = advancePacer(INITIAL_PACER_STATE, large, FRAME).shown;
    expect(largeStep).toBeGreaterThan(smallStep * 5);
    expect(run(large, 1400).shown).toBe(large.length);
  });

  it('reveals whole words', () => {
    const text = 'streaming answers arrive in bursts';
    const s = advancePacer(INITIAL_PACER_STATE, text, FRAME * 3);
    expect([' ', undefined]).toContain(text[s.shown]);
  });

  it('never splits a surrogate pair', () => {
    const text = '😀😀😀😀';
    expect(snapToWordEnd(text, 1, 0)).toBe(2);
  });

  it('flushes everything that arrived', () => {
    const text = 'the turn ended';
    expect(flushPacer(text).shown).toBe(text.length);
    expect(advancePacer({ shown: 99, carry: 0, sinceStep: 0, rate: 0 }, text, FRAME).shown).toBe(text.length);
  });

  it('reveals in steps, not per frame, with reduced motion', () => {
    const text = 'word '.repeat(100);
    const reduced = { reducedMotion: true, reducedStepMs: 250 };
    const early = run(text, 200, INITIAL_PACER_STATE, reduced);
    expect(early.shown).toBe(0);
    const later = run(text, 300, INITIAL_PACER_STATE, reduced);
    expect(later.shown).toBe(text.length);
  });

  it('eased (D-152): speeds up and slows down gradually, by character, and still finishes within twice the drain', () => {
    const burst = 'word '.repeat(120);
    const eased = { easeMs: 220, wordSlack: 0, drainMs: 900 };
    // Per-frame steps across the burst: they rise, then fall — never one jump to the top speed.
    const steps: number[] = [];
    let s = INITIAL_PACER_STATE;
    for (let t = 0; t < 2400 && s.shown < burst.length; t += FRAME) {
      const next = advancePacer(s, burst, FRAME, eased);
      steps.push(next.shown - s.shown);
      s = next;
    }
    expect(s.shown).toBe(burst.length);
    expect(steps.length * FRAME).toBeLessThanOrEqual(1800 + FRAME);
    const peak = Math.max(...steps);
    expect(steps[0]!).toBeLessThanOrEqual(peak / 2);
    expect(steps[steps.length - 1]!).toBeLessThan(peak / 2);
    // By character: a frame can stop inside a word.
    expect(steps.some((n, i) => i < steps.length - 1 && n % 5 !== 0)).toBe(true);
    // Caught up, the rate coasts down rather than dropping to zero.
    const after = advancePacer(s, burst, FRAME, eased);
    expect(after.rate).toBeGreaterThan(0);
    expect(after.rate).toBeLessThan(s.rate);
  });
});
