// type_in_page — type text or press a key into an element (or focused input).
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { coerceString, wrapHandler } from './browserToolTypes.js';

export const createTypeInPageTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'type_in_page',
  description:
    'Type text or press a key in the browser. If you provide `ref` (from read_page) ' +
    'or `selector`, the tool fills that element; if you omit both, the tool types ' +
    'into whatever element currently has focus. Use `key` for named keys like ' +
    '"Enter", "Tab", "ArrowDown", or key combos like "Control+c".',
  owner: ctx.owner ?? 'browser-tools',
  parametersSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'pageId from open_browser_page.' },
      ref: { type: 'string', description: 'Element ref from read_page.' },
      selector: { type: 'string', description: 'CSS/Playwright selector as fallback.' },
      text: { type: 'string', description: 'Text to type. Optional — pair with `key` for compound sequences.' },
      key: {
        type: 'string',
        description:
          'A key or key combo to press (e.g. "Enter", "Escape", "Control+c"). Fires after `text` if both are set.',
      },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
  handler: async (args) =>
    wrapHandler(async () => {
      const pageId = String(args['pageId'] ?? '');
      if (pageId && pageId !== ctx.workspaceId) return { ok: false, error: `Unknown pageId '${pageId}'.` };
      const ref = coerceString(args['ref']) ?? coerceString(args['selector']);
      const text = typeof args['text'] === 'string' ? (args['text'] as string) : undefined;
      const key = coerceString(args['key']) ?? undefined;
      if (text == null && !key) {
        return { ok: false, error: 'At least one of `text` or `key` is required.' };
      }
      return ctx.browserService.typeRef(ctx.workspaceId, ref, { text, key });
    }),
});
