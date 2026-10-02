// The pane's state outside the tree (06 §1.4 rule 3; 03 MB-42): which chat or run claims the pane, its tabs and
// the render function for their bodies, open / full screen, and the last tab per scope. Open and the last tab
// persist per device and server (dockStorageKeys, 06 §6.7 `srv.<serverId>.`).
import type { ReactNode } from 'react';
import { create } from 'zustand';
import { dockStorageKeys, type DockScope } from '@generatorai/shared/ui-contract';

import { prefs } from '../../services/storage/prefs';
import type { PaneTab } from '../../ui/layout/PaneTabStrip';
import { isMobilePaneTab, type MobilePaneTab } from './paneRegistry';

export interface PaneScope {
  serverId: string;
  kind: DockScope;
  id: string;
}

export interface PaneClaim {
  scope: PaneScope;
  /** The chat / run title (the pane header's subtitle). */
  title: string;
  /** The screen that owns the pane; the pane shows over it and the workspace screens pushed from it. */
  path: string;
  tabs: ReadonlyArray<PaneTab & { type: MobilePaneTab }>;
  /** Body of one tab; `active` pauses hidden heavy tabs (terminal, browser, computer). */
  renderTab: (type: MobilePaneTab, ctx: { active: boolean }) => ReactNode;
}

export const scopeKey = (scope: PaneScope): string => `${scope.serverId}:${scope.kind}:${scope.id}`;

const read = (key: string): string | undefined => {
  try {
    return prefs.getString(key);
  } catch {
    return undefined;
  }
};
const write = (key: string, value: string): void => {
  try {
    prefs.setString(key, value);
  } catch {
    // Persistence is a convenience.
  }
};
const openKey = (scope: PaneScope): string => `srv.${scope.serverId}.${dockStorageKeys(scope.kind).open}`;
const tabKey = (scope: PaneScope): string => `srv.${scope.serverId}.${dockStorageKeys(scope.kind).tabs(scope.id)}`;

interface PaneState {
  claim: PaneClaim | null;
  open: boolean;
  fullscreen: boolean;
  active: MobilePaneTab;
  /** `openAt`: a `?dock=` link — open the pane at that tab once the scope is claimed. */
  setClaim(claim: PaneClaim, openAt?: MobilePaneTab | null): void;
  release(scope: PaneScope): void;
  setOpen(open: boolean): void;
  toggle(): void;
  setFullscreen(fullscreen: boolean): void;
  select(type: MobilePaneTab): void;
  /** Open the pane at a tab (a `?dock=` link, a slash command, "Review"). */
  openTab(type: MobilePaneTab): void;
}

/** A re-claim with equal values (same scope, title, path, tabs, renderer) changes nothing (MD-162). */
export function sameClaim(a: PaneClaim, b: PaneClaim): boolean {
  return a.renderTab === b.renderTab && a.title === b.title && a.path === b.path && scopeKey(a.scope) === scopeKey(b.scope) && JSON.stringify(a.tabs) === JSON.stringify(b.tabs);
}

export const usePaneStore = create<PaneState>((set, get) => ({
  claim: null,
  open: false,
  fullscreen: false,
  active: 'changes',
  setClaim: (claim, openAt) => {
    const previous = get().claim;
    if (!previous || scopeKey(previous.scope) !== scopeKey(claim.scope)) {
      const stored = read(tabKey(claim.scope));
      set({ claim, open: read(openKey(claim.scope)) === '1', fullscreen: false, active: isMobilePaneTab(stored) ? stored : 'changes' });
    } else if (!sameClaim(previous, claim)) {
      set({ claim });
    }
    if (openAt && claim.tabs.some((t) => t.type === openAt)) get().openTab(openAt);
  },
  release: (scope) => {
    const current = get().claim;
    if (current && scopeKey(current.scope) === scopeKey(scope)) set({ claim: null, open: false, fullscreen: false });
  },
  setOpen: (open) => {
    const claim = get().claim;
    if (claim) write(openKey(claim.scope), open ? '1' : '0');
    set(open ? { open } : { open, fullscreen: false });
  },
  toggle: () => get().setOpen(!get().open),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  select: (type) => {
    const claim = get().claim;
    if (claim) write(tabKey(claim.scope), type);
    set({ active: type });
  },
  openTab: (type) => {
    get().select(type);
    get().setOpen(true);
  },
}));
