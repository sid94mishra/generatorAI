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
import { SNAPSHOT_HANDOFF_HINT, writeSnapshotHandoff } from './snapshotHandoff.js';

export const createOpenBrowserPageTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'open_browser_page',
  description:
    'Open a URL in the integrated browser (or bootstrap the session with no URL). ' +
    'Returns a pageId that must be passed to every follow-up browser tool. ' +
    'Idempotent — safe to call even if a session is already running. ' +
    'The page\'s accessibility snapshot is written to a file whose path is returned; ' +
    'read that file only when you need element refs — the url and title returned ' +
    'inline are enough for most next steps.',
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
      // Fetch a fresh readPage so element refs exist immediately…
      const snapshot = await ctx.browserService.readPage(ctx.workspaceId).catch(() => null);
      const base = {
        ok: true as const,
        pageId: ctx.workspaceId,
        url: snapshot?.url ?? descriptor.currentUrl ?? url ?? '',
        title: snapshot?.title ?? '',
      };
      if (!snapshot) return base;

      // …but hand the tree over ON DISK. This is the first call of every
      // browser loop, so inlining the full a11y tree here charged the whole
      // snapshot to every session before the model had asked for one element.
      // X-17 fixed this in `read_page` and nowhere else, which left the
      // dominant cost untouched.
      const handoff = await writeSnapshotHandoff(ctx, snapshot.snapshot);
      if (!handoff) {
        // No workspace root, or the write failed — inline rather than return
        // nothing, so the tool degrades in cost instead of in function.
        return { ...base, snapshot: snapshot.snapshot };
      }
      return {
        ...base,
        page: `Browser: ${base.title} at ${base.url}`,
        snapshotFile: handoff.snapshotFile,
        snapshotBytes: handoff.bytes,
        hint: SNAPSHOT_HANDOFF_HINT,
      };
    }),
});
