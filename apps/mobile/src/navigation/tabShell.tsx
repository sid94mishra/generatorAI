// ────────────────────────────────────────────────────────────────
// Tab shell context — what a tab scene needs to know about the chrome
// around it, without each screen re-deriving it.
//
//   • `fabBottom` / `listBottom(hasFab)` — where floating actions and list
//     ends sit so nothing hides under the tab bar or the FAB
//     (`tabContentInsets`, tested in navigation.test.ts).
//   • `attention` — the "waiting for you" count, computed ONCE in the tabs
//     layout (which already polls activity for the Home badge) and read by
//     the header inbox bell on every tab.
//
// Outside the tab shell the hook returns null and callers fall back to
// safe-area arithmetic (a FAB on a pushed screen, for instance).
// ────────────────────────────────────────────────────────────────

import React, { createContext, useContext } from 'react';

import type { TabContentInsets } from './tabsImplementation';

export interface TabShellValue extends TabContentInsets {
  /** Items blocked on a person (approvals + blocked/failed runs). */
  attention: number;
}

const TabShellContext = createContext<TabShellValue | null>(null);

export function TabShellProvider({
  value,
  children,
}: {
  value: TabShellValue;
  children: React.ReactNode;
}): React.ReactElement {
  return <TabShellContext.Provider value={value}>{children}</TabShellContext.Provider>;
}

/** The tab shell's insets and counts, or null when not inside the tab shell. */
export function useTabShell(): TabShellValue | null {
  return useContext(TabShellContext);
}
