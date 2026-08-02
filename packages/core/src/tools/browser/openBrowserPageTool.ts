// ────────────────────────────────────────────────────────────────
// open_browser_page — VSCode-parity anchor tool.
//
// Opens a URL (or bootstraps the session with no URL) and returns a
// `pageId` the model uses for every follow-up tool. Idempotent — if the
// workspace already has a live session, we reuse it and just navigate.
//
// This is also the ONLY tool that will `lazyEnable: true` the browser
// on a workspace whose `browserConfig.enabled` isn't yet true. That
// path is deliberate: the plan gates *auto*-start at chat/workflow
// create on `visibility !== 'off'`, but a natural-language prompt that
// results in an `open_browser_page` call is an explicit LLM-driven
// intent — the user wants the browser now, so we start it.
// ────────────────────────────────────────────────────────────────

import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { coerceString, wrapHandler } from './browserToolTypes.js';

export const createOpenBrowserPageTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'open_browser_page',
  description:
    'Open a URL in the integrated browser (or bootstrap the session with no URL). ' +
    'Returns a pageId that must be passed to every follow-up browser tool. ' +
    'Idempotent — safe to call even if a session is already running.',
  owner: ctx.owner ?? 'browser-tools',
  skipPermission: true,
  requiredPermissions: [
    { kind: 'network', description: 'Loads a URL in the integrated browser' },
  ],
  parametersSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'Absolute URL to navigate to (http:, https:). Optional — omit to just start ' +
          'the session and read the current page. Bare hostnames like "example.com" ' +
          'are auto-prefixed with https://',
      },
    },
    additionalProperties: false,
  },
  handler: async (args) =>
    wrapHandler(async () => {
      const rawUrl = coerceString(args['url']);
      const url = rawUrl && !/^https?:\/\//i.test(rawUrl) ? `https://${rawUrl}` : rawUrl;
      // Lazy-enable: if the workspace's browserConfig.enabled is false,
      // we flip it in-memory so the session boots. See
      // `BrowserService.ensureStartedForTool` for the semantics.
      const descriptor = await ctx.browserService.ensureStartedForTool(ctx.workspaceId, {
        lazyEnable: true,
      });
      if (!descriptor.ready) {
        return {
          ok: false,
          error: `Browser session not ready (status=${descriptor.status}, mode=${descriptor.mode}).`,
        };
      }
      if (url) {
        const outcome = await ctx.browserService.navigate(ctx.workspaceId, url, 'agent');
        if (!outcome.ok) {
          return {
            ok: false,
            pageId: ctx.workspaceId,
            error: outcome.error ?? `Navigate to ${url} failed.`,
          };
        }
      }
      // Fetch a fresh readPage so the model has element refs immediately.
      const snapshot = await ctx.browserService.readPage(ctx.workspaceId).catch(() => null);
      return {
        ok: true,
        pageId: ctx.workspaceId,
        url: snapshot?.url ?? descriptor.currentUrl ?? url ?? '',
        title: snapshot?.title ?? '',
        snapshot: snapshot?.snapshot ?? '',
      };
    }),
});
