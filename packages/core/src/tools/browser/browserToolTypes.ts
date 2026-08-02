// ────────────────────────────────────────────────────────────────
// browserToolTypes — shared types + factory helpers for the 10
// built-in browser tools. Mirrors VSCode's
// `src/vs/workbench/contrib/browserView/electron-browser/tools/`
// tool set (see the notes in
// `/memories/session/browser-auto-attach-plan.md`).
//
// **Binding model.** Every tool is defined via a *factory* that closes
// over a `BrowserToolContext` bound to a specific workspace. Tools are
// created per-chat / per-stage at session-start time so the `pageId` the
// LLM sees (== workspaceId) always resolves back to the right
// `BrowserService` session without a router lookup in the handler.
//
// **Precedence.** These tools are always registered when the harness
// has any tool support. If the user has *also* installed
// `@playwright/mcp` (via `harnessConfig.mcpServers`) or the
// `playwright-cli` skill, the harness sees all three tool sets and the
// model picks — we do NOT force `agentInterface`.
// ────────────────────────────────────────────────────────────────

import type { BrowserService } from '../../services/BrowserService.js';
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';

/**
 * The context every browser tool needs to do its job. Curried into each
 * tool's handler at construction time so the `handler(args)` signature
 * remains harness-agnostic.
 */
export interface BrowserToolContext {
  browserService: BrowserService;
  /** The workspace this tool set is bound to. Equals `pageId` the LLM sees. */
  workspaceId: string;
  /** Optional label surfaced in the `owner` field for telemetry. */
  owner?: string;
}

/**
 * All ten tools share this factory signature. Each individual tool file
 * exports a matching `create<Xxx>Tool` factory that returns one
 * `ToolDefinition`.
 */
export type BrowserToolFactory = (ctx: BrowserToolContext) => ToolDefinition;

/**
 * Sentinel returned when a call is made before the browser is ready.
 * Kept as a shared helper so every tool produces the exact same error
 * string, making it easy for the model to learn "call `open_browser_page`
 * first".
 */
export function notStartedError(): { error: string; hint: string } {
  return {
    error: 'Browser session not started.',
    hint: 'Call `open_browser_page` first (optionally with a URL) to boot the shared Chromium.',
  };
}

/**
 * Normalise an incoming string arg — the harness may pass `undefined`,
 * a non-string, or a whitespace-padded value. Return `null` for anything
 * we shouldn't accept.
 */
export function coerceString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Wraps any tool handler in a common try/catch → JSON envelope so a
 * thrown exception never bubbles up as a harness error (which would
 * kill the whole conversation turn on some harnesses). Errors become
 * `{ ok: false, error: "..." }` for the model to inspect.
 */
export function wrapHandler<T>(
  fn: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  return fn().catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));
}
