// read_page — accessibility snapshot with element refs.
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { BrowserToolContext, BrowserToolFactory } from './browserToolTypes.js';
import { wrapHandler } from './browserToolTypes.js';
import { SNAPSHOT_HANDOFF_HINT, writeSnapshotHandoff } from './snapshotHandoff.js';

export const createReadPageTool: BrowserToolFactory = (ctx: BrowserToolContext): ToolDefinition => ({
  name: 'read_page',
  description:
    'Read a structured accessibility snapshot of the current page. Interactive ' +
    'elements are tagged with [ref=eN] IDs you can pass to click_element, ' +
    'hover_element, type_in_page, drag_element, and screenshot_page. Refs are ' +
    'invalidated the moment you call read_page again — never carry a ref across ' +
    'snapshots. ' +
    'The full snapshot is written to a file inside the workspace whose path is ' +
    'returned; read that file only when you need element details. Many tasks can ' +
    'be completed with just the title and url returned inline.',
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
      const result = await ctx.browserService.readPage(ctx.workspaceId);

      // X-17: hand the full a11y tree over on disk instead of inlining it —
      // shared with `open_browser_page`, which used to inline the same tree on
      // the first call of every loop. See `snapshotHandoff.ts`.
      const handoff = await writeSnapshotHandoff(ctx, result.snapshot);
      if (handoff) {
        return {
          ok: true,
          page: `Browser: ${result.title} at ${result.url}`,
          url: result.url,
          title: result.title,
          snapshotFile: handoff.snapshotFile,
          snapshotBytes: handoff.bytes,
          hint: SNAPSHOT_HANDOFF_HINT,
        };
      }
      // Fallback: inline snapshot (no workspace root, or file write failed).
      return { ok: true, ...result };
    }),
});
