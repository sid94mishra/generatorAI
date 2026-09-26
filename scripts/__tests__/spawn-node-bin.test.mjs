// P2-R10 — scripts/redesign/lib/spawn-node-bin.mjs: cross-platform child
// process resolution for npm-package CLIs (vite, tsx) and for pnpm itself,
// without ever spawning a Windows `.cmd` shim directly (EINVAL on Node
// >=18.20.2/20.12.2/22 — CVE-2024-27980).
//
// Runs under the root vitest "node" project:
//   pnpm exec vitest run --project node scripts/__tests__/spawn-node-bin.test.mjs

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeBinArgs, pnpmCommand, resolveBinScript } from '../redesign/lib/spawn-node-bin.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_DIR = path.join(REPO, 'apps', 'web');
const SERVER_DIR = path.join(REPO, 'apps', 'server');

describe('resolveBinScript', () => {
  it('resolves vite/bin/vite.js from apps/web, and the file exists', () => {
    const resolved = resolveBinScript(WEB_DIR, 'vite');
    expect(resolved.endsWith(path.join('vite', 'bin', 'vite.js'))).toBe(true);
    expect(fs.existsSync(resolved)).toBe(true);
  });

  it('resolves tsx/dist/cli.mjs from apps/server, and the file exists', () => {
    const resolved = resolveBinScript(SERVER_DIR, 'tsx');
    expect(resolved.endsWith(path.join('tsx', 'dist', 'cli.mjs'))).toBe(true);
    expect(fs.existsSync(resolved)).toBe(true);
  });

  it('throws a clear error for a package that cannot be resolved from the given directory', () => {
    expect(() => resolveBinScript(REPO, 'not-a-real-package-xyz')).toThrow();
  });
});

describe('nodeBinArgs', () => {
  it('pairs the resolved script with process.execPath and appends extra args', () => {
    const { command, args } = nodeBinArgs(WEB_DIR, 'vite', 'vite', ['--version']);
    expect(command).toBe(process.execPath);
    expect(args[0]).toBe(resolveBinScript(WEB_DIR, 'vite'));
    expect(args.slice(1)).toEqual(['--version']);
  });

  it('actually runs: `node vite/bin/vite.js --version` prints a version, no shell involved', () => {
    const { command, args } = nodeBinArgs(WEB_DIR, 'vite', 'vite', ['--version']);
    const out = execFileSync(command, args, { cwd: WEB_DIR, encoding: 'utf8' });
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it('actually runs: `node tsx/dist/cli.mjs --version` prints a version, no shell involved', () => {
    const { command, args } = nodeBinArgs(SERVER_DIR, 'tsx', 'tsx', ['--version']);
    const out = execFileSync(command, args, { cwd: SERVER_DIR, encoding: 'utf8' });
    expect(out.trim().length).toBeGreaterThan(0);
  });
});

describe('pnpmCommand', () => {
  const ORIGINAL = process.env['npm_execpath'];
  const scratchDirs = [];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['npm_execpath'];
    else process.env['npm_execpath'] = ORIGINAL;
    for (const dir of scratchDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function fakeFile(...segments) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-node-bin-pnpm-test-'));
    scratchDirs.push(dir);
    const full = path.join(dir, ...segments);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '// fake entry\n');
    return full;
  }

  it('runs pnpm\'s own JS entry with process.execPath when npm_execpath is a real pnpm.cjs', () => {
    const fakeExecPath = fakeFile('pnpm', 'bin', 'pnpm.cjs');
    process.env['npm_execpath'] = fakeExecPath;

    const { command, args, options } = pnpmCommand(['--filter', 'x', 'bundle']);
    expect(command).toBe(process.execPath);
    expect(args).toEqual([fakeExecPath, '--filter', 'x', 'bundle']);
    expect(options.shell).toBeFalsy();
  });

  it('accepts a corepack-style pnpm shim under a "pnpm" path segment even without a pnpm.* basename', () => {
    const fakeExecPath = fakeFile('corepack', 'v1', 'pnpm', '9.0.0', 'pnpm.cjs');
    process.env['npm_execpath'] = fakeExecPath;

    const { command, args, options } = pnpmCommand(['--version']);
    expect(command).toBe(process.execPath);
    expect(args).toEqual([fakeExecPath, '--version']);
    expect(options.shell).toBeFalsy();
  });

  it('matches case-insensitively and on Windows-style backslash separators', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-node-bin-pnpm-test-'));
    scratchDirs.push(dir);
    const full = path.join(dir, 'PNPM.CJS');
    fs.writeFileSync(full, '// fake entry\n');
    // Simulate a Windows-style path (backslash separators) pointing at the
    // same real file, so fs.existsSync still resolves it.
    const backslashPath = full.replace(/\//g, '\\');
    process.env['npm_execpath'] = process.platform === 'win32' ? backslashPath : full;

    const { command, options } = pnpmCommand(['--version']);
    expect(command).toBe(process.execPath);
    expect(options.shell).toBeFalsy();
  });

  it('P2-R43 — falls back rather than trusting npm\'s own JS entry (npm run/npm exec)', () => {
    const fakeExecPath = fakeFile('npm', 'bin', 'npm-cli.js');
    process.env['npm_execpath'] = fakeExecPath;

    const { command, args, options } = pnpmCommand(['--filter', 'x', 'bundle']);
    expect(command).toBe(['pnpm', '--filter', 'x', 'bundle'].join(' '));
    expect(args).toEqual([]);
    expect(options.shell).toBe(true);
  });

  it('P2-R43 — falls back rather than trusting yarn\'s own JS entry', () => {
    const fakeExecPath = fakeFile('yarn', 'bin', 'yarn.js');
    process.env['npm_execpath'] = fakeExecPath;

    const { command, options } = pnpmCommand(['--version']);
    expect(command).toBe(['pnpm', '--version'].join(' '));
    expect(options.shell).toBe(true);
  });

  it('falls back to a single shell command string (no args array) when npm_execpath is unset', () => {
    delete process.env['npm_execpath'];
    const { command, args, options } = pnpmCommand(['--version']);
    expect(command).toBe('pnpm --version');
    expect(args).toEqual([]);
    expect(options.shell).toBe(true);
  });

  it('quotes a fallback argument containing a space', () => {
    delete process.env['npm_execpath'];
    const { command, args, options } = pnpmCommand(['--filter', 'has space']);
    expect(command).toBe('pnpm --filter "has space"');
    expect(args).toEqual([]);
    expect(options.shell).toBe(true);
  });

  it('falls back when npm_execpath points at a non-JS file (e.g. a .cmd shim)', () => {
    process.env['npm_execpath'] = 'C:\\fake\\pnpm.cmd';
    const { command, args, options } = pnpmCommand(['--version']);
    expect(command).toBe('pnpm --version');
    expect(args).toEqual([]);
    expect(options.shell).toBe(true);
  });

  it('falls back when npm_execpath points at a pnpm-shaped .js file that does not exist', () => {
    process.env['npm_execpath'] = path.join(os.tmpdir(), 'pnpm.js');
    const { command, options } = pnpmCommand(['--version']);
    expect(command).toBe('pnpm --version');
    expect(options.shell).toBe(true);
  });
});
