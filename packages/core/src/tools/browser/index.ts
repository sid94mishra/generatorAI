// ────────────────────────────────────────────────────────────────
// Built-in browser tool set — VSCode-parity.
//
// Ten tools, all bound to a specific workspace. Consume like:
//
//   ```ts
//   import { buildBrowserToolSet } from '@generatorai/core';
//   const tools = buildBrowserToolSet({ browserService, workspaceId, owner: 'chat' });
//   conversationConfig.tools = [...(userTools ?? []), ...tools];
//   ```
//
// The factories are pure — safe to call on every conversation start;
// they close over `ctx` and don't touch process state until their
// handlers fire. The `browserService` reference is expected to live
// for the process lifetime.
// ────────────────────────────────────────────────────────────────

import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext } from './browserToolTypes.js';
import { createOpenBrowserPageTool } from './openBrowserPageTool.js';
import { createReadPageTool } from './readPageTool.js';
import { createNavigatePageTool } from './navigatePageTool.js';
import { createClickElementTool } from './clickElementTool.js';
import { createTypeInPageTool } from './typeInPageTool.js';
import { createHoverElementTool } from './hoverElementTool.js';
import { createDragElementTool } from './dragElementTool.js';
import { createScreenshotPageTool } from './screenshotPageTool.js';
import { createHandleDialogTool } from './handleDialogTool.js';
import { createRunPlaywrightCodeTool } from './runPlaywrightCodeTool.js';

/**
 * Build a fresh `ToolDefinition[]` for the given workspace. Order is
 * deliberate: `open_browser_page` first so the model sees it as the
 * anchor, `run_playwright_code` last so the model treats it as the
 * escape hatch rather than the first-line option.
 */
export function buildBrowserToolSet(ctx: BrowserToolContext): ToolDefinition[] {
  return [
    createOpenBrowserPageTool(ctx),
    createReadPageTool(ctx),
    createNavigatePageTool(ctx),
    createClickElementTool(ctx),
    createTypeInPageTool(ctx),
    createHoverElementTool(ctx),
    createDragElementTool(ctx),
    createScreenshotPageTool(ctx),
    createHandleDialogTool(ctx),
    createRunPlaywrightCodeTool(ctx),
  ];
}

/**
 * The canonical set of tool *names* — useful for downstream code that
 * needs to reason about whether the current tool call is a browser
 * tool (permission filters, telemetry, UI badges).
 */
export const BROWSER_TOOL_NAMES = [
  'open_browser_page',
  'read_page',
  'navigate_page',
  'click_element',
  'type_in_page',
  'hover_element',
  'drag_element',
  'screenshot_page',
  'handle_dialog',
  'run_playwright_code',
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

/** Type-guard on tool name — narrows `unknown` → `BrowserToolName`. */
export function isBrowserToolName(name: unknown): name is BrowserToolName {
  return typeof name === 'string' && (BROWSER_TOOL_NAMES as readonly string[]).includes(name);
}

// Re-export factory types + individual factories so downstream tests
// can build subsets when needed.
export type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
export { createOpenBrowserPageTool } from './openBrowserPageTool.js';
export { createReadPageTool } from './readPageTool.js';
export { createNavigatePageTool } from './navigatePageTool.js';
export { createClickElementTool } from './clickElementTool.js';
export { createTypeInPageTool } from './typeInPageTool.js';
export { createHoverElementTool } from './hoverElementTool.js';
export { createDragElementTool } from './dragElementTool.js';
export { createScreenshotPageTool } from './screenshotPageTool.js';
export { createHandleDialogTool } from './handleDialogTool.js';
export { createRunPlaywrightCodeTool } from './runPlaywrightCodeTool.js';
export type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
