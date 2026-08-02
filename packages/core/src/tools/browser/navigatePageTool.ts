// navigate_page — URL / back / forward / reload.
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { coerceString, wrapHandler } from './browserToolTypes.js';

export const createNavigatePageTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'navigate_page',
  description:
    'Navigate the browser page: to a URL, or through history (back / forward), or ' +
    'reload the current page. Use this rather than opening a new page for same-tab ' +
    'navigation.',
  owner: ctx.owner ?? 'browser-tools',
  skipPermission: true,
  requiredPermissions: [
    { kind: 'network', description: 'Navigates the browser page' },
  ],
  parametersSchema: {
    type: 'object',
    properties: {
      pageId: {
        type: 'string',
        description: 'The pageId returned by open_browser_page.',
      },
      type: {
        type: 'string',
        enum: ['url', 'back', 'forward', 'reload'],
        description:
          'Navigation type. "url" requires the `url` field. "back"/"forward"/"reload" ignore url.',
      },
      url: {
        type: 'string',
        description: 'The URL to navigate to when type = "url". Bare hostnames auto-prefix https://',
      },
    },
    required: ['pageId', 'type'],
    additionalProperties: false,
  },
  handler: async (args) =>
    wrapHandler(async () => {
      const pageId = String(args['pageId'] ?? '');
      if (pageId && pageId !== ctx.workspaceId) {
        return { ok: false, error: `Unknown pageId '${pageId}'.` };
      }
      const kind = String(args['type'] ?? 'url');
      if (kind === 'url') {
        const raw = coerceString(args['url']);
        if (!raw) return { ok: false, error: 'type="url" requires the `url` field.' };
        const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        return ctx.browserService.navigate(ctx.workspaceId, url, 'agent');
      }
      if (kind === 'back') return ctx.browserService.back(ctx.workspaceId);
      if (kind === 'forward') return ctx.browserService.forward(ctx.workspaceId);
      if (kind === 'reload') return ctx.browserService.reload(ctx.workspaceId, 'agent');
      return { ok: false, error: `Unknown navigation type '${kind}'.` };
    }),
});
