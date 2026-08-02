// click_element — click by ref or CSS selector.
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { coerceString, wrapHandler } from './browserToolTypes.js';

export const createClickElementTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'click_element',
  description:
    'Click an element on the current page. Prefer a `ref` from the last read_page ' +
    'snapshot (like "e5"); fall back to a `selector` (CSS or Playwright selector) ' +
    'if no ref is available. Supports left/right/middle mouse and double-clicks.',
  owner: ctx.owner ?? 'browser-tools',
  parametersSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'pageId from open_browser_page.' },
      ref: { type: 'string', description: 'Element ref from read_page (e.g. "e5").' },
      selector: {
        type: 'string',
        description: 'Playwright/CSS selector (e.g. "button.submit", "text=OK"). Used when ref is absent.',
      },
      button: {
        type: 'string',
        enum: ['left', 'right', 'middle'],
        description: 'Mouse button. Default "left".',
      },
      dblClick: {
        type: 'boolean',
        description: 'When true, perform a double-click. Default false.',
      },
      modifiers: {
        type: 'array',
        items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] },
        description: 'Modifier keys held during the click. Empty by default.',
      },
    },
    required: ['pageId'],
    additionalProperties: false,
    // Either "ref" or "selector" must be provided — enforced in the handler
    // rather than JSON schema so we can produce a helpful error message.
  },
  handler: async (args) =>
    wrapHandler(async () => {
      const pageId = String(args['pageId'] ?? '');
      if (pageId && pageId !== ctx.workspaceId) return { ok: false, error: `Unknown pageId '${pageId}'.` };
      const ref = coerceString(args['ref']) ?? coerceString(args['selector']);
      if (!ref) {
        return { ok: false, error: 'Either `ref` (from read_page) or `selector` (Playwright/CSS) is required.' };
      }
      const modifiersRaw = args['modifiers'];
      const modifiers = Array.isArray(modifiersRaw)
        ? modifiersRaw.filter((m): m is 'Alt' | 'Control' | 'Meta' | 'Shift' =>
            m === 'Alt' || m === 'Control' || m === 'Meta' || m === 'Shift')
        : undefined;
      return ctx.browserService.clickRef(ctx.workspaceId, ref, {
        button: (args['button'] as 'left' | 'right' | 'middle' | undefined) ?? 'left',
        dblClick: args['dblClick'] === true,
        modifiers,
      });
    }),
});
