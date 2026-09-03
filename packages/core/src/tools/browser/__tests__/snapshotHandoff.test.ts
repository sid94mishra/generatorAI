// ────────────────────────────────────────────────────────────────
// W16 / X-17 — the a11y snapshot is handed off on disk, from BOTH tools.
//
// There was no test for the browser tool surface at all. `read_page` had the
// on-disk handoff; `open_browser_page` — the first call of every browser loop —
// still returned `snapshot: snapshot?.snapshot ?? ''` inline, so the dominant
// token cost was paid on every session while X-17 was recorded as fixed.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createOpenBrowserPageTool } from '../openBrowserPageTool.js';
import { createReadPageTool } from '../readPageTool.js';
import type { BrowserToolContext } from '../browserToolTypes.js';

/** Big enough that inlining it is unmistakably the expensive choice. */
const BIG_SNAPSHOT = Array.from({ length: 400 }, (_, i) =>
  `- button "Item ${i}" [ref=e${i}]`,
).join('\n');

const roots: string[] = [];

afterEach(async () => {
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});

async function makeCtx(opts: { workspaceRoot?: string | null } = {}): Promise<BrowserToolContext> {
  let root: string | null;
  if (opts.workspaceRoot === null) {
    root = null;
  } else {
    root = opts.workspaceRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'gai-snap-')));
    roots.push(root);
  }
  return {
    workspaceId: 'ws-1',
    browserService: {
      ensureStartedForTool: vi.fn(async () => ({ ready: true, status: 'running', mode: 'headless', currentUrl: 'https://example.com' })),
      navigate: vi.fn(async () => ({ ok: true })),
      readPage: vi.fn(async () => ({ url: 'https://example.com', title: 'Example', snapshot: BIG_SNAPSHOT })),
      getWorkspaceRoot: vi.fn(() => root),
    },
  } as unknown as BrowserToolContext;
}

type ToolResult = Record<string, unknown>;

describe('open_browser_page — snapshot is not inlined (W16)', () => {
  it('returns a path, not the tree, on the first call of the browser loop', async () => {
    const ctx = await makeCtx();
    const tool = createOpenBrowserPageTool(ctx);
    const res = (await tool.handler({ url: 'https://example.com' })) as ToolResult;

    expect(res['ok']).toBe(true);
    expect(res['snapshot']).toBeUndefined();
    expect(typeof res['snapshotFile']).toBe('string');
    expect(res['url']).toBe('https://example.com');
    expect(res['title']).toBe('Example');

    // The tree is on disk, complete and unaltered — a cheaper result, not a
    // lossy one.
    const written = await fs.readFile(String(res['snapshotFile']), 'utf-8');
    expect(written).toBe(BIG_SNAPSHOT);
    expect(res['snapshotBytes']).toBe(Buffer.byteLength(BIG_SNAPSHOT, 'utf-8'));
  });

  it('the inline result is a small constant regardless of page size', async () => {
    const ctx = await makeCtx();
    const tool = createOpenBrowserPageTool(ctx);
    const res = (await tool.handler({ url: 'https://example.com' })) as ToolResult;

    const inline = JSON.stringify(res).length;
    expect(inline).toBeLessThan(BIG_SNAPSHOT.length / 4);
  });

  it('falls back to an inline snapshot when there is no workspace root to write into', async () => {
    // Degrading in COST is acceptable; degrading in FUNCTION is not — a tool
    // that silently returns no page data is worse than an expensive one.
    const ctx = await makeCtx({ workspaceRoot: null });
    const tool = createOpenBrowserPageTool(ctx);
    const res = (await tool.handler({})) as ToolResult;

    expect(res['ok']).toBe(true);
    expect(res['snapshot']).toBe(BIG_SNAPSHOT);
  });

  it('still succeeds when the page snapshot cannot be read at all', async () => {
    const ctx = await makeCtx();
    (ctx.browserService as unknown as { readPage: () => Promise<never> }).readPage = () =>
      Promise.reject(new Error('page closed'));
    const tool = createOpenBrowserPageTool(ctx);
    const res = (await tool.handler({})) as ToolResult;

    expect(res['ok']).toBe(true);
    expect(res['pageId']).toBe('ws-1');
    expect(res['url']).toBe('https://example.com'); // from the descriptor
  });

  it('writes each snapshot to its own file so two calls do not clobber each other', async () => {
    const ctx = await makeCtx();
    const tool = createOpenBrowserPageTool(ctx);
    const a = (await tool.handler({})) as ToolResult;
    const b = (await tool.handler({})) as ToolResult;
    expect(a['snapshotFile']).not.toBe(b['snapshotFile']);
  });
});

describe('read_page — unchanged contract on the shared handoff', () => {
  it('still returns a path and the same hint as open_browser_page', async () => {
    const ctx = await makeCtx();
    const openRes = (await createOpenBrowserPageTool(ctx).handler({})) as ToolResult;
    const readRes = (await createReadPageTool(ctx).handler({ pageId: 'ws-1' })) as ToolResult;

    expect(typeof readRes['snapshotFile']).toBe('string');
    expect(readRes['snapshot']).toBeUndefined();
    // One habit for the model to learn, not two.
    expect(readRes['hint']).toBe(openRes['hint']);
  });

  it('rejects a pageId that is not this chat\'s workspace', async () => {
    const ctx = await makeCtx();
    const res = (await createReadPageTool(ctx).handler({ pageId: 'someone-else' })) as ToolResult;
    expect(res['ok']).toBe(false);
  });
});
