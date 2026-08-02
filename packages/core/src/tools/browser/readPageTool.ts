// read_page — accessibility snapshot with element refs.
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { wrapHandler } from './browserToolTypes.js';

export const createReadPageTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'read_page',
  description:
    'Read a structured accessibility snapshot of the current page. Interactive ' +
    'elements are tagged with [ref=eN] IDs you can pass to click_element, ' +
    'hover_element, type_in_page, drag_element, and screenshot_page. Refs are ' +
    'invalidated the moment you call read_page again — never carry a ref across ' +
    'snapshots.',
  owner: ctx.owner ?? 'browser-tools',
  skipPermission: true,
  parametersSchema: {
    type: 'object',
    properties: {
      pageId: {
        type: 'string',
        description: 'The pageId returned by open_browser_page.',
      },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
  handler: async (args) =>
    wrapHandler(async () => {
      const pageId = String(args['pageId'] ?? '');
      if (pageId && pageId !== ctx.workspaceId) {
        return { ok: false, error: `Unknown pageId '${pageId}'. Only '${ctx.workspaceId}' is valid in this chat.` };
      }
      const snapshot = await ctx.browserService.readPage(ctx.workspaceId);
      return { ok: true, ...snapshot };
    }),
});
