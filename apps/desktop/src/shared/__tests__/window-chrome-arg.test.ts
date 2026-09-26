import { describe, expect, it } from 'vitest';
import { WINDOW_CHROME_ARG, parseWindowChromeArg, windowChromeArg } from '../window-chrome-arg';
import type { WindowChrome } from '../ipc';

const MAC: WindowChrome = {
  platform: 'darwin',
  titleBarStyle: 'hidden-inset',
  titleBarHeight: 0,
  insetLeft: 78,
  insetRight: 0,
  isWayland: false,
};

const arg = (value: unknown) => `${WINDOW_CHROME_ARG}${JSON.stringify(value)}`;

describe('window chrome launch argument (06 §3.6)', () => {
  it('round-trips through argv', () => {
    expect(parseWindowChromeArg(['electron', '--foo', windowChromeArg(MAC)])).toEqual(MAC);
  });

  it('is undefined when missing or malformed', () => {
    expect(parseWindowChromeArg(['electron'])).toBeUndefined();
    expect(parseWindowChromeArg([`${WINDOW_CHROME_ARG}{not json`])).toBeUndefined();
    expect(parseWindowChromeArg([arg({ ...MAC, platform: 'aix' })])).toBeUndefined();
    expect(parseWindowChromeArg([arg({ ...MAC, insetLeft: -1 })])).toBeUndefined();
    expect(parseWindowChromeArg([arg({ ...MAC, isWayland: 'no' })])).toBeUndefined();
  });

  it('drops unknown fields', () => {
    expect(parseWindowChromeArg([arg({ ...MAC, extra: '<script>' })])).toEqual(MAC);
  });
});
