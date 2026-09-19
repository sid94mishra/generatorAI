// What the Settings screen is told about the Nemotron download.
//
// These two numbers sit side by side in one sentence ("3 MB of about 754 MB")
// with a percentage bar under them, so a disagreement between them is visible
// to every user who ever presses Download.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NEMOTRON_FILES,
  isNemotronModelPresent,
  nemotronModelStatus,
} from '../NemotronModelStore.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nemotron-store-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('nemotronModelStatus', () => {
  it('reports nothing present in an empty directory', async () => {
    const s = await nemotronModelStatus(dir);
    expect(s.present).toBe(false);
    expect(s.bytesOnDisk).toBe(0);
  });

  it('counts a download still in flight, not just the files that finished', async () => {
    // A file only gets its real name once its stream completes, so counting
    // only final names made the byte figure stall near zero while the
    // percentage climbed — two halves of the same sentence disagreeing.
    await fs.writeFile(join(dir, `${NEMOTRON_FILES[0]}`), 'x'.repeat(100));
    await fs.writeFile(join(dir, `${NEMOTRON_FILES[1]}.part`), 'y'.repeat(900));
    const s = await nemotronModelStatus(dir);
    expect(s.bytesOnDisk).toBe(1000);
    expect(s.present).toBe(false);
  });

  it('never reports a total smaller than what is already on disk', async () => {
    for (const f of NEMOTRON_FILES) await fs.writeFile(join(dir, f), 'z');
    const s = await nemotronModelStatus(dir);
    expect(s.approxTotalBytes).toBeGreaterThanOrEqual(s.bytesOnDisk);
  });

  it('treats a complete set of non-empty files as present', async () => {
    for (const f of NEMOTRON_FILES) await fs.writeFile(join(dir, f), 'data');
    expect(await isNemotronModelPresent(dir)).toBe(true);
    expect((await nemotronModelStatus(dir)).present).toBe(true);
  });

  it('treats one empty file as not present', async () => {
    // The `.onnx.data` siblings hold the weights; an empty one loads and then
    // fails at the first inference, which is far worse than reporting absent.
    for (const f of NEMOTRON_FILES) await fs.writeFile(join(dir, f), 'data');
    await fs.writeFile(join(dir, NEMOTRON_FILES[5]!), '');
    expect(await isNemotronModelPresent(dir)).toBe(false);
  });
});
