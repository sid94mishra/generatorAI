// ────────────────────────────────────────────────────────────────
// The dock tab registry — how a page tells the dock which tab types exist
// and how each renders (D-27; 03 §4 S-08; M-11 tab ids in
// `@generatorai/shared/ui-contract` pane.ts).
//
// A page passes a `DockRegistry` (type → `DockTabDef`) to `<Dock>`. The dock
// owns the chrome (strip, "+" menu, caps, overflow, Maximize, collapse); the
// def owns the body. Whether a type exists at all is decided by the page:
// a type missing from the registry (Tasks on a non-orchestrator chat,
// Computer with computer use off, Browser on a surface that cannot draw it)
// is dropped from the strip and ignored by focus requests.
//
// Registering a panel (P4-09 Changes, P4-10 Terminal / Browser, P4-11 the
// rest): export a `React.memo` component taking `DockPanelProps` and put it
// in the page's registry as `Component`. Everything else the panel needs
// (workspace id, callbacks) comes from a context or a store the panel reads
// itself — never a closure — so a page re-render on every streamed token
// reaches no panel whose props did not change. `render` (a closure) is the
// legacy form the chat page's not-yet-ported panels still use.
// ────────────────────────────────────────────────────────────────

import type { ComponentType, ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import type { DotTone } from '@/ui/primitives/StatusDot/StatusDot.js';

/**
 * What the dock tells a panel about the tab instance it renders.
 *
 * `id` is the stable per-tab id (`terminal-…`, `browser-…`, `file:…`,
 * `widget:…`); panels that persist per-tab state (a terminal's session, a
 * browser tab's URL and native view) key off it. `index` is the 1-based
 * ordinal among tabs of the same type. `active` is false for every tab but
 * the selected one — every opened tab stays mounted, so a panel holding a
 * socket or decoding frames must gate that work on it (P1-50).
 */
export interface DockPanelProps {
  id: string;
  type: string;
  index: number;
  active: boolean;
}

type DockTabBody =
  | { Component: ComponentType<DockPanelProps>; render?: never }
  | { render: (ctx: DockPanelProps) => ReactNode; Component?: never };

/** Per-instance context for labels, icons and badges. */
export interface DockTabInstance {
  id: string;
  index: number;
}

/** One tab type. */
export type DockTabDef = DockTabBody & {
  /** Strip label and "+" menu label. */
  label: string;
  /** Icon concept (ui/icons). */
  icon: IconConcept;
  /** "+" menu second line. */
  description?: string;
  /**
   * Always in the strip (D-27), in registry order after the default tab; its
   * first instance is not closable. Extra instances (`allowMultiple`) are.
   */
  pinned?: boolean;
  /** The type may have several tabs (extra instances from the "+" menu). */
  allowMultiple?: boolean;
  /** Instance cap, pinned instance included (`DOCK_TAB_CAPS`). */
  maxInstances?: number;
  getTabLabel?: (tab: DockTabInstance) => string;
  getTabIcon?: (tab: DockTabInstance) => IconConcept;
  /** Trailing count (changed files, running tasks). */
  getTabCount?: (tab: DockTabInstance) => number | undefined;
  /** Trailing status dot with its accessible meaning (a loading page). */
  getTabDot?: (tab: DockTabInstance) => { tone: DotTone; label: string } | undefined;
  /** Shown but not choosable in the "+" menu. */
  disabled?: boolean;
  disabledReason?: string;
};

/** type → def. Key order is strip order for pinned types. */
export type DockRegistry = Record<string, DockTabDef>;

/**
 * An imperative "show this tab" request. Each new `token` adds (if missing)
 * and selects one tab of `type`; `tabId` addresses one specific instance
 * (a file tab whose id encodes its file, a widget instance).
 */
export interface DockFocusRequest {
  type: string;
  token: number;
  tabId?: string;
}
