// read_page — accessibility snapshot with element refs.
import * as fs from 'node:fs/promises';
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

      // X-17: Write the full a11y tree to a file inside the workspace instead
      // of returning it inline. The snapshot can be several thousand tokens for
      // a complex page; auto-attaching it to every tool result dominates context
      // usage even when the agent only needed the URL or title.
      //
      // F1-fix: write to <workspaceRoot>/browser/snapshots/ — inside the
      // workspace tree so the harness's Read tool can access the path. Writing
      // to os.tmpdir() is outside the harness's allowed read path and silently
      // makes X-17 non-functional.
      //
      // F2-fix: writing inside the workspace means the file is automatically
      // cleaned up when the workspace is deleted — no temp file accumulation.
      let snapshotFile: string | undefined;
      const workspaceRoot = ctx.browserService.getWorkspaceRoot(ctx.workspaceId);
      if (workspaceRoot) {
        try {
          const snapId = randomUUID().slice(0, 8);
          const snapshotsDir = path.join(workspaceRoot, 'browser', 'snapshots');
          await fs.mkdir(snapshotsDir, { recursive: true });
          snapshotFile = path.join(snapshotsDir, `snap-${snapId}.txt`);
          await fs.writeFile(snapshotFile, result.snapshot, 'utf-8');
        } catch {
          // If we can't write the file, fall back to inline snapshot so the tool
          // is still usable rather than silently returning no data.
          snapshotFile = undefined;
        }
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
      // Fallback: inline snapshot (no workspace root, or file write failed).
      return { ok: true, ...result };
    }),
});
