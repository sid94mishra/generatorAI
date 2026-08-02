// drag_element — drag source element to target element.
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { coerceString, wrapHandler } from './browserToolTypes.js';

export const createDragElementTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'drag_element',
  description:
    'Drag a source element onto a target element. Uses Playwright drag intents so ' +
    'HTML5 drag-and-drop, sortable lists, and react-dnd targets all work.',
  owner: ctx.owner ?? 'browser-tools',
  parametersSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'pageId from open_browser_page.' },
      fromRef: { type: 'string', description: 'Source element ref from read_page.' },
      fromSelector: { type: 'string', description: 'CSS/Playwright selector for source (fallback).' },
      toRef: { type: 'string', description: 'Target element ref from read_page.' },
      toSelector: { type: 'string', description: 'CSS/Playwright selector for target (fallback).' },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
  handler: async (args) =>
    wrapHandler(async () => {
      const pageId = String(args['pageId'] ?? '');
      if (pageId && pageId !== ctx.workspaceId) return { ok: false, error: `Unknown pageId '${pageId}'.` };
      const fromRef = coerceString(args['fromRef']) ?? coerceString(args['fromSelector']);
      const toRef = coerceString(args['toRef']) ?? coerceString(args['toSelector']);
      if (!fromRef || !toRef) {
        return { ok: false, error: 'Both a source and a target locator (ref or selector) are required.' };
      }
      return ctx.browserService.dragRef(ctx.workspaceId, fromRef, toRef);
    }),
});
