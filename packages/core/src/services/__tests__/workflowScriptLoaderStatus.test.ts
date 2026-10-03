import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowScriptLoader } from '../WorkflowScriptLoader.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('WorkflowScriptLoader.status', () => {
  it('reports files that are present but not loaded while scripts are switched off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generatorai-scripts-status-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'a.workflow.mjs'), 'export default {}');
    writeFileSync(join(dir, 'b.workflow.mjs'), 'export default {}');
    writeFileSync(join(dir, 'notes.md'), '#');
    const loader = new WorkflowScriptLoader(logger, [dir], {} as never, { enabled: false });
    expect(loader.status()).toEqual({ enabled: false, found: 0, loaded: 0 });
    await loader.discoverScripts();
    expect(loader.status()).toEqual({ enabled: false, found: 2, loaded: 0 });
  });
});
