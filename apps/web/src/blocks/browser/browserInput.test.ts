// Pure input mapping for the browser live view (browserInput.ts).
import { describe, expect, it } from 'vitest';

import {
  clickInput,
  clientToPagePoint,
  displayBrowserUrl,
  dragRect,
  isCaptureRectUsable,
  isInternalBrowserUrl,
  keyInput,
  mouseButtonName,
  moveInput,
  normaliseBrowserUrl,
  scrollbarThumb,
  scrollDragTarget,
  viewRectToPageClip,
  wheelInput,
} from './browserInput.js';

const noMods = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

describe('normaliseBrowserUrl', () => {
  it('prefixes https:// to a bare host or path', () => {
    expect(normaliseBrowserUrl('example.com')).toBe('https://example.com');
    expect(normaliseBrowserUrl('localhost:3000/a?b=1')).toBe('https://localhost:3000/a?b=1');
  });

  it('keeps an explicit http(s) scheme in any letter case', () => {
    expect(normaliseBrowserUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normaliseBrowserUrl('https://a.example')).toBe('https://a.example');
    expect(normaliseBrowserUrl('HTTP://EXAMPLE.COM')).toBe('HTTP://EXAMPLE.COM');
    expect(normaliseBrowserUrl('Https://Mixed.Case')).toBe('Https://Mixed.Case');
  });

  it('prefixes other schemes as hosts (only http/https are loaded as typed)', () => {
    expect(normaliseBrowserUrl('ftp://x')).toBe('https://ftp://x');
  });
});

describe('isInternalBrowserUrl / displayBrowserUrl', () => {
  it('treats empty, about:blank* and the #gai- marker as internal', () => {
    for (const url of [null, undefined, '', 'about:blank', 'about:blank#gai-ws-1', 'https://x.test/#gai-1']) {
      expect(isInternalBrowserUrl(url)).toBe(true);
      expect(displayBrowserUrl(url)).toBeUndefined();
    }
  });

  it('passes real pages through', () => {
    expect(isInternalBrowserUrl('https://example.com/')).toBe(false);
    expect(displayBrowserUrl('https://example.com/')).toBe('https://example.com/');
  });
});

describe('clientToPagePoint (object-contain letterbox)', () => {
  // A 1280×800 frame in a 640×800 box: scale 0.5 → 640×400, bars of 200 px top and bottom.
  const box = { left: 10, top: 20, width: 640, height: 800 };
  const frame = { width: 1280, height: 800 };

  it('maps a point inside the displayed frame to page pixels', () => {
    expect(clientToPagePoint({ clientX: 10, clientY: 220 }, box, frame)).toEqual({ x: 0, y: 0 });
    expect(clientToPagePoint({ clientX: 330, clientY: 420 }, box, frame)).toEqual({ x: 640, y: 400 });
    expect(clientToPagePoint({ clientX: 650, clientY: 620 }, box, frame)).toEqual({ x: 1280, y: 800 });
  });

  it('returns null on the letterbox bars and for an unsized frame', () => {
    expect(clientToPagePoint({ clientX: 100, clientY: 120 }, box, frame)).toBeNull();
    expect(clientToPagePoint({ clientX: 100, clientY: 700 }, box, frame)).toBeNull();
    expect(clientToPagePoint({ clientX: 100, clientY: 300 }, box, { width: 0, height: 0 })).toBeNull();
  });
});

describe('capture rectangles', () => {
  it('normalises a drag in any direction', () => {
    expect(dragRect({ x: 50, y: 60 }, 10, 20)).toEqual({ x: 10, y: 20, w: 40, h: 40 });
    expect(dragRect({ x: 10, y: 20 }, 50, 60)).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });

  it('ignores rectangles under 8×8', () => {
    expect(isCaptureRectUsable(null)).toBe(false);
    expect(isCaptureRectUsable({ x: 0, y: 0, w: 7, h: 100 })).toBe(false);
    expect(isCaptureRectUsable({ x: 0, y: 0, w: 100, h: 7 })).toBe(false);
    expect(isCaptureRectUsable({ x: 0, y: 0, w: 8, h: 8 })).toBe(true);
  });

  it('maps a view rectangle to a page clip through the letterbox', () => {
    // 1280×800 in 640×800 → scale 0.5, offY 200.
    expect(viewRectToPageClip({ x: 0, y: 200, w: 320, h: 200 }, { width: 640, height: 800 }, { width: 1280, height: 800 }))
      .toEqual({ x: 0, y: 0, width: 640, height: 400 });
  });
});

describe('input protocol events', () => {
  it('names mouse buttons', () => {
    expect(mouseButtonName(0)).toBe('left');
    expect(mouseButtonName(1)).toBe('middle');
    expect(mouseButtonName(2)).toBe('right');
  });

  it('builds clicks (click count defaults to 1), moves and wheels', () => {
    expect(clickInput({ x: 1, y: 2 }, 0, 0)).toEqual({ type: 'mouse.click', x: 1, y: 2, button: 'left', clickCount: 1 });
    expect(clickInput({ x: 1, y: 2 }, 2, 2)).toEqual({ type: 'mouse.click', x: 1, y: 2, button: 'right', clickCount: 2 });
    expect(moveInput({ x: 3, y: 4 })).toEqual({ type: 'mouse.move', x: 3, y: 4 });
    expect(wheelInput({ x: 5, y: 6 }, 0, 120)).toEqual({ type: 'mouse.wheel', x: 5, y: 6, deltaX: 0, deltaY: 120 });
    expect(JSON.parse(JSON.stringify(wheelInput(null, 1, -1)))).toEqual({ type: 'mouse.wheel', deltaX: 1, deltaY: -1 });
  });

  it('types bare printable characters and presses everything else with modifiers', () => {
    expect(keyInput({ key: 'a', ...noMods })).toEqual({ type: 'key.type', text: 'a' });
    expect(keyInput({ key: 'A', ...noMods, shiftKey: true })).toEqual({ type: 'key.press', key: 'A', modifiers: ['Shift'] });
    expect(keyInput({ key: 'Enter', ...noMods })).toEqual({ type: 'key.press', key: 'Enter', modifiers: [] });
    expect(keyInput({ key: 'c', altKey: true, ctrlKey: true, metaKey: true, shiftKey: true }))
      .toEqual({ type: 'key.press', key: 'c', modifiers: ['Alt', 'Control', 'Meta', 'Shift'] });
  });

  it('leaves F5 and F12 to the host', () => {
    expect(keyInput({ key: 'F5', ...noMods })).toBeNull();
    expect(keyInput({ key: 'F12', ...noMods })).toBeNull();
    expect(keyInput({ key: 'F11', ...noMods })).toEqual({ type: 'key.press', key: 'F11', modifiers: [] });
  });
});

describe('overlay scrollbar', () => {
  it('draws no thumb unless the page overflows by more than 4 px', () => {
    expect(scrollbarThumb({ scrollY: 0, scrollHeight: 804, clientHeight: 800 })).toBeNull();
    expect(scrollbarThumb({ scrollY: 0, scrollHeight: 805, clientHeight: 800 })).not.toBeNull();
  });

  it('sizes the thumb to the visible share (min 4 %) and places it by the scroll ratio', () => {
    expect(scrollbarThumb({ scrollY: 0, scrollHeight: 2000, clientHeight: 1000 })).toEqual({ topPct: 0, heightPct: 50 });
    expect(scrollbarThumb({ scrollY: 1000, scrollHeight: 2000, clientHeight: 1000 })).toEqual({ topPct: 50, heightPct: 50 });
    expect(scrollbarThumb({ scrollY: 0, scrollHeight: 100_000, clientHeight: 1000 })?.heightPct).toBe(4);
  });

  it('turns a thumb drag into a clamped page scrollY', () => {
    const s = { scrollY: 0, scrollHeight: 2000, clientHeight: 1000 };
    expect(scrollDragTarget(s, 0, 100, 400)).toBe(500);
    expect(scrollDragTarget(s, 0, 1000, 400)).toBe(1000);
    expect(scrollDragTarget(s, 500, -1000, 400)).toBe(0);
    expect(scrollDragTarget({ scrollY: 0, scrollHeight: 800, clientHeight: 800 }, 0, 10, 400)).toBeNull();
  });
});
