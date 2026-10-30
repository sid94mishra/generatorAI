// Window chrome per OS (D-23, 06 §3.3): the pure `…For(platform, env)` forms,
// so every OS is covered on whichever OS runs the suite.

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ nativeTheme: { shouldUseDarkColors: true } }));
vi.mock('../appearance', () => ({ appearanceMirror: () => ({ fg: '#ededef', ground: '#0b0b0c' }) }));

import { isWaylandFor, titleBarOptionsFor, useCustomTitleBarFor, windowChromeFor } from '../platform';

const LINUX_CUSTOM = { GENERATORAI_LINUX_CUSTOM_TITLEBAR: '1' };

describe('titleBarOptionsFor', () => {
  it('macOS: hidden inset with the traffic lights centred in the 44px sidebar row', () => {
    expect(titleBarOptionsFor('darwin', {})).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
    });
  });

  it('Windows: a 36px Window Controls Overlay strip', () => {
    const opts = titleBarOptionsFor('win32', {}) as { titleBarStyle: string; titleBarOverlay: Record<string, unknown> };
    expect(opts.titleBarStyle).toBe('hidden');
    expect(opts.titleBarOverlay).toMatchObject({ color: '#00000000', height: 36 });
  });

  it('Linux: the native frame unless the custom title bar is opted into', () => {
    expect(titleBarOptionsFor('linux', {})).toEqual({});
    expect(titleBarOptionsFor('linux', LINUX_CUSTOM)).toEqual(titleBarOptionsFor('win32', {}));
  });
});

describe('windowChromeFor', () => {
  it('macOS has no strip: height 0, traffic-light inset 78', () => {
    expect(windowChromeFor('darwin', {})).toEqual({
      platform: 'darwin',
      titleBarStyle: 'hidden-inset',
      titleBarHeight: 0,
      insetLeft: 78,
      insetRight: 0,
      isWayland: false,
    });
  });

  it('Windows and Linux custom: the 36px strip with the 138px caption cluster reserved', () => {
    for (const [platform, env] of [
      ['win32', {}],
      ['linux', LINUX_CUSTOM],
    ] as const) {
      expect(windowChromeFor(platform, env)).toMatchObject({
        titleBarStyle: 'overlay',
        titleBarHeight: 36,
        insetLeft: 0,
        insetRight: 138,
      });
    }
  });

  it('Linux native reserves nothing and reports Wayland', () => {
    expect(windowChromeFor('linux', { XDG_SESSION_TYPE: 'wayland' })).toEqual({
      platform: 'linux',
      titleBarStyle: 'native',
      titleBarHeight: 0,
      insetLeft: 0,
      insetRight: 0,
      isWayland: true,
    });
  });

  it('other Unixes are laid out like Linux', () => {
    expect(windowChromeFor('freebsd', {}).platform).toBe('linux');
    expect(useCustomTitleBarFor('freebsd', {})).toBe(false);
  });
});

describe('isWaylandFor', () => {
  it('is Linux-only', () => {
    expect(isWaylandFor('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe(true);
    expect(isWaylandFor('darwin', { WAYLAND_DISPLAY: 'wayland-0' })).toBe(false);
  });
});
