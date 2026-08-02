// handle_dialog — accept/dismiss the next JS alert/confirm/prompt.
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { coerceString, wrapHandler } from './browserToolTypes.js';

export const createHandleDialogTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'handle_dialog',
  description:
    'Handle the next alert/confirm/prompt/beforeunload dialog that appears on the ' +
    'page. Call this BEFORE the action that triggers the dialog. Returns after the ' +
    'dialog is handled or times out after 2 seconds.',
  owner: ctx.owner ?? 'browser-tools',
  parametersSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'pageId from open_browser_page.' },
      action: {
        type: 'string',
        enum: ['accept', 'dismiss'],
        description: 'What to do with the dialog.',
      },
      promptText: {
        type: 'string',
        description: 'When accepting a `prompt` dialog, the text to enter. Ignored for alert/confirm.',
      },
    },
    required: ['pageId', 'action'],
    additionalProperties: false,
  },
  handler: async (args) =>
    wrapHandler(async () => {
      const pageId = String(args['pageId'] ?? '');
      if (pageId && pageId !== ctx.workspaceId) return { ok: false, error: `Unknown pageId '${pageId}'.` };
      const action = args['action'];
      if (action !== 'accept' && action !== 'dismiss') {
        return { ok: false, error: 'action must be "accept" or "dismiss".' };
      }
      const promptText = coerceString(args['promptText']) ?? undefined;
      return ctx.browserService.handleDialog(ctx.workspaceId, action, promptText, 'agent');
    }),
});
