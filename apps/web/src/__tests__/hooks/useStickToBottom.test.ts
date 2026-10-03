import { describe, expect, it } from 'vitest';
import { nextPinned } from '@/hooks/useStickToBottom.js';

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
