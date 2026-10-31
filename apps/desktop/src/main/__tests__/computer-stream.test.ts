// The live video may only ever capture the window main armed — never the
// screen, another window, or a stale arm.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSources } = vi.hoisted(() => ({ getSources: vi.fn() }));
vi.mock('electron', () => ({ desktopCapturer: { getSources } }));

import { armWindowStream, installWindowStreamHandler, sourceForWindow } from '../computer-stream';

type Handler = (request: { videoRequested: boolean }, callback: (streams: { video?: unknown }) => void) => void;

function handler(): Handler {
  let h: Handler | undefined;
  installWindowStreamHandler({ setDisplayMediaRequestHandler: (fn: unknown) => (h = fn as Handler) } as never);
  return h!;
}

function answer(h: Handler, videoRequested = true): { video?: unknown } {
  let out: { video?: unknown } = {};
  h({ videoRequested }, (s) => (out = s));
  return out;
}

const SOURCES = [
  { id: 'screen:1:0', name: 'Entire screen' },
  { id: 'window:4201:0', name: 'Notes' },
  { id: 'window:420:0', name: 'Calculator' },
];

describe('sourceForWindow', () => {
  it('matches the native window id exactly, not by prefix', () => {
    expect(sourceForWindow(SOURCES, 420)?.name).toBe('Calculator');
    expect(sourceForWindow(SOURCES, 4201)?.name).toBe('Notes');
    expect(sourceForWindow(SOURCES, 42)).toBeNull();
  });

  it('refuses ids that are not a positive integer', () => {
    expect(sourceForWindow(SOURCES, 0)).toBeNull();
    expect(sourceForWindow(SOURCES, 1.5)).toBeNull();
    expect(sourceForWindow(SOURCES, Number.NaN)).toBeNull();
  });
});

describe('window stream arming', () => {
  beforeEach(() => getSources.mockResolvedValue(SOURCES));

  it('refuses a display-media request nothing armed', () => {
    expect(answer(handler())).toEqual({});
  });

  it('hands out the armed window once', async () => {
    const h = handler();
    expect(await armWindowStream(420)).toBe(true);
    expect(answer(h)).toEqual({ video: SOURCES[2] });
    expect(answer(h)).toEqual({});
  });

  it('arms nothing for an unknown window or a non-number', async () => {
    const h = handler();
    expect(await armWindowStream(999)).toBe(false);
    expect(await armWindowStream('420')).toBe(false);
    expect(answer(h)).toEqual({});
  });

  it('expires an arm that no request used', async () => {
    const h = handler();
    vi.useFakeTimers();
    try {
      await armWindowStream(420);
      vi.advanceTimersByTime(6_000);
      expect(answer(h)).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });
});
