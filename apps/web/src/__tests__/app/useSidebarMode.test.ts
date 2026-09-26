// 06 §2.5: the rail below 1200px or on a forceRail route, whatever the saved
// preference; `sidebar.toggle` flips the flyout while forced, the preference
// otherwise.

import { beforeEach, describe, expect, it } from 'vitest';
import { sidebarModeFor } from '@/app/shell/useSidebarMode.js';
import { formatElapsed } from '@/lib/elapsed.js';
import { displayAddress } from '@/hooks/useShellStatus.js';
import { useShellStore } from '@/stores/shellStore.js';

describe('sidebarModeFor', () => {
  it('follows the preference on a wide window', () => {
    expect(sidebarModeFor({ narrow: false, forceRail: false, pref: 'expanded' })).toEqual({ mode: 'expanded', forced: false });
    expect(sidebarModeFor({ narrow: false, forceRail: false, pref: 'rail' })).toEqual({ mode: 'rail', forced: false });
  });

  it('forces the rail below 1200px and on forceRail routes', () => {
    expect(sidebarModeFor({ narrow: true, forceRail: false, pref: 'expanded' })).toEqual({ mode: 'rail', forced: true });
    expect(sidebarModeFor({ narrow: false, forceRail: true, pref: 'expanded' })).toEqual({ mode: 'rail', forced: true });
  });
});

describe('shellStore.toggleSidebar', () => {
  beforeEach(() => useShellStore.setState({ sidebarPref: 'expanded', flyoutOpen: false, railForced: false }));

  it('flips the preference when the rail is not forced', () => {
    useShellStore.getState().toggleSidebar();
    expect(useShellStore.getState().sidebarPref).toBe('rail');
    expect(useShellStore.getState().flyoutOpen).toBe(false);
  });

  it('opens and closes the flyout when forced, leaving the preference alone', () => {
    useShellStore.getState().setRailForced(true);
    useShellStore.getState().toggleSidebar();
    expect(useShellStore.getState().flyoutOpen).toBe(true);
    expect(useShellStore.getState().sidebarPref).toBe('expanded');
    // Growing past 1200 un-forces the rail and closes the flyout.
    useShellStore.getState().setRailForced(false);
    expect(useShellStore.getState().flyoutOpen).toBe(false);
  });
});

describe('shell formatting', () => {
  it('formats elapsed time as m:ss, then h:mm:ss', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    expect(formatElapsed('2026-09-26T11:59:22Z', now)).toBe('0:38');
    expect(formatElapsed('2026-09-26T11:55:48Z', now)).toBe('4:12');
    expect(formatElapsed('2026-09-26T10:58:30Z', now)).toBe('1:01:30');
    expect(formatElapsed('not a date', now)).toBe('0:00');
  });

  it('shows loopback servers as local:<port>', () => {
    expect(displayAddress('http://127.0.0.1:3100')).toBe('local:3100');
    expect(displayAddress('http://localhost:5173/')).toBe('local:5173');
    expect(displayAddress('https://build-box.lan:3100')).toBe('build-box.lan:3100');
    expect(displayAddress('nope')).toBeUndefined();
  });
});
