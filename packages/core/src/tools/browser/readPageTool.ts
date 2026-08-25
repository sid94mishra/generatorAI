// read_page — accessibility snapshot with element refs.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
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
    'snapshots. ' +
    'The full snapshot is written to a temp file whose path is returned; read that ' +
    'file only when you need element details. Many tasks can be completed with just ' +
    'the title and url returned inline.',
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

      // X-17: Write the full a11y tree to a temp file instead of returning it
      // inline. The snapshot can be several thousand tokens for a complex page;
      // auto-attaching it to every tool result dominates context usage even when
      // the agent only needed the URL or title. The model reads the file via the
      // Read tool when it needs element refs.
      let snapshotFile: string | undefined;
      try {
        const snapId = randomUUID().slice(0, 8);
        snapshotFile = path.join(os.tmpdir(), `snap-${snapId}.txt`);
        await fs.writeFile(snapshotFile, result.snapshot, 'utf-8');
      } catch {
        // If we can't write the file, fall back to inline snapshot so the tool
        // is still usable rather than silently returning no data.
        snapshotFile = undefined;
      }

      if (snapshotFile) {
        return {
          ok: true,
          page: `Browser: ${result.title} at ${result.url}`,
          url: result.url,
          title: result.title,
          snapshotFile,
          hint: 'Read snapshotFile with the Read tool to inspect element refs.',
        };
      }
      // Fallback: inline snapshot (file write failed).
      return { ok: true, ...result };
    }),
});
