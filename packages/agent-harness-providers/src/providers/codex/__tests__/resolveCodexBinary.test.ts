// ────────────────────────────────────────────────────────────────
// resolveCodexCommand — Codex must be found wherever Codex installs itself.
//
// A signed-in Codex that lived inside the ChatGPT desktop app (not on PATH)
// was reported as "Not installed". Each case below builds a real directory
// layout and asserts what would be spawned.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs';
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
    // The launcher's native binary, run directly — no Node (or Electron-as-Node) hop.
    expect(r).toMatchObject({ argsPrefix: [], source: 'bundled' });
    expect(r?.command).toMatch(/codex(\.exe)?$/);
    expect(r?.command).not.toBe(process.execPath);
    expect(r?.env['CODEX_MANAGED_PACKAGE_ROOT']).toBe(path.dirname(path.dirname(bundled)));
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

  it('runs a launcher script as the native binary next to it (the platform package the launcher would exec)', async () => {
    const triple = ({ 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl', 'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc' } as Record<string, string>)[`${process.platform}-${process.arch}`];
    if (!triple) return;
    const pkg = path.join(dir, 'node_modules', '@openai', 'codex');
    const script = makeExecutable(path.join(pkg, 'bin', 'codex.js'));
    writeFileSync(path.join(pkg, 'package.json'), '{"name":"@openai/codex"}');
    const platformPkg = path.join(dir, 'node_modules', '@openai', `codex-${process.platform}-${process.arch}`);
    mkdirSync(platformPkg, { recursive: true });
    writeFileSync(path.join(platformPkg, 'package.json'), `{"name":"@openai/codex-${process.platform}-${process.arch}"}`);
    const binary = makeExecutable(path.join(platformPkg, 'vendor', triple, 'bin', exe));
    const r = await resolveCodexCommand({ useBundled: false, configuredPath: script, env: { PATH: '' }, homeDir: dir });
    // Module resolution reports the real path (macOS: /var → /private/var).
    expect(r).toMatchObject({ command: realpathSync(binary), argsPrefix: [], path: realpathSync(binary), source: 'config' });
  });

  it('runs a JS entry point through the current Node runtime when no native binary sits next to it', async () => {
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

  it('finds the CLI bundled with the ChatGPT desktop app on macOS (current codex-cli/ layout and the older one)', async () => {
    const real = [
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
      '/Applications/ChatGPT.app/Contents/Resources/codex',
    ];
    for (const rel of [['codex-cli', 'bin', 'codex'], ['codex']]) {
      const home = mkdtempSync(path.join(tmpdir(), 'codex-app-'));
      const bundled = makeExecutable(path.join(home, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', ...rel));
      const r = await resolveCodexCommand({ useBundled: false, env: { PATH: '' }, platform: 'darwin', homeDir: home });
      // `/Applications` is checked first; this machine may genuinely have one.
      expect(r?.source).toBe('app-bundle');
      expect([bundled, ...real]).toContain(r?.path);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('returns null when Codex is nowhere to be found', async () => {
    const r = await resolveCodexCommand({ useBundled: false, env: { PATH: '' }, platform: 'linux', homeDir: dir });
    expect(r).toBeNull();
  });
});
