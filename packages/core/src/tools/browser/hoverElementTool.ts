// hover_element — mouse-over an element to reveal hover-only UI.
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { coerceString, wrapHandler } from './browserToolTypes.js';

export const createHoverElementTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'hover_element',
  description:
    'Hover the mouse over an element. Useful to reveal hover-only menus, tooltips, ' +
    'or trigger CSS :hover states before clicking a child element.',
  owner: ctx.owner ?? 'browser-tools',
  parametersSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'pageId from open_browser_page.' },
      ref: { type: 'string', description: 'Element ref from read_page.' },
      selector: { type: 'string', description: 'CSS/Playwright selector as fallback.' },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
  handler: async (args) =>
    wrapHandler(async () => {
      const pageId = String(args['pageId'] ?? '');
      if (pageId && pageId !== ctx.workspaceId) return { ok: false, error: `Unknown pageId '${pageId}'.` };
      const ref = coerceString(args['ref']) ?? coerceString(args['selector']);
      if (!ref) return { ok: false, error: 'Either `ref` or `selector` is required.' };
      return ctx.browserService.hoverRef(ctx.workspaceId, ref);
    }),
});
