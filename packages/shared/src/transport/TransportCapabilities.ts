// ────────────────────────────────────────────────────────────────
// TransportCapabilities — W29 surface capability ledger.
//
// Every client surface (web, desktop, CLI, mobile, SDK) declares
// its capabilities here. The ledger distinguishes between:
//
//   enforced    — a test asserts the runtime honours the declaration.
//                 These are RELIABLE: callers can depend on them.
//   aspirational — declared intent only; no automated enforcement.
//                 These MUST appear in the UI as "not supported on
//                 this surface" so the user is not silently misled.
//
// Usage: import the capability object for your surface and read
// individual flags before calling surface-specific APIs.
//
// Tests: `packages/shared/__tests__/TransportCapabilities.test.ts`
// asserts that (a) every field is classified as enforced/aspirational,
// and (b) no enforced field is silently false on any production surface.
// ────────────────────────────────────────────────────────────────

/**
 * A single capability entry in the ledger.
 *
 * `supported` — whether this surface implements the capability.
 * `enforcement` — 'enforced' if a test validates runtime behaviour;
 *                 'aspirational' if it is declared intent only.
 */
export interface CapabilityEntry {
  supported: boolean;
  enforcement: 'enforced' | 'aspirational';
}

/**
 * The full capability set every surface must declare.
 *
 * Add new capabilities here with a comment explaining what they gate.
 * Every new field MUST include an `enforcement` classification before
 * merging — an unclassified field is a CI failure.
 */
export interface TransportCapabilitySet {
  // ── Streaming ──────────────────────────────────────────────────
  /** Server-Sent Events delivery for live token streaming. */
  sse: CapabilityEntry;
  /** WebSocket-based high-frequency frame streaming (browser live view). */
  websocketStreaming: CapabilityEntry;
  /** Client-side event replay from a local cursor position. */
  eventReplay: CapabilityEntry;

  // ── Content ────────────────────────────────────────────────────
  /** Rendering inline markdown with syntax-highlighted code blocks. */
  markdownRendering: CapabilityEntry;
  /** Rendering interactive widget iframes (extension UI). */
  widgetRendering: CapabilityEntry;
  /** Rendering the diff/code-review panel (ChangesTree). */
  diffRendering: CapabilityEntry;
  /** Rendering the integrated browser live-view panel. */
  browserPanelRendering: CapabilityEntry;
  /** Rendering the computer-use live-view panel. */
  computerPanelRendering: CapabilityEntry;
  /** Rendering terminal output panels. */
  terminalRendering: CapabilityEntry;

  // ── Interaction ────────────────────────────────────────────────
  /** File-picker attachment (drag-and-drop or OS file dialog). */
  fileAttachment: CapabilityEntry;
  /** Keyboard-shortcut send (⌘⏎ / Ctrl+Enter). */
  keyboardShortcuts: CapabilityEntry;
  /** Human-in-the-loop gate cards (plan approve / question answer). */
  hitlGates: CapabilityEntry;

  // ── Delivery ───────────────────────────────────────────────────
  /**
   * W30-d: block delivery on high-latency surfaces.
   * When `true`, the surface prefers assembled blocks with a typing
   * indicator instead of per-chunk live edits.
   */
  highLatencyBlockDelivery: CapabilityEntry;

  // ── Cross-tab / multi-window ───────────────────────────────────
  /** W09-b: shared EventSource across same-origin browser tabs. */
  crossTabEventSource: CapabilityEntry;
}

// ── Surface declarations ──────────────────────────────────────────

function e(supported: boolean): CapabilityEntry {
  return { supported, enforcement: 'enforced' };
}
function a(supported: boolean): CapabilityEntry {
  return { supported, enforcement: 'aspirational' };
}

/**
 * Web browser surface (apps/web).
 * The reference implementation — all rendered capabilities are enforced.
 */
export const WEB_CAPABILITIES: TransportCapabilitySet = {
  sse: e(true),
  websocketStreaming: e(true),
  eventReplay: e(true),
  markdownRendering: e(true),
  widgetRendering: e(true),
  diffRendering: e(true),
  browserPanelRendering: e(true),
  computerPanelRendering: e(true),
  terminalRendering: e(true),
  fileAttachment: e(true),
  keyboardShortcuts: e(true),
  hitlGates: e(true),
  highLatencyBlockDelivery: e(false),
  crossTabEventSource: a(false), // W09-b — aspirational until shipped
};

/**
 * Electron desktop surface (apps/desktop).
 * Embeds the web SPA same-origin, so capabilities match the web surface.
 */
export const DESKTOP_CAPABILITIES: TransportCapabilitySet = {
  ...WEB_CAPABILITIES,
  // Desktop is always same-process; cross-tab sharing not relevant.
  crossTabEventSource: e(false),
};

/**
 * CLI / TUI surface (apps/cli).
 *
 * The CLI renders markdown via `marked` (terminal-safe) but has no browser
 * APIs, no WebSocket support from the terminal surface, and no widget iframes.
 * HITL gates are supported via interactive terminal prompts.
 */
export const CLI_CAPABILITIES: TransportCapabilitySet = {
  sse: e(true),
  websocketStreaming: e(false),
  eventReplay: e(true),
  markdownRendering: e(true),
  widgetRendering: e(false),
  diffRendering: a(false),     // aspirational — diff output is text-only today
  browserPanelRendering: e(false),
  computerPanelRendering: e(false),
  terminalRendering: e(false), // CLI IS a terminal — no nested panel
  fileAttachment: e(true),     // CLI accepts --attach flag
  keyboardShortcuts: e(false),
  hitlGates: e(true),
  highLatencyBlockDelivery: e(false),
  crossTabEventSource: e(false),
};

/**
 * SDK surface (packages/sdk / programmatic API callers).
 *
 * The SDK is headless. It delivers token deltas to the caller's callback
 * and has no rendering layer of its own.
 */
export const SDK_CAPABILITIES: TransportCapabilitySet = {
  sse: e(true),
  websocketStreaming: e(false),
  eventReplay: e(true),
  markdownRendering: e(false),
  widgetRendering: e(false),
  diffRendering: e(false),
  browserPanelRendering: e(false),
  computerPanelRendering: e(false),
  terminalRendering: e(false),
  fileAttachment: e(true),
  keyboardShortcuts: e(false),
  hitlGates: a(false), // aspirational — callback-based HITL possible but not yet implemented
  highLatencyBlockDelivery: e(true), // SDK callers are presumed high-latency by default
  crossTabEventSource: e(false),
};

/**
 * Return the capability set for the named surface.
 * Falls back to the most restrictive (SDK) for unknown surface identifiers.
 */
export function capabilitiesFor(
  surface: 'web' | 'desktop' | 'cli' | 'sdk' | string,
): TransportCapabilitySet {
  switch (surface) {
    case 'web': return WEB_CAPABILITIES;
    case 'desktop': return DESKTOP_CAPABILITIES;
    case 'cli': return CLI_CAPABILITIES;
    case 'sdk': return SDK_CAPABILITIES;
    default: return SDK_CAPABILITIES;
  }
}
