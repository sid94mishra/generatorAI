import { describe, expect, it } from 'vitest';
import { followStep, nextPinned } from '@/hooks/useStickToBottom.js';

describe('nextPinned — only the reader unpins the transcript', () => {
  it('pins whenever the view reaches the bottom', () => {
    expect(nextPinned(false, { near: true, movedUp: false })).toBe(true);
    expect(nextPinned(false, { near: true, movedUp: true })).toBe(true);
  });

  it('keeps following when our own write lands short of content that grew in the meantime', () => {
    // A long answer grew by more than the threshold between the follow write and its scroll event.
    expect(nextPinned(true, { near: false, movedUp: false })).toBe(true);
  });

  it('unpins when the reader scrolls up away from the bottom', () => {
    expect(nextPinned(true, { near: false, movedUp: true })).toBe(false);
  });

  it('stays unpinned while the reader scrolls down but has not reached the bottom', () => {
    expect(nextPinned(false, { near: false, movedUp: false })).toBe(false);
  });
});

describe('followStep — the spring follow (D-91)', () => {
  const FRAME = 1000 / 60;
  const run = (top: number, max: number, frames: number) => {
    let state = { top, velocity: 0 };
    const tops: number[] = [];
    for (let i = 0; i < frames; i += 1) {
      state = followStep(state.top, max, state.velocity, FRAME);
      tops.push(state.top);
    }
    return tops;
  };

  it('moves toward the bottom over several frames and never overshoots', () => {
    const tops = run(0, 400, 60);
    expect(tops[0]).toBeGreaterThan(0);
    expect(tops[0]).toBeLessThan(400);
    expect(tops.every((t) => t <= 400)).toBe(true);
    expect(tops.at(-1)).toBe(400);
  });

  it('moves monotonically (no jumps back) and smoothly — no single frame covers most of the gap', () => {
    const tops = run(0, 2000, 120);
    const steps = tops.map((t, i) => t - (i ? tops[i - 1]! : 0));
    expect(steps.every((d) => d >= 0)).toBe(true);
    expect(Math.max(...steps)).toBeLessThan(2000 * 0.5);
  });

  it('is roughly frame-rate independent', () => {
    let a = { top: 0, velocity: 0 };
    for (let i = 0; i < 20; i += 1) a = followStep(a.top, 1000, a.velocity, FRAME);
    let b = { top: 0, velocity: 0 };
    for (let i = 0; i < 10; i += 1) b = followStep(b.top, 1000, b.velocity, FRAME * 2);
    expect(Math.abs(a.top - b.top)).toBeLessThan(120);
  });

  it('takes one step with reduced motion', () => {
    expect(followStep(0, 400, 0, FRAME, { reducedMotion: true })).toEqual({ top: 400, velocity: 0 });
  });
});
