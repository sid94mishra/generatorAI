// APPLICATION-REVIEW-2026-09 §5.11 — a truncated key file used to trigger a
// silent re-key that destroyed every stored secret. These tests pin the
// opposite contract: a wrong-length key file is refused AND left untouched, so
// the operator can restore it from backup.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renameWithRetry } from '@generatorai/shared/node';
import { LocalFileKeyProvider } from '../KeyProvider.js';

let dir: string;
let keyPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-kek-'));
  keyPath = path.join(dir, 'secrets', 'kek.key');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('LocalFileKeyProvider.getKey', () => {
  it('creates a fresh 32-byte key when no file exists', async () => {
    const key = await new LocalFileKeyProvider(keyPath).getKey();
    expect(key.length).toBe(32);
    expect(fs.readFileSync(keyPath).equals(key)).toBe(true);
  });

  it('returns the stored key when the file has the right length', async () => {
    const stored = Buffer.alloc(32, 7);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, stored);

    const key = await new LocalFileKeyProvider(keyPath).getKey();
    expect(key.equals(stored)).toBe(true);
  });

  it('refuses a wrong-length key file and does NOT overwrite it', async () => {
    // 17 bytes: what a crash mid-write or an interrupted copy leaves behind.
    const truncated = Buffer.alloc(17, 9);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, truncated);

    const provider = new LocalFileKeyProvider(keyPath);
    await expect(provider.getKey()).rejects.toThrow(/unexpected length \(17 bytes, expected 32\)/);

    // The whole point: the operator's only path to recovery is the file as it
    // was. Re-keying here would have made every vault entry unreadable.
    expect(fs.readFileSync(keyPath).equals(truncated)).toBe(true);

    // And it keeps refusing — no cached state leaks past the failure.
    await expect(provider.getKey()).rejects.toThrow(/refusing to re-key/);
  });

  it('refuses an empty key file too', async () => {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, Buffer.alloc(0));
    await expect(new LocalFileKeyProvider(keyPath).getKey()).rejects.toThrow(/0 bytes, expected 32/);
    expect(fs.statSync(keyPath).size).toBe(0);
  });

  it('still rotates on an EXPLICIT rotateKey() call', async () => {
    const provider = new LocalFileKeyProvider(keyPath);
    const first = await provider.getKey();
    const second = await provider.rotateKey();
    expect(second.length).toBe(32);
    expect(second.equals(first)).toBe(false);
    expect(fs.readFileSync(keyPath).equals(second)).toBe(true);
    expect((await provider.getKey()).equals(second)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// Windows transient rename — found by restarting the dev server.
//
//  renames a temp file over the real one. On
// Windows that fails with EPERM/EBUSY whenever anything holds the destination
// open for a moment — a virus scanner, the search indexer, or the previous
// server process during a fast restart. It was fatal: the server died at boot
// with .
// ────────────────────────────────────────────────────────────────

describe('renameWithRetry', () => {
  it('retries a rename that fails with EPERM and then succeeds', () => {
    let calls = 0;
    const rename = (from: string, to: string): void => {
      calls += 1;
      if (calls <= 2) {
        const err = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      fs.renameSync(from, to);
    };

    const src = path.join(dir, 'from.txt');
    const dest = path.join(dir, 'to.txt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(src, 'payload');

    expect(() => renameWithRetry(src, dest, 10, 1, rename)).not.toThrow();
    expect(calls).toBe(3);
    expect(fs.readFileSync(dest, 'utf8')).toBe('payload');
  });

  it('gives up on a failure that is not transient, and removes the temp file', () => {
    const rename = (): void => {
      const err = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
      err.code = 'ENOSPC';
      throw err;
    };
    const src = path.join(dir, 'from2.txt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(src, 'payload');

    expect(() => renameWithRetry(src, path.join(dir, 'to2.txt'), 3, 1, rename)).toThrow(/ENOSPC/);
    // A genuine failure must not leave the half-written temp file behind.
    expect(fs.existsSync(src)).toBe(false);
  });
});
