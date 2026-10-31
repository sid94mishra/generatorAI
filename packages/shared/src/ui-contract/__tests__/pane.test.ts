import { describe, expect, it } from 'vitest';
import {
  DOCK_CONDITIONAL_TABS,
  DOCK_LINK_TABS,
  DOCK_PINNED_TABS,
  DOCK_TAB_CAPS,
  DOCK_TAB_TYPES,
  dockStorageKeys,
  parseDockLinkTab,
} from '../pane.js';

describe('dock contract (M-11, D-27, R-4)', () => {
  it('pins Changes · Files · Terminal · Browser in that order', () => {
    expect(DOCK_PINNED_TABS).toEqual(['changes', 'files', 'terminal', 'browser']);
  });

  it('every pinned, conditional, capped and link tab is a known tab type', () => {
    const known = new Set<string>(DOCK_TAB_TYPES);
    for (const t of [...DOCK_PINNED_TABS, ...DOCK_CONDITIONAL_TABS, ...Object.keys(DOCK_TAB_CAPS), ...DOCK_LINK_TABS]) {
      expect(known.has(t)).toBe(true);
    }
  });

  it('keeps the caps of the pre-redesign code', () => {
    expect(DOCK_TAB_CAPS).toEqual({ browser: 5, terminal: 4, file: 8, widget: 6 });
  });

  it('parses the R-4 `?dock=` values and ignores anything else', () => {
    for (const t of DOCK_LINK_TABS) expect(parseDockLinkTab(t)).toBe(t);
    expect(parseDockLinkTab('widget')).toBeNull();
    expect(parseDockLinkTab('file')).toBeNull();
    expect(parseDockLinkTab('')).toBeNull();
    expect(parseDockLinkTab(null)).toBeNull();
    expect(parseDockLinkTab(undefined)).toBeNull();
  });

  it('scopes storage keys per page under generatorai:dock:<scope>:*', () => {
    expect(dockStorageKeys('chat')).toMatchObject({ open: 'generatorai:dock:chat:open', layout: 'generatorai:dock:chat:layout' });
    expect(dockStorageKeys('chat').tabs('c1')).toBe('generatorai:dock:chat:c1');
    expect(dockStorageKeys('run').tabs('r1')).toBe('generatorai:dock:run:r1');
  });
});

describe('run pane tabs (mobile MG-28)', () => {
  it('orders the run tabs and parses run dock links', async () => {
    const { RUN_DOCK_TABS, parseRunDockLinkTab } = await import('../pane.js');
    expect(RUN_DOCK_TABS).toEqual(['output', 'files', 'hooks', 'variables', 'changes', 'terminal', 'browser']);
    expect(parseRunDockLinkTab('output')).toBe('output');
    expect(parseRunDockLinkTab('tasks')).toBeNull();
    expect(parseRunDockLinkTab(undefined)).toBeNull();
  });
});
