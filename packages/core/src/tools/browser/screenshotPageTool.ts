// screenshot_page — capture PNG of viewport or a specific element.
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { coerceString, wrapHandler } from './browserToolTypes.js';

export const createScreenshotPageTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'screenshot_page',
  description:
    'Capture a PNG screenshot. With no `ref` or `selector`, screenshots the whole ' +
    'viewport; with either set, screenshots just that element. The file is saved ' +
    'as a browser_screenshot artifact in the workspace so the human can view it ' +
    'in the Snapshots gallery.',
  owner: ctx.owner ?? 'browser-tools',
  skipPermission: true,
  parametersSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'pageId from open_browser_page.' },
      ref: { type: 'string', description: 'Element ref from read_page (optional).' },
      selector: { type: 'string', description: 'CSS/Playwright selector (optional).' },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
  handler: async (args) =>
    wrapHandler(async () => {
      const pageId = String(args['pageId'] ?? '');
      if (pageId && pageId !== ctx.workspaceId) return { ok: false, error: `Unknown pageId '${pageId}'.` };
      const ref = coerceString(args['ref']) ?? coerceString(args['selector']);
      if (ref) return ctx.browserService.screenshotRef(ctx.workspaceId, ref, 'agent');
      return ctx.browserService.screenshot(ctx.workspaceId, 'agent');
    }),
});
