// ────────────────────────────────────────────────────────────────
// TransportCapabilities — W29 surface capability ledger.
//
// Every client surface (web, desktop, CLI, mobile, SDK) declares
// its capabilities here. The ledger distinguishes between:
//
//   enforced    — a probe registered for THIS surface drives the code
//                 that reads the flag and asserts the behaviour.
//                 These are RELIABLE: callers can depend on them.
//   aspirational — believed true; nothing checks it. This says nothing
//                 about `supported`: `aspirational(true)` means the
//                 surface does do this and no test holds it to that.
//                 Treat such a value as a comment, not a guarantee.
//
// Usage: import the capability object for your surface and read
// individual flags before calling surface-specific APIs.
//
// ── Where "enforced" is proved ───────────────────────────────────
// `enforced` means *a test asserts THIS SURFACE's runtime honours the
// declaration*. Two things follow, and both were violated before:
//
//   - A test that re-asserts the literal in this file proves nothing.
//   - A test that drives ONE surface proves nothing about another. The
//     claims are per (surface, field); so is the proof index.
//
// The probes:
//
//   packages/shared/__tests__/TransportCapabilities.test.ts
//       the STATIC half — every surface declares every field, every
//       field carries a classification, no surface has extra fields,
//       and every `enforced` pair names a proof carrying its marker.
//
//   packages/client-core/src/__tests__/capabilityEnforcement.test.ts
//       the RUNTIME half — drives the shared runtime once per surface
//       with that surface's own declaration. Covers `sse`,
//       `eventReplay` and `highLatencyBlockDelivery` for all five.
//       Lives in client-core because that is the layer that owns the
//       decisions and may import this package (shared may not import
//       client-core; the dependency only runs one way).
//
//   apps/web/src/__tests__/platform/surfaceCapabilities.test.tsx
//       web, plus desktop via an explicit parity assertion.
//
//   apps/mobile/src/__tests__/surfaceCapabilities.test.ts
//       mobile's wiring-level proofs.
//
// If you add a field here, add its per-surface assertion in the same
// change or classify it `aspirational` — those are the only two honest
// options, and `aspirational` is not a lesser one. Most of the cli,
// mobile and sdk columns are aspirational precisely because nothing
// drives them; saying so is the point.
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
  /**
   * Composer keyboard bindings — Enter to send, modifier+Enter for a newline.
   *
   * △ The doc used to read "⌘⏎ / Ctrl+Enter to send", which is the OPPOSITE
   * of what every surface implements: modifier+Enter inserts a newline and
   * plain Enter sends. That went unnoticed for as long as nothing read the
   * field. Wiring it is what surfaced it.
   */
  keyboardShortcuts: CapabilityEntry;
  /** Human-in-the-loop gate cards (plan approve / question answer). */
  hitlGates: CapabilityEntry;

  // ── Delivery ───────────────────────────────────────────────────
  /**
   * W30-d: block delivery on high-latency surfaces.
   *
   * When `true`, the surface prefers assembled blocks with a typing
   * indicator instead of per-chunk live edits, because editing one
   * message per chunk over a slow link reads as a stutter rather than
   * as typing.
   *
   * Read by `StreamEventRouter` (`packages/client-core`), which holds
   * partial text back to the last markdown block boundary and emits a
   * `setTyping` effect in its place. The router NEVER holds text across
   * an ordered event or a turn end, so the mode changes *when* text
   * lands, never *whether* it lands.
   */
  highLatencyBlockDelivery: CapabilityEntry;

  // ── Cross-tab / multi-window ───────────────────────────────────
  /** W09-b: shared EventSource across same-origin browser tabs. */
  crossTabEventSource: CapabilityEntry;
}

/** Every surface identifier the ledger knows about. */
export type SurfaceId = 'web' | 'desktop' | 'cli' | 'mobile' | 'sdk';

export const SURFACE_IDS: readonly SurfaceId[] = Object.freeze([
  'web',
  'desktop',
  'cli',
  'mobile',
  'sdk',
] as const);

// ── Surface declarations ──────────────────────────────────────────

/**
 * `enforced` — a registered probe drives THIS surface's declaration.
 *
 * Only legal when `ENFORCEMENT_PROOFS[surface][field]` names a file carrying
 * this pair's proof marker. `TransportCapabilities.test.ts` fails otherwise,
 * so `e()` cannot be typed into a cell that nothing checks.
 */
function e(supported: boolean): CapabilityEntry {
  return { supported, enforcement: 'enforced' };
}

/**
 * `aspirational` — the declaration is believed true but NOTHING CHECKS IT.
 *
 * Not a synonym for "unsupported": `a(true)` means the surface does do this
 * and no automated probe holds it to that. Read a value in this class as a
 * comment, not as a guarantee, and do not build a decision on it that would be
 * unsafe if it were stale.
 */
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
  // W09-b is unshipped, and the web probe asserts the runtime never reaches
  // for `BroadcastChannel` or `SharedWorker` — a declared `false` that a test
  // actually holds the runtime to is `enforced`, not `aspirational`.
  crossTabEventSource: e(false),
};

/**
 * Electron desktop surface (apps/desktop).
 *
 * Embeds the web SPA same-origin, so capabilities match the web surface — and
 * that equality is itself asserted (`surfaceCapabilities.test.tsx`'s parity
 * test), which is what makes each web probe a proof for desktop too rather
 * than an assumption about it.
 */
export const DESKTOP_CAPABILITIES: TransportCapabilitySet = {
  ...WEB_CAPABILITIES,
  // Desktop is always same-process; cross-tab sharing not relevant.
  crossTabEventSource: e(false),
};

/**
 * CLI / TUI surface (apps/cli).
 *
 * △ Five of this column's cells were wrong, all in the same direction: the TUI
 * was described as the thin, text-only client it stopped being. Every `false`
 * below that is now `true` was contradicted by shipped code, and each was
 * marked `enforced` while the only registered proof was a WEB test — so
 * nothing ever loaded the CLI to notice. The corrections:
 *
 *   - `websocketStreaming` — `apps/cli/src/terminal/attachLoop.ts:89` opens a
 *     real `new WebSocket(url)` against the server's PTY endpoint.
 *   - `terminalRendering` — the old comment "CLI IS a terminal — no nested
 *     panel" describes a TUI that no longer exists:
 *     `apps/cli/src/tui/terminalRender.tsx` walks an `@xterm/headless` cell
 *     buffer to draw a terminal pane INSIDE the TUI.
 *   - `keyboardShortcuts` — `apps/cli/src/tui/App.tsx:3120` binds a full
 *     chord keymap through `useKeymap`, with a leader mode.
 *   - `diffRendering` — `apps/cli/src/tui/panes.tsx:890+` renders a Changes
 *     pane with per-file add/remove counts and a diff body, not text-only
 *     output.
 *   - `browserPanelRendering` / `computerPanelRendering` — `panes.tsx:1278`
 *     (`BrowserPane`) and `panes.tsx:1340` (`ComputerPane`) render populated
 *     panels, fed by `App.tsx:1886` and `App.tsx:1984`. Worth naming the
 *     nuance rather than hiding it: both are on-demand snapshots (an
 *     accessibility-tree read, an inline PNG, a status table), not a streamed
 *     live view. `supported: true` is the honest answer to "can this surface
 *     draw the panel"; a caller needing continuous frames should read
 *     `websocketStreaming` instead, which is what that field is for.
 *
 * Only `sse`, `eventReplay` and `highLatencyBlockDelivery` are `enforced`
 * here, because they are the only three the shared client-core probe drives
 * per surface. The rest are `aspirational`: believed true on the evidence
 * above, checked by nothing.
 */
export const CLI_CAPABILITIES: TransportCapabilitySet = {
  sse: e(true),
  websocketStreaming: a(true),
  eventReplay: e(true),
  markdownRendering: a(true),  // panes.tsx:605 renders <Markdown>
  widgetRendering: a(false),   // widgetDegradation.ts:70 hardcodes renderable: false
  diffRendering: a(true),
  browserPanelRendering: a(true),
  computerPanelRendering: a(true),
  terminalRendering: a(true),
  fileAttachment: a(true),     // `--attach` (cli-core/src/commands/chat.ts:343) and /attach
  keyboardShortcuts: a(true),
  hitlGates: a(true),          // chat plan/question gates + run stage approval
  highLatencyBlockDelivery: e(false),
  crossTabEventSource: a(false), // one process, no tabs; nothing shares a stream
};

/**
 * React Native mobile surface (apps/mobile).
 *
 * The surface W30-d exists for: a phone on cellular is the only client
 * whose link latency routinely makes a per-chunk transcript edit read as
 * a stutter, so it is the one surface that declares
 * `highLatencyBlockDelivery`.
 *
 * The `false` entries are deliberate and each reflects real code:
 *   - widgets render as an explanatory placeholder, not a live frame
 *     (`apps/mobile/src/components/chat/BlockView.tsx:367` — a "Desktop only"
 *     badge; extension UI needs a separate-origin iframe, which RN has no
 *     equivalent of);
 *   - there is no computer-use panel on mobile (the only `computer` strings
 *     in `apps/mobile/src` are two scope labels);
 *   - `keyboardShortcuts` assumes a hardware keyboard we cannot assume, and
 *     the composer binds none: `Composer.tsx`'s message input is `multiline`
 *     with no `onSubmitEditing`, `onKeyPress` or `returnKeyType` — sending is
 *     `onPress` on the send button only.
 *
 * △ Two cells were wrong:
 *
 *   - `browserPanelRendering` was `false`, and the prose above used to say
 *     outright that mobile has no integrated browser panel. It does:
 *     `src/components/chat/workbench/BrowserSection.tsx` polls
 *     `browser/screencast.jpg` on a 2 s interval and renders it as an
 *     `<Image>` with back/forward/reload/address-bar controls, mounted at
 *     `Workbench.tsx:154`. Only pointer input is not forwarded.
 *   - `fileAttachment` was `enforced(true)` while mobile could not attach a
 *     file by any route — see the comment on the field below.
 */
export const MOBILE_CAPABILITIES: TransportCapabilitySet = {
  sse: e(true),
  websocketStreaming: a(true), // TerminalView.tsx:131 drives a real WebSocket
  eventReplay: e(true),        // SseClient/mux both resume from a cursor
  markdownRendering: a(true),  // components/markdown/Markdown.tsx, a real lexer
  widgetRendering: a(false),
  diffRendering: a(true),      // components/diff/DiffRowView.tsx
  browserPanelRendering: a(true),
  computerPanelRendering: a(false),
  terminalRendering: a(true),  // src/terminal/TerminalView.tsx (xterm in a WebView)
  /**
   * Mobile cannot attach a file, and this is the field that said it could.
   *
   * `Composer` renders an "Add attachment" button and takes an OPTIONAL
   * `onAttach`; `app/chats/[id].tsx` passes `attachAvailable`,
   * `attachDisabledReason` and a hardcoded `attachments={[]}` — and no
   * handler. So the button fell through to `props.onAttach ?? (() => {})`
   * and did nothing when tapped, on a surface whose ledger row read
   * `enforced(true)`.
   *
   * Corrected rather than wired: `apps/mobile` has no picker dependency at
   * all (no `expo-document-picker`, no `expo-image-picker`), and the send
   * path carries no files, so "wiring it up" means a new native module and a
   * new upload path — a feature, not a fix. Declaring the truth is the fix.
   * `enforced` because there is now a mobile-side probe that fails if either
   * half of this changes without the other:
   * `apps/mobile/src/__tests__/surfaceCapabilities.test.ts`.
   */
  fileAttachment: e(false),
  keyboardShortcuts: a(false),
  hitlGates: a(true),          // QuestionCard/PlanCard in app/chats/[id].tsx
  highLatencyBlockDelivery: e(true),
  crossTabEventSource: a(false), // no tabs
};

/**
 * SDK surface (packages/sdk / programmatic API callers).
 *
 * The SDK is headless. It delivers token deltas to the caller's callback
 * and has no rendering layer of its own, so every rendering field is `false`
 * by construction — verified absent, not merely assumed: `packages/sdk/src`
 * contains no `new WebSocket`, no JSX, no DOM and no `BroadcastChannel`.
 * (`AgentFacade.exportToMarkdown` serialises an agent definition; it does not
 * render markdown.)
 */
export const SDK_CAPABILITIES: TransportCapabilitySet = {
  sse: e(true),
  websocketStreaming: a(false),
  eventReplay: e(true),
  markdownRendering: a(false),
  widgetRendering: a(false),
  diffRendering: a(false),
  browserPanelRendering: a(false),
  computerPanelRendering: a(false),
  terminalRendering: a(false),
  /**
   * △ Was `enforced(true)`. There is no message-with-attachments path in the
   * SDK: `ChatFacade.send(chatId, message: string)` takes a string and calls
   * `sendPrompt`. The two near-misses are not this capability —
   * `HookResult.attachments` are files a hook writes into the workspace, and
   * `ProjectFacade.uploadConfig` uploads a project config file. And the field
   * is defined as a file PICKER (drag-and-drop or an OS dialog), which a
   * headless library cannot have by construction.
   */
  fileAttachment: a(false),
  keyboardShortcuts: a(false),
  /**
   * The old comment — "callback-based HITL possible but not yet implemented"
   * — was wrong: `HitlFacade.resume(stageRunId, workflowRunId, { approved,
   * value, reason })` is implemented and wired, so a caller CAN answer a gate.
   * What it cannot do is enumerate pending ones: `HitlService.listPending`
   * exists but is not forwarded by the facade, reachable only through the
   * `@internal UNSTABLE` `services` escape hatch. And this field means gate
   * CARDS — a rendering affordance the SDK has no layer for. `false` stands;
   * the reason it stands did not.
   */
  hitlGates: a(false),
  highLatencyBlockDelivery: e(true), // SDK callers are presumed high-latency by default
  crossTabEventSource: a(false),
};

// ── The proof index ───────────────────────────────────────────────
//
// ⚠ WHAT THIS MECHANISM CAN AND CANNOT PROVE — read before trusting it.
//
// It CANNOT prove a registered test asserts anything. Nothing that inspects a
// file from outside can: proving "this test would fail if the runtime stopped
// honouring the declaration" is mutation testing, and this is not that.
//
// What it CAN do, and what the previous version did not, is refuse to be
// satisfied by accident. That version was a raw substring scan — it asked only
// whether `readFileSync(proof).includes(field)` — and it produced false passes
// three different ways:
//
//   1. A prose mention passed. A field named in a `describe` title, an import
//      list, or a comment satisfied the check with no assertion anywhere.
//   2. A SUBSTRING passed. `'asserts'.includes('sse')` is `true` in JavaScript,
//      so `sse`'s claim was discharged by any file containing the word
//      "asserts" — which is every test file in the repo.
//   3. The map was keyed per FIELD while `enforcement` is declared per
//      (surface, field). One web-only probe therefore discharged the same
//      field's claim on cli, mobile and sdk, none of which it ever loaded.
//
// So the index below is keyed per surface AND field, and a proof file must
// carry the exact marker token for that pair:
//
//     @capability-proof mobile/fileAttachment
//
// A marker is a deliberate act — it cannot be produced by prose, by a
// substring, or by a probe for a different surface. Place it INSIDE the block
// that does the asserting, never in a file header, so that deleting the
// assertions and leaving the marker reads as the mistake it is in review.
//
// The honest summary: a marker proves a REGISTRATION, and the registration
// points at a probe that a human wrote to drive real code. Everything the
// probes assert is asserted by the probes. This index's whole job is to make
// sure a claim cannot go unregistered, and cannot be registered by accident.

/** Prefix of the token a proof file must carry. */
export const CAPABILITY_PROOF_MARKER = '@capability-proof';

/** The exact token that discharges one (surface, field) claim. */
export function capabilityProofMarker(
  surface: SurfaceId,
  field: keyof TransportCapabilitySet,
): string {
  return `${CAPABILITY_PROOF_MARKER} ${surface}/${field}`;
}

/**
 * Matcher for that token.
 *
 * The trailing boundary is what stops `web/markdownRendering` from also
 * discharging a hypothetical `web/markdownRenderingV2` — the prefix-matching
 * bug one level up from the substring bug this replaced.
 */
export function capabilityProofPattern(
  surface: SurfaceId,
  field: keyof TransportCapabilitySet,
): RegExp {
  return new RegExp(`${CAPABILITY_PROOF_MARKER}\\s+${surface}/${field}(?![A-Za-z0-9_])`);
}

/** Repo-relative proof paths, per surface, per capability. */
export type CapabilityProofIndex = Readonly<
  Record<SurfaceId, Readonly<Partial<Record<keyof TransportCapabilitySet, readonly string[]>>>>
>;

const CLIENT_CORE_PROBE = 'packages/client-core/src/__tests__/capabilityEnforcement.test.ts';
const WEB_PROBE = 'apps/web/src/__tests__/platform/surfaceCapabilities.test.tsx';
const MOBILE_PROBE = 'apps/mobile/src/__tests__/surfaceCapabilities.test.ts';

/**
 * Every (surface, field) claim that a probe actually drives.
 *
 * A pair absent from this index MUST be declared `aspirational`. That is the
 * rule the static test enforces in both directions, and it is why the cli,
 * mobile and sdk columns are mostly aspirational below: those surfaces have
 * three shared probes between them (`sse`, `eventReplay`,
 * `highLatencyBlockDelivery`, all driven per surface in `CLIENT_CORE_PROBE`)
 * and nothing else. Marking the rest `enforced` did not make them checked; it
 * only made them look checked.
 */
export const ENFORCEMENT_PROOFS: CapabilityProofIndex = Object.freeze({
  web: Object.freeze({
    sse: [CLIENT_CORE_PROBE],
    eventReplay: [CLIENT_CORE_PROBE],
    highLatencyBlockDelivery: [CLIENT_CORE_PROBE],
    websocketStreaming: [WEB_PROBE],
    markdownRendering: [WEB_PROBE],
    widgetRendering: [WEB_PROBE],
    diffRendering: [WEB_PROBE],
    browserPanelRendering: [WEB_PROBE],
    computerPanelRendering: [WEB_PROBE],
    terminalRendering: [WEB_PROBE],
    fileAttachment: [WEB_PROBE],
    keyboardShortcuts: [WEB_PROBE],
    hitlGates: [WEB_PROBE],
    crossTabEventSource: [WEB_PROBE],
  }),
  // Desktop serves the identical bundle same-origin, so the web probes cover
  // it — but only for the fields the probe's parity assertion actually pins.
  // That assertion is the proof; without it "desktop is like web" would be a
  // comment, and a divergence would silently uncover every field below.
  desktop: Object.freeze({
    sse: [CLIENT_CORE_PROBE],
    eventReplay: [CLIENT_CORE_PROBE],
    highLatencyBlockDelivery: [CLIENT_CORE_PROBE],
    websocketStreaming: [WEB_PROBE],
    markdownRendering: [WEB_PROBE],
    widgetRendering: [WEB_PROBE],
    diffRendering: [WEB_PROBE],
    browserPanelRendering: [WEB_PROBE],
    computerPanelRendering: [WEB_PROBE],
    terminalRendering: [WEB_PROBE],
    fileAttachment: [WEB_PROBE],
    keyboardShortcuts: [WEB_PROBE],
    hitlGates: [WEB_PROBE],
    crossTabEventSource: [WEB_PROBE],
  }),
  cli: Object.freeze({
    sse: [CLIENT_CORE_PROBE],
    eventReplay: [CLIENT_CORE_PROBE],
    highLatencyBlockDelivery: [CLIENT_CORE_PROBE],
  }),
  mobile: Object.freeze({
    sse: [CLIENT_CORE_PROBE],
    eventReplay: [CLIENT_CORE_PROBE],
    highLatencyBlockDelivery: [CLIENT_CORE_PROBE],
    fileAttachment: [MOBILE_PROBE],
  }),
  sdk: Object.freeze({
    sse: [CLIENT_CORE_PROBE],
    eventReplay: [CLIENT_CORE_PROBE],
    highLatencyBlockDelivery: [CLIENT_CORE_PROBE],
  }),
});

/** How much of the ledger is actually checked. Used by the static test's report. */
export function capabilityProofCoverage(
  ledger: Readonly<Record<SurfaceId, TransportCapabilitySet>>,
): { proven: string[]; unproven: string[] } {
  const proven: string[] = [];
  const unproven: string[] = [];
  for (const surface of SURFACE_IDS) {
    const caps = ledger[surface];
    for (const field of Object.keys(caps) as Array<keyof TransportCapabilitySet>) {
      const registered = ENFORCEMENT_PROOFS[surface][field]?.length ?? 0;
      (registered > 0 ? proven : unproven).push(`${surface}/${field}`);
    }
  }
  return { proven, unproven };
}

/**
 * Return the capability set for the named surface.
 * Falls back to the most restrictive (SDK) for unknown surface identifiers.
 */
export function capabilitiesFor(
  surface: SurfaceId | string,
): TransportCapabilitySet {
  switch (surface) {
    case 'web': return WEB_CAPABILITIES;
    case 'desktop': return DESKTOP_CAPABILITIES;
    case 'cli': return CLI_CAPABILITIES;
    case 'mobile': return MOBILE_CAPABILITIES;
    case 'sdk': return SDK_CAPABILITIES;
    default: return SDK_CAPABILITIES;
  }
}
