// The node-pty `spawn-helper` exec bit (scripts/lib/nativeExecBits.mjs), used by
// the root postinstall and by the desktop server-runtime staging. A staged
// 0644 helper broke every terminal in the packaged app (posix_spawnp failed).
// Runs under the root vitest "node" project (`pnpm test:scripts`).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  nonExecutableNodePtyHelpers,
  nodePtyDirs,
  restoreNodePtyExecBits,
} from '../lib/nativeExecBits.mjs';

let dir;

function helper(rel, mode) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'binary');
  fs.chmodSync(file, mode);
  return file;
}

const modeOf = (file) => fs.statSync(file).mode & 0o777;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-execbits-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('node-pty spawn-helper exec bits', () => {
  it('finds node-pty in a hoisted tree and in the pnpm store', () => {
    helper('node-pty/prebuilds/darwin-arm64/spawn-helper', 0o644);
    helper('.pnpm/node-pty@1.1.0/node_modules/node-pty/build/Release/spawn-helper', 0o644);
    expect(nodePtyDirs(dir).map((d) => path.relative(dir, d)).sort()).toEqual(
      [path.join('.pnpm', 'node-pty@1.1.0', 'node_modules', 'node-pty'), 'node-pty'].sort(),
    );
  });

  it.skipIf(process.platform === 'win32')('restores the exec bit of a 0644 helper as 0755 (staged hoisted layout)', () => {
    const arm = helper('node-pty/prebuilds/darwin-arm64/spawn-helper', 0o644);
    const x64 = helper('node-pty/prebuilds/darwin-x64/spawn-helper', 0o755);
    expect(nonExecutableNodePtyHelpers(dir, { platform: 'darwin' })).toEqual([arm]);

    expect(restoreNodePtyExecBits(dir, { platform: 'darwin' })).toEqual([arm]);
    expect(modeOf(arm)).toBe(0o755);
    expect(modeOf(x64)).toBe(0o755);
    expect(nonExecutableNodePtyHelpers(dir, { platform: 'darwin' })).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('never widens access: a 0600 helper becomes 0700', () => {
    const file = helper('node-pty/build/Release/spawn-helper', 0o600);
    restoreNodePtyExecBits(dir, { platform: 'linux' });
    expect(modeOf(file)).toBe(0o700);
  });

  it('is a no-op for a Windows target (ConPTY has no helper)', () => {
    const file = helper('node-pty/prebuilds/win32-x64/spawn-helper', 0o644);
    const before = modeOf(file);
    expect(restoreNodePtyExecBits(dir, { platform: 'win32' })).toEqual([]);
    expect(nonExecutableNodePtyHelpers(dir, { platform: 'win32' })).toEqual([]);
    expect(modeOf(file)).toBe(before);
  });

  it('tolerates a tree with no node-pty', () => {
    expect(restoreNodePtyExecBits(dir, { platform: 'darwin' })).toEqual([]);
  });
});
