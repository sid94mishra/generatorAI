// ────────────────────────────────────────────────────────────────
// ComputerUse — wire + domain types for driving native desktop apps.
//
// These types are deliberately provider-neutral: nothing here names
// cua-driver, Electron, AX, UIA or AT-SPI. `IComputerBridge` adapters
// translate their provider's vocabulary into this shape so `services/`
// and `tools/` never see a vendor type (INV-1).
//
// Two invariants are encoded structurally rather than by convention:
//
//   1. Element addressing is fenced by `snapshotId`. An element index is
//      only meaningful inside the snapshot that produced it; the bridge
//      rejects a stale id instead of clicking whatever now sits at that
//      index. This removes the entire "index 12 meant something else two
//      turns ago" bug class.
//   2. Every action reports the `path` it took and whether the result was
//      verified by read-back. A caller can therefore tell a semantic,
//      background-safe action apart from synthetic input that took over
//      the user's pointer — the two have very different risk profiles.
// ────────────────────────────────────────────────────────────────

/**
 * How an action was actually delivered to the target application.
 *
 * - `accessibility` — semantic action via the platform a11y API. Runs in the
 *   background, never moves the cursor, and is verifiable by read-back.
 * - `hit-tested`    — caller supplied coordinates; the bridge resolved them to
 *   an accessibility element and dispatched semantically. Still background-safe.
 * - `synthetic`     — OS-level input events. Requires the target to be focused
 *   and TAKES OVER the user's pointer/keyboard. Never verifiable.
 * - `clipboard`     — text delivered through the system clipboard (saved and
 *   restored around the paste).
 */
export type ComputerActionPath = 'accessibility' | 'hit-tested' | 'synthetic' | 'clipboard';

/**
 * Why an action was refused. Refusals are a first-class, typed outcome — not
 * an exception — because the agent is expected to reason about them and pick a
 * different strategy (re-snapshot, focus the window, ask the user, give up).
 */
export type ComputerRefusalCode =
  /** Provider cannot drive this target without foreground input at all. */
  | 'background_unavailable'
  /** Target is covered by another window; a background hit-test is unsafe. */
  | 'background_occluded'
  /** Windows UIPI blocked the call (target runs at higher integrity). */
  | 'background_uipi_blocked'
  /** Target app is on the blocklist (password managers, terminals, our own UI). */
  | 'app_blocked'
  /** User declined the consent prompt, or a stored deny grant matched. */
  | 'consent_denied'
  /** Nobody answered the consent prompt before it expired (not a denial: nothing is stored). */
  | 'consent_expired'
  /** Action needs focus (synthetic input) and the target is not frontmost. */
  | 'target_not_focused'
  /** No bridge is available — server/CI, no desktop attached, feature off. */
  | 'provider_unavailable'
  /** The supplied snapshotId is unknown or has been superseded. */
  | 'stale_snapshot'
  /** The snapshot is current, but the element does not expose the named action. */
  | 'unsupported_action'
  /** Concurrency cap reached, or the action exceeded `actionTimeoutMs`. */
  | 'capacity_exhausted'
  /** Provider accepted the call but the target vanished mid-flight. */
  | 'target_lost'
  /** The user paused the agent on this computer (G-07). */
  | 'agent_paused'
  /** The user has taken over this computer (G-07). */
  | 'user_in_control';

/**
 * Result of reading a property back after writing it.
 *
 * Both string fields are PREVIEWS — truncated and passed through redaction.
 * Neither may carry the literal text the agent typed: a "License key" or
 * "Token" field is rarely flagged `secure` by the platform, so an
 * un-contracted `expected` would put credentials verbatim into events, audit
 * rows and the chat transcript.
 */
export interface ComputerVerification {
  state: 'verified' | 'unverified';
  /** Which property was read back to confirm the write. */
  property?: 'value' | 'selection' | 'focusedText' | 'toggleState';
  expectedPreview?: string | null;
  actualPreview?: string | null;
  reason?: 'synthetic_input' | 'clipboard_paste' | 'window_changed' | 'value_mismatch' | 'not_readable';
}

/** A single node in a window's accessibility tree. */
export interface ComputerElement {
  /** Stable ONLY within the owning `ComputerSnapshot`. */
  index: number;
  /** Normalised role — 'button', 'textField', 'checkbox', 'list', … */
  role: string;
  title?: string;
  label?: string;
  /**
   * True when the platform reports this as a password/secure field
   * (AXSecureTextField, UIA IsPassword, AT-SPI PASSWORD).
   */
  secure: boolean;
  /**
   * Current value, or `null` when unreadable OR redacted.
   *
   * Required and nullable rather than optional so `secure === true ⇒ value ===
   * null` is a single assertion enforceable at the bridge boundary. With an
   * optional field, "the adapter forgot to populate it" and "we redacted it"
   * are indistinguishable, and one of those is a leak.
   */
  value: string | null;
  placeholder?: string;
  /** 'focused', 'disabled', 'selected', 'offscreen', … */
  traits: string[];
  /** Actions the element advertises — the allowlist for `performAction`. */
  actions: string[];
  childCount: number;
  bounds?: { x: number; y: number; w: number; h: number };
  /**
   * Provider-opaque handle for this element in this snapshot. Never shown to
   * the model — it addresses by `index` — but preferred on the wire to the
   * provider, because a superseded handle is refused explicitly instead of
   * silently addressing whatever now occupies that index.
   */
  token?: string;
}

export interface ComputerAppInfo {
  /** Bundle id (macOS) / executable or AUMID (Windows) / desktop id (Linux). */
  id: string;
  name: string;
  pid: number;
  /**
   * Absolute path to the backing binary when the provider can supply it.
   * Without this the blocklist's executable dimension is dead — an app that
   * spoofs both its id and its name still runs from a recognisable binary.
   */
  executablePath?: string;
  /** True when the app currently owns the frontmost window. */
  frontmost: boolean;
  windowCount: number;
}

export interface ComputerWindowInfo {
  id: number;
  title: string;
  /** Position within the app's window list — stable enough for one turn. */
  index: number;
  focused: boolean;
  minimised: boolean;
  bounds?: { x: number; y: number; w: number; h: number };
}

export interface ComputerSnapshot {
  /**
   * Opaque fence token. Element indices in `elements` are valid only while
   * this id is the newest snapshot for the same window.
   */
  snapshotId: string;
  app: Pick<ComputerAppInfo, 'id' | 'name' | 'pid'>;
  window: Pick<ComputerWindowInfo, 'id' | 'title' | 'index' | 'focused'>;
  elements: ComputerElement[];
  /** Non-null when caps clipped the tree — tells the agent to narrow scope. */
  truncated: { elements: number; depth: number } | null;
  capturedAt: number;
}

export interface ComputerScreenshot {
  /** What is on disk. The driver writes `png`; we may re-encode (X-14). */
  format: 'png' | 'jpeg' | 'webp';
  width: number;
  height: number;
  /** Backing-scale factor of the capture (2 on Retina). */
  scale: number;
  /**
   * Source pixels per stored pixel, 1 when the capture was not resized.
   * A coordinate the model reports against this image is multiplied by this
   * to reach the driver's space — the mapping only stays correct because WE
   * do the downscale rather than letting the provider do it silently (X-14).
   */
  downscale?: number;
  /** Workspace-relative artifact path. Written before the event fires (INV-3). */
  path?: string;
  artifactId?: string;
  /** True when the capture was dropped for exceeding the byte budget. */
  dataOmitted?: boolean;
  /**
   * X-16 — this frame is byte-identical to the previous capture, so `path` and
   * `artifactId` point at the frame it duplicates rather than at a new file.
   *
   * Surfaced to the model in the tool payload, because the expensive failure is
   * not the wasted tokens: an agent that cannot tell "nothing happened" from
   * "I have not looked yet" re-clicks a button it already submitted.
   */
  unchanged?: boolean;
  engine?: string;
}

export interface ComputerActionResult {
  ok: boolean;
  snapshot: ComputerSnapshot | null;
  screenshot: ComputerScreenshot | null;
  action?: {
    path: ComputerActionPath;
    /** Provider-side action name, for the audit trail. */
    actionName?: string;
    verification?: ComputerVerification;
    durationMs?: number;
    /**
     * Which rung the provider says to try next, translated into this API's
     * vocabulary. Present only when the provider volunteered one, so its
     * absence means "no advice", never "nothing left to try".
     */
    nextStep?: { rung: 'coordinate' | 'foreground' | 'browser'; reason: string };
  };
  refusal?: { code: ComputerRefusalCode; message: string };
}

/**
 * User decision for a single consent prompt.
 *
 * `allow_run` is the only one that covers synthetic input without being asked
 * again: it lasts for the current chat's desktop session and is dropped when
 * that session ends, so it cannot outlive the work it was granted for.
 */
export type ComputerConsentDecision = 'allow_once' | 'allow_run' | 'always_allow' | 'deny';

/** Persisted per-app grant. `allow_once` is never stored. */
export type ComputerGrantDecision = 'always_allow' | 'deny';

/**
 * Which applications a consent answer covers (G-07, the board's "Queue
 * Inspector only / Any app" segment):
 * - `app` — only the application the prompt named;
 * - `any` — any application. An `always_allow` with `any` is stored as a
 *   grant on `COMPUTER_ANY_APP`; an `allow_run` with `any` covers every app for
 *   the rest of the run. A deny is always per app.
 *
 * Omitted, an answer keeps each decision's historical reach
 * (`defaultConsentReach`): `allow_run` any app, everything else this app.
 */
export type ComputerConsentReach = 'app' | 'any';

/** The grant key an `always_allow` for any application is stored under. */
export const COMPUTER_ANY_APP = '*';

export function defaultConsentReach(decision: ComputerConsentDecision): ComputerConsentReach {
  return decision === 'allow_run' ? 'any' : 'app';
}

/** One planned action of a batched request, answered once for the batch (G-07). */
export interface ComputerConsentPlanStep {
  /** Action type, e.g. `clickPoint`, `typeText`, `pressKey`. */
  action: string;
  /** Human-readable target (element label or point), never typed content. */
  target?: string;
}

/**
 * A consent prompt still awaiting an answer — the `computer.consent_required`
 * payload and a row of `GET /workspaces/:id/computer/consent` (`{ pending }`).
 */
export interface ComputerPendingConsent {
  requestId: string;
  workspaceId: string;
  chatId?: string;
  appIdentity: string;
  appLabel: string;
  action: string;
  /** Short, human-readable description of what is about to happen. */
  summary: string;
  /** `synthetic` prompts (they take the pointer/keyboard) can never be answered `always_allow`. */
  path: 'synthetic' | 'accessibility';
  /** Present when one request carries several actions; the answer covers all of them. */
  plan?: ComputerConsentPlanStep[];
  expiresAt: number;
}

/** `POST /workspaces/:id/computer/consent` body. */
export interface ComputerConsentAnswer {
  requestId: string;
  appIdentity: string;
  decision: ComputerConsentDecision;
  /** Omitted = `defaultConsentReach(decision)`. */
  scope?: ComputerConsentReach;
}

/** `POST /workspaces/:id/computer/consent` → 200. */
export interface ComputerConsentAnswerResult {
  ok: true;
  requestId: string;
  decision: ComputerConsentDecision;
  scope: ComputerConsentReach;
}

/** A standing grant (`GET /workspaces/:id/computer/grants` → `{ grants }`). */
export interface ComputerGrant {
  /** `COMPUTER_ANY_APP` (`'*'`) for a grant that covers any application. */
  appIdentity: string;
  appLabel: string;
  decision: ComputerGrantDecision;
  /** read = "Screen"; mutate / synthetic = "Keyboard & mouse". */
  scope: 'read' | 'mutate' | 'synthetic';
  grantedAt: string;
  lastUsedAt: string | null;
}

/**
 * Who drives the desktop of a workspace (G-07 "Pause agent" / "Take over"):
 * - `agent`  — the agent may act (default);
 * - `paused` — the agent is held: every desktop operation is refused
 *   (`agent_paused`) until the user resumes;
 * - `user`   — the user has taken over the pointer and keyboard: refused as
 *   `user_in_control` until the user hands back.
 */
export const COMPUTER_CONTROL_MODES = ['agent', 'paused', 'user'] as const;
export type ComputerControlMode = (typeof COMPUTER_CONTROL_MODES)[number];

/** `GET|POST /workspaces/:id/computer/control`, and the `computer.control_changed` payload. */
export interface ComputerControlState {
  workspaceId: string;
  mode: ComputerControlMode;
  /** Epoch ms of the last change; null while it has never changed (agent by default). */
  changedAt: number | null;
}

export interface ComputerCapabilities {
  platform: string;
  provider: string;
  providerVersion: string;
  /** Populated on Linux — 'x11' | 'wayland-sway' | 'wayland-gnome' | 'wayland-kde'. */
  displayServer?: string;
  supports: {
    listApps: boolean;
    listWindows: boolean;
    snapshot: boolean;
    screenshot: boolean;
    elementBounds: boolean;
    backgroundClick: boolean;
    backgroundType: boolean;
    setValue: boolean;
    performAction: boolean;
    scroll: boolean;
    drag: boolean;
    hotkey: boolean;
    pasteText: boolean;
  };
  /** Human-readable notes surfaced to the agent, e.g. "KDE: no window rects". */
  limitations: string[];
}
