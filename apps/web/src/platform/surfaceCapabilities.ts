// ────────────────────────────────────────────────────────────────
// surfaceCapabilities — where apps/web reads the W29 ledger.
//
// The ledger had no importers at all: it declared what five surfaces can do
// and nothing branched on any of it, so an `enforced` claim was a comment
// with a test that re-read the comment. This module is the web/desktop half
// of the fix — every function here turns a declaration into a decision real
// code makes, so flipping a field in `TransportCapabilities.ts` changes what
// the app does, and the tests can prove it by handing in a synthetic set.
//
// Each exported decision takes the capability set as an OPTIONAL argument
// defaulting to this surface's. That is not test scaffolding for its own
// sake: it is what lets the enforcement test assert the negative ("with
// `browserPanelRendering: false` the Browser tab is not offered"), which is
// the half a positive-only test can never catch — an implementation that
// ignores the ledger and hardcodes `true` passes every positive assertion.
// ────────────────────────────────────────────────────────────────

import {
  capabilitiesFor,
  type SurfaceId,
  type TransportCapabilitySet,
} from '@generatorai/shared';

import { isDesktop } from '@/lib/desktop.js';

/**
 * Which ledger row describes the code currently running.
 *
 * The SPA is byte-identical in both, so this cannot be a build flag — the
 * Electron shell serves the same bundle same-origin. `isDesktop` is the
 * preload bridge's own answer.
 */
export function currentSurfaceId(): SurfaceId {
  return isDesktop ? 'desktop' : 'web';
}

/** This surface's declared capabilities. */
export function surfaceCapabilities(): TransportCapabilitySet {
  return capabilitiesFor(currentSurfaceId());
}

/** Right-pane tab types, in the order the pane offers them. */
export type RightPaneTabType =
  | 'files'
  | 'browser'
  | 'terminal'
  | 'computer'
  | 'widget'
  | 'plan'
  | 'background_tasks';

export interface RightPaneTabOptions {
  /** Computer-use is also behind a server-side feature flag. */
  computerUseEnabled: boolean;
  /** Background tasks only exist for an orchestrator chat. */
  isOrchestrator: boolean;
}

/**
 * The panels this surface offers to add to the right pane.
 *
 * Two independent gates, and they mean different things: the ledger says
 * whether this SURFACE can render the panel at all, the options say whether
 * this CHAT has anything to put in it. Both have to pass, and conflating them
 * is how a surface ends up offering a tab it cannot draw.
 */
export function addableRightPaneTabs(
  options: RightPaneTabOptions,
  caps: TransportCapabilitySet = surfaceCapabilities(),
): RightPaneTabType[] {
  const tabs: RightPaneTabType[] = ['files'];
  if (caps.browserPanelRendering.supported) tabs.push('browser');
  if (caps.terminalRendering.supported) tabs.push('terminal');
  if (caps.computerPanelRendering.supported && options.computerUseEnabled) tabs.push('computer');
  if (caps.widgetRendering.supported) tabs.push('widget');
  tabs.push('plan');
  if (options.isOrchestrator) tabs.push('background_tasks');
  return tabs;
}

/**
 * Which tab the right pane opens on.
 *
 * Changes is the diff surface, so a surface that cannot render a diff must
 * not land there — it would open on an empty panel it can never fill.
 */
export function defaultRightPaneTab(
  caps: TransportCapabilitySet = surfaceCapabilities(),
): 'changes' | 'files' {
  return caps.diffRendering.supported ? 'changes' : 'files';
}

/**
 * How a live view (terminal, browser screencast) moves frames.
 *
 * `'none'` is not a degraded mode — it means the panel must not open a socket
 * at all. A surface that declares no WebSocket streaming and opens one anyway
 * is exactly the "declared but not honoured" failure the ledger exists to
 * make impossible.
 */
export function liveViewTransport(
  caps: TransportCapabilitySet = surfaceCapabilities(),
): 'websocket' | 'none' {
  return caps.websocketStreaming.supported ? 'websocket' : 'none';
}

export interface ComposerAffordances {
  /** Show the paperclip / accept dropped files. */
  attachments: boolean;
  /** Bind ⌘⏎ / Ctrl+⏎ to send. */
  sendShortcut: boolean;
}

/** What the composer offers on this surface. */
export function composerAffordances(
  caps: TransportCapabilitySet = surfaceCapabilities(),
): ComposerAffordances {
  return {
    attachments: caps.fileAttachment.supported,
    sendShortcut: caps.keyboardShortcuts.supported,
  };
}

/**
 * W30-d — whether the transcript receives assembled blocks or per-chunk edits.
 *
 * Handed straight to `StreamEventRouter`; see `sseManager`.
 */
export function blockDeliveryEntry(
  caps: TransportCapabilitySet = surfaceCapabilities(),
): TransportCapabilitySet['highLatencyBlockDelivery'] {
  return caps.highLatencyBlockDelivery;
}
