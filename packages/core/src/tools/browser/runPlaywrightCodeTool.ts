// run_playwright_code — the escape hatch, verbatim VSCode parity.
//
// Runs arbitrary Playwright JS with `page` in scope. Gated at the
// service layer on `browserConfig.evalAllowed`. Supports deferred
// resumption so long-running code (waiting for a slow SPA to settle,
// tracing, video capture) doesn't block the whole conversation turn.
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { coerceString, wrapHandler } from './browserToolTypes.js';

export const createRunPlaywrightCodeTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'run_playwright_code',
  description:
    'Run a Playwright code snippet against a browser page. Only use this if other ' +
    'browser tools are insufficient. The code executes inside ' +
    '`async (page) => { <your code> }` on the server, so `page` is in scope. ' +
    'You **must not** access `document` or `window` directly — go through ' +
    '`page.evaluate(() => ...)`. Set `timeoutMs` (default 5000) for long-running ' +
    'code; if it exceeds the timeout you get a `deferredResultId` you can pass ' +
    'to this same tool later to keep waiting. Requires ' +
    '`browserConfig.evalAllowed: true` — will error otherwise.',
  owner: ctx.owner ?? 'browser-tools',
  // Escape hatch — declares permission intents so the domain
  // PermissionPolicy (or a future HITL confirmation UX) can gate it.
  // `shell_exec` is the closest fit: the code runs on the server with
  // full Playwright API access which is functionally similar to
  // executing arbitrary code in the workspace's context. `network` is
  // also declared because most snippets end up making page.goto /
  // network requests.
  requiredPermissions: [
    { kind: 'shell_exec', description: 'Executes arbitrary Playwright JS on the server' },
    { kind: 'network', description: 'The injected page.* code typically hits the network' },
  ],
  // Confirmation is up to the harness — this tool is the escape hatch.
  // We do NOT set `skipPermission: true` so the SDK's permission prompt
  // (if the model runs untrusted) fires by default.
  parametersSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'pageId from open_browser_page.' },
      code: {
        type: 'string',
        description:
          'The Playwright code body. Concise, single-purpose, self-contained. Access the browser ' +
          'via the provided `page` object (e.g. `return page.evaluate(() => document.title)`). ' +
          'Omit when resuming a deferred execution via deferredResultId.',
      },
      deferredResultId: {
        type: 'string',
        description:
          'If a previous call returned a deferredResultId, pass it here to continue waiting for that execution to complete.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Maximum time in ms to wait before returning a deferredResultId. Default 5000.',
      },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
  handler: async (args) =>
    wrapHandler(async () => {
      const pageId = String(args['pageId'] ?? '');
      if (pageId && pageId !== ctx.workspaceId) return { ok: false, error: `Unknown pageId '${pageId}'.` };
      const timeoutMsRaw = args['timeoutMs'];
      const timeoutMs = typeof timeoutMsRaw === 'number' && timeoutMsRaw > 0 ? Math.floor(timeoutMsRaw) : 5000;
      const deferredResultId = coerceString(args['deferredResultId']);
      if (deferredResultId) {
        const result = await ctx.browserService.waitForDeferredResult(ctx.workspaceId, deferredResultId, timeoutMs);
        return { ok: !result.error, ...result };
      }
      const code = coerceString(args['code']);
      if (!code) {
        return { ok: false, error: 'Either `code` or `deferredResultId` must be provided.' };
      }
      const result = await ctx.browserService.invokeFunction(ctx.workspaceId, code, {
        timeoutMs,
        from: 'agent',
      });
      return { ok: !result.error, ...result };
    }),
});
