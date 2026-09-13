// ────────────────────────────────────────────────────────────────
// resolveCodexCommand — Codex must be found wherever Codex installs itself.
//
// A signed-in Codex that lived inside the ChatGPT desktop app (not on PATH)
// was reported as "Not installed". Each case below builds a real directory
// layout and asserts what would be spawned.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveCodexCommand, CODEX_CLI_PATH_ENV } from '../resolveCodexBinary.js';

let dir: string;
const exe = process.platform === 'win32' ? 'codex.exe' : 'codex';

function makeExecutable(file: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '#!/bin/sh\n');
  chmodSync(file, 0o755);
  return file;
}

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'codex-resolve-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('resolveCodexCommand', () => {
  it('prefers the pinned @openai/codex package over PATH and the app bundle, but not over an explicit path', async () => {
    const { bundledCodexScript } = await import('../resolveCodexBinary.js');
    const bundled = await bundledCodexScript();
    if (!bundled) return; // optional dependency absent on this machine (e.g. an unsupported platform)
    const onPath = makeExecutable(path.join(dir, 'bin', exe));
    const r = await resolveCodexCommand({ env: { PATH: path.join(dir, 'bin'), PATHEXT: '.EXE' }, homeDir: dir });
    expect(r).toMatchObject({ command: process.execPath, argsPrefix: [bundled], source: 'bundled' });
    expect(r?.path).not.toBe(onPath);
    const explicit = makeExecutable(path.join(dir, 'custom', exe));
    const e = await resolveCodexCommand({ configuredPath: explicit, env: { PATH: '' }, homeDir: dir });
    expect(e).toMatchObject({ command: explicit, source: 'config' });
  });

  it('prefers the configured path over everything else', async () => {
    const configured = makeExecutable(path.join(dir, 'custom', exe));
    makeExecutable(path.join(dir, 'bin', exe));
    const r = await resolveCodexCommand({ useBundled: false, configuredPath: configured, env: { PATH: path.join(dir, 'bin') }, homeDir: dir });
    expect(r).toMatchObject({ command: configured, argsPrefix: [], source: 'config' });
  });

  it('honours CODEX_CLI_PATH, the variable the Codex desktop app reads', async () => {
    const fromEnv = makeExecutable(path.join(dir, 'env', exe));
    const r = await resolveCodexCommand({ useBundled: false, env: { [CODEX_CLI_PATH_ENV]: fromEnv, PATH: '' }, homeDir: dir });
    expect(r).toMatchObject({ command: fromEnv, source: 'env' });
  });

  it('finds codex on PATH', async () => {
    const onPath = makeExecutable(path.join(dir, 'bin', exe));
    const r = await resolveCodexCommand({ useBundled: false, env: { PATH: path.join(dir, 'bin'), PATHEXT: '.EXE;.CMD' }, homeDir: dir });
    expect(r).toMatchObject({ command: onPath, source: 'path' });
  });

  it('ignores a configured path that does not exist and keeps looking', async () => {
    const onPath = makeExecutable(path.join(dir, 'bin', exe));
    const r = await resolveCodexCommand({ useBundled: false, configuredPath: path.join(dir, 'missing'), env: { PATH: path.join(dir, 'bin'), PATHEXT: '.EXE' }, homeDir: dir });
    expect(r?.command).toBe(onPath);
  });

  it('runs a JS entry point through the current Node runtime', async () => {
    const script = makeExecutable(path.join(dir, 'pkg', 'bin', 'codex.js'));
    const r = await resolveCodexCommand({ useBundled: false, configuredPath: script, env: { PATH: '' }, homeDir: dir });
    expect(r).toMatchObject({ command: process.execPath, argsPrefix: [script], path: script });
  });

  it('resolves a Windows npm shim to the codex.js it launches, instead of spawning the .cmd', async () => {
    const shim = makeExecutable(path.join(dir, 'npm', 'codex.cmd'));
    const script = makeExecutable(path.join(dir, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
    const r = await resolveCodexCommand({ useBundled: false, configuredPath: shim, env: { PATH: '' }, platform: 'win32', homeDir: dir });
    expect(r).toMatchObject({ command: process.execPath, argsPrefix: [script], source: 'config' });
  });

  it('skips a shim whose script is missing rather than returning something that cannot spawn', async () => {
    const shim = makeExecutable(path.join(dir, 'npm', 'codex.cmd'));
    const r = await resolveCodexCommand({ useBundled: false, configuredPath: shim, env: { PATH: '' }, platform: 'win32', homeDir: dir });
    expect(r).toBeNull();
  });

  it('finds the CLI bundled with the ChatGPT desktop app on macOS', async () => {
    const bundled = makeExecutable(path.join(dir, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex'));
    const r = await resolveCodexCommand({ useBundled: false, env: { PATH: '' }, platform: 'darwin', homeDir: dir });
    // `/Applications` is checked first; this machine may genuinely have one.
    expect(r?.source).toBe('app-bundle');
    expect([bundled, '/Applications/ChatGPT.app/Contents/Resources/codex']).toContain(r?.path);
  });

  it('returns null when Codex is nowhere to be found', async () => {
    const r = await resolveCodexCommand({ useBundled: false, env: { PATH: '' }, platform: 'linux', homeDir: dir });
    expect(r).toBeNull();
  });
});
