// ────────────────────────────────────────────────────────────────
// Review 6.2 — the workspace file-read routes had no containment.
//
// `GET /workspaces/:id/changes/file` passes its `filePath` query parameter
// straight through, and both readers here joined it onto the repository
// directory with no check. `../../..`-style input, or an absolute path, read
// whatever the server user could read and returned it through the run page's
// Changes tab — on a route that needs only workspace read access.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeSummaryService } from '../src/ChangeSummaryService.js';

let root: string;
let repoDir: string;
let service: ChangeSummaryService;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gai-contain-'));
  repoDir = join(root, 'repo');
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(repoDir, 'inside.txt'), 'safe content');
  // The file an escape would be reaching for.
  writeFileSync(join(root, 'secret.txt'), 'SHOULD-NEVER-BE-RETURNED');
  service = new ChangeSummaryService({} as never, {} as never, logger);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The two private readers are the enforcement point; reach them directly. */
const read = (rel: string): Promise<string | null> =>
  (service as unknown as { readWorkingFile(d: string, p: string): Promise<string | null> })
    .readWorkingFile(repoDir, rel);
const sha = (rel: string): Promise<string | null> =>
  (service as unknown as { workingBlobSha(d: string, p: string): Promise<string | null> })
    .workingBlobSha(repoDir, rel);

describe('workspace file reads stay inside the repository', () => {
  it('reads a file that is genuinely inside', async () => {
    expect(await read('inside.txt')).toBe('safe content');
    expect(await sha('inside.txt')).toMatch(/^[0-9a-f]{40}$/);
  });

  it('refuses a relative escape', async () => {
    expect(await read('../secret.txt')).toBeNull();
    expect(await sha('../secret.txt')).toBeNull();
  });

  it('refuses a deeper relative escape', async () => {
    expect(await read('sub/../../secret.txt')).toBeNull();
  });

  it('refuses an absolute path outside the repository', async () => {
    expect(await read(join(root, 'secret.txt'))).toBeNull();
    expect(await sha(join(root, 'secret.txt'))).toBeNull();
  });
});
