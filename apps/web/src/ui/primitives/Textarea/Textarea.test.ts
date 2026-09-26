import { describe, expect, it } from 'vitest';
import { autosizeHeight, lineHeightPx } from './Textarea';

// md: 13px ui text × 1.45 = 18.85 line, pad 7 + 7, no own border (the wrapper has it).
const md = { lineHeight: 18.85, paddingBlock: 14, borderBlock: 0 };

describe('autosizeHeight', () => {
  it('never shrinks below minRows', () => {
    const { height, overflow } = autosizeHeight({ ...md, scrollHeight: 14 + 18.85 }, { minRows: 2, maxRows: 8 });
    expect(height).toBeCloseTo(2 * 18.85 + 14);
    expect(overflow).toBe(false);
  });

  it('follows the content between minRows and maxRows', () => {
    const scrollHeight = 5 * 18.85 + 14;
    const { height, overflow } = autosizeHeight({ ...md, scrollHeight }, { minRows: 2, maxRows: 8 });
    expect(height).toBeCloseTo(scrollHeight);
    expect(overflow).toBe(false);
  });

  it('stops at maxRows and scrolls beyond it', () => {
    const { height, overflow } = autosizeHeight({ ...md, scrollHeight: 20 * 18.85 + 14 }, { minRows: 2, maxRows: 8 });
    expect(height).toBeCloseTo(8 * 18.85 + 14);
    expect(overflow).toBe(true);
  });

  it('grows without bound when maxRows is not set', () => {
    const scrollHeight = 40 * 18.85 + 14;
    expect(autosizeHeight({ ...md, scrollHeight }, { minRows: 1 })).toEqual({ height: scrollHeight, overflow: false });
  });

  it('adds the border for a border-box textarea', () => {
    const { height } = autosizeHeight({ ...md, borderBlock: 2, scrollHeight: 3 * 18.85 + 14 }, { minRows: 1, maxRows: 4 });
    expect(height).toBeCloseTo(3 * 18.85 + 14 + 2);
  });

  it('treats maxRows below minRows as minRows and minRows below 1 as 1', () => {
    expect(autosizeHeight({ ...md, scrollHeight: 100 * 18.85 }, { minRows: 3, maxRows: 1 }).height).toBeCloseTo(3 * 18.85 + 14);
    expect(autosizeHeight({ ...md, scrollHeight: 0 }, { minRows: 0 }).height).toBeCloseTo(18.85 + 14);
  });

  it('does not report overflow for sub-pixel rounding at exactly maxRows', () => {
    const { overflow } = autosizeHeight({ ...md, scrollHeight: 8 * 18.85 + 14 + 0.3 }, { minRows: 2, maxRows: 8 });
    expect(overflow).toBe(false);
  });
});

describe('lineHeightPx', () => {
  it.each([
    ['18.85px', 13, 18.85],
    ['1.6', 14, 22.4],
    ['normal', 10, 12],
  ])('%s at %dpx → %d', (lineHeight, fontSize, expected) => {
    expect(lineHeightPx(lineHeight, fontSize)).toBeCloseTo(expected);
  });
});
