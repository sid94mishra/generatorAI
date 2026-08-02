// ────────────────────────────────────────────────────────────────
// BrowserSession — Integrated Browser value objects (pure TS)
//
// A browser session is a *resource* attached to an ExecutionWorkspace, not
// its own top-level execution entity. The workspace's `browser_*` columns
// carry the session state; `BrowserSession` is the DTO/value-object shape
// used across services, routes, and the SDK/CLI/web UI.
//
// Zero external imports — this file lives in `@generatorai/shared` and is
// consumed by both the server (packages/core) and the browser (apps/web).
// ────────────────────────────────────────────────────────────────

import type { BrowserSessionStatus } from './Workspace.js';

export type { BrowserSessionStatus };

/**
 * Which surface hosts the underlying Chromium process for a session.
 *
 * - `native`    → Electron's own Chromium hosts a `WebContentsView` in the
 *                 desktop main process. User sees native pixels; the agent
 *                 attaches via a per-tab scoped CDP proxy (never an app-wide
 *                 debugging port).
 * - `screencast`→ The server spawns a headed/headless Playwright Chromium and
 *                 streams frames to the web SPA over an MJPEG endpoint. User
 *                 input is forwarded via CDP; the agent uses the same CDP.
 * - `off`       → No browser attached (default for chats/runs that don't need
 *                 the feature).
 */
export type BrowserMode = 'native' | 'screencast' | 'off';

/**
 * A cookie ready to hand to Playwright's `context.addCookies()` — the
 * shape `CookieImport` produces and `IBrowserBridge.addCookies` consumes.
 * Lives here (not in `packages/core`) so the domain port doesn't have to
 * import from infrastructure to describe its own method signature.
 */
export interface ImportedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds. Absent = session cookie. */
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Serialisable configuration a workspace/chat/stage can attach to opt in
 * to the browser feature. All fields are optional; sensible defaults are
 * applied server-side by `BrowserService.resolveConfig()`.
 */
export interface BrowserConfig {
  /** Master switch. Default false. */
  enabled?: boolean;
  /**
   * Rendering strategy preference. `auto` (default) picks `native` when
   * running under Electron and `screencast` otherwise. Explicit values
   * force the choice and error if unavailable.
   */
  mode?: 'auto' | 'native' | 'screencast';
  /**
   * User-facing visibility knob. Preferred over the low-level `headless`
   * flag because it also drives UX behaviour:
   *
   *  - `'visible'`  → Chromium runs headed (visible via MJPEG/WCV); the
   *                   SPA auto-opens the Browser tab in the right pane so
   *                   the user watches the agent live.
   *  - `'headless'` → Chromium runs headless (invisible OS window); the
   *                   Browser tab is available but stays closed unless
   *                   the user opens it. **Default.** Fast and safe.
   *  - `'off'`      → Do NOT auto-start Chromium on chat/run create; the
   *                   first tool-invocation from the LLM lazily starts
   *                   a headless session on demand.
   *
   * When set, this takes precedence over the raw `headless` field:
   * `visibility === 'visible'` implies `headless: false`, and
   * `visibility === 'headless' | 'off'` implies `headless: true`.
   */
  visibility?: 'visible' | 'headless' | 'off';
  /**
   * Launch headless (no visible OS window on the server). Only meaningful
   * in `screencast` mode. Default true on server, ignored in native mode.
   *
   * Prefer `visibility` for new code — this remains for backward compat
   * and can still be set explicitly by advanced callers. When both are
   * set, `visibility` wins (see `BrowserService.resolveConfig`).
   */
  headless?: boolean;
  viewport?: { width: number; height: number };
  /**
   * Domain allowlist enforced in the `beforeBrowserAction` hook + URL bar
   * preflight. Uses simple glob-style host matching, e.g. `["*.github.com",
   * "example.com"]`. Empty array / undefined means allow-all.
   */
  allowedHosts?: string[];
  /**
   * Whether to persist the browser profile across workspaces of the same
   * project. Default false (isolated per-workspace).
   */
  persistProfile?: boolean;
  /** Screencast frame rate, 1–15. Default 5. */
  screencastFps?: number;
  /** JPEG quality for screencast frames, 20–95. Default 60. */
  screencastQuality?: number;
  /** Auto-pause the screencast when idle for this many minutes. Default 5. */
  idlePauseMinutes?: number;
  /**
   * Whether `playwright-cli eval` / `run-code` is allowed. Default false.
   * Even when true, `beforeBrowserAction` may still veto by policy.
   */
  evalAllowed?: boolean;
  /** Dialog handling policy for `page.on('dialog')`. Default `dismiss`. */
  dialogPolicy?: 'dismiss' | 'accept' | 'ask';
  /** Permissions to grant to the browser context (geo/cam/mic/clipboard/…). */
  permissions?: string[];
  /** Best-effort PII redaction on DOM/HAR captures. Default false. */
  piiRedaction?: boolean;
  /** Prompt-injection defense on read_page/DOM outputs. Default `off`. */
  injectionDefense?: 'off' | 'classifier';
  /** Record a WebM video of the session. Default false. */
  recordVideo?: boolean;
  /**
   * Trust self-signed/invalid TLS certs — for hitting a developer's own
   * `https://localhost:PORT` dev server. Default false (opt-in per
   * workspace/chat, never a global default).
   *
   * The name is enforced, not aspirational: Playwright's underlying
   * `ignoreHTTPSErrors` context option has no per-origin form, so while
   * this is on the bridge refuses top-level `https://` navigation to any
   * non-loopback host. That way an invalid certificate on a public origin
   * can never be accepted silently — only loopback traffic, which cannot
   * have been intercepted in transit, skips validation. Sub-resources of a
   * loopback page are still covered by the context-wide switch.
   *
   * Desktop/native mode scopes this independently (Electron's
   * `certificate-error` handler checks the actual hostname before
   * accepting).
   */
  allowLocalhostSelfSigned?: boolean;
}

/**
 * Descriptor returned to clients when they ask "how do I attach to this
 * workspace's browser?". Callers use this to render the right widget:
 * `mode === 'native'` → attach a `WebContentsView` at `bounds` via desktop
 * IPC. `mode === 'screencast'` → open the MJPEG endpoint at
 * `<baseUrl>/api/workspaces/:id/browser/screencast.mjpg`.
 */
export interface BrowserSessionDescriptor {
  workspaceId: string;
  status: BrowserSessionStatus;
  mode: BrowserMode;
  /** Loopback CDP endpoint URL. Redacted for external clients — server only. */
  cdpEndpoint?: string;
  /** CDP `targetId` of the top-level page under agent+user control. */
  targetId?: string;
  currentUrl?: string;
  viewport?: { width: number; height: number };
  ready: boolean;
  /**
   * VSCode-parity "Share with Agent" state. When `false`, the agent's
   * built-in browser tools return an error instead of driving this
   * session. Auto-flips back to `true` on the next user prompt (see
   * `ChatManagementService.sendPrompt`). Defaults to `true` on the
   * server; older clients / DB-only descriptors omit it.
   */
  attachedToChat?: boolean;
}

/**
 * A single "action" the agent (or user) performed against the shared page,
 * captured by the CDP interceptor + artifact watcher. Persisted as an
 * `AgentEvent` (`browser.action_completed`) with a pointer to any produced
 * artifact (screenshot/DOM/HAR).
 */
export type BrowserActionKind =
  | 'navigate'
  | 'reload'
  | 'back'
  | 'forward'
  | 'click'
  | 'type'
  | 'fill'
  | 'select'
  | 'hover'
  | 'scroll'
  | 'press'
  | 'snapshot'
  | 'screenshot'
  | 'eval'
  | 'inspector_selection'
  | 'dialog'
  | 'download';

export interface BrowserAction {
  kind: BrowserActionKind;
  /** Target ref, CSS selector, XPath, or coord tuple (kind-specific). */
  target?: string;
  /** Optional URL for navigation-class actions. */
  url?: string;
  /** Optional payload text for type/fill. Never store secrets here. */
  text?: string;
  /** Actor: 'agent' when driven by the harness, 'user' from the SPA. */
  from?: 'agent' | 'user' | 'inspector' | 'system';
  /** Epoch ms. */
  ts: number;
}

/**
 * Payload emitted by the inspector overlay when the user clicks an element
 * on the page. Persisted as a `browser_selection` artifact and forwarded to
 * the chat composer as an attachment.
 */
export interface BrowserInspectorSelection {
  url: string;
  cssSelector?: string;
  xpath?: string;
  outerHtml: string;
  computedStyle?: Record<string, string>;
  boundingBox?: { x: number; y: number; width: number; height: number };
  /** Path (relative to workspace root) of the screenshot clip artifact. */
  screenshotPath?: string;
  /** Epoch ms. */
  ts: number;
}
