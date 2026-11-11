// OpenCode 2 helpers with branchy logic: binary resolution per OS, the
// permission-mode rulesets (a safety contract), form ↔ question mapping, the
// compaction config and the version compare.

import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveOpenCodeCommand, nativeOpenCodeForLauncher } from '../resolveOpenCodeBinary.js';
import { sessionRules, toPermissionRequest, rememberRules } from '../permissions.js';
import { answerFromResponse, questionsFromForm, type FormInfo } from '../forms.js';
import { compactionConfig, compactionThreshold } from '../config.js';
import { compareVersions } from '../server.js';
import { parseModelRef } from '../models.js';

function exe(path: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, 0o755);
  return path;
}

describe('resolveOpenCodeCommand', () => {
  // Real paths: macOS's temp dir is a symlink, and the resolver follows links to find the launcher.
  const home = () => realpathSync(mkdtempSync(join(tmpdir(), 'oc-home-')));

  it('prefers the configured path, then OPENCODE_BIN, then OPENCODE_BIN_PATH', async () => {
    const h = home();
    const configured = exe(join(h, 'cfg', 'opencode'));
    const fromEnv = exe(join(h, 'env', 'opencode'));
    const fromLauncherEnv = exe(join(h, 'env2', 'opencode'));
    const base = { homeDir: h, usePath: false, platform: 'darwin' as const };
    expect((await resolveOpenCodeCommand({ ...base, configuredPath: configured, env: { OPENCODE_BIN: fromEnv } }))).toMatchObject({ command: configured, source: 'config' });
    expect((await resolveOpenCodeCommand({ ...base, env: { OPENCODE_BIN: fromEnv, OPENCODE_BIN_PATH: fromLauncherEnv } }))).toMatchObject({ command: fromEnv, source: 'env' });
    expect((await resolveOpenCodeCommand({ ...base, env: { OPENCODE_BIN_PATH: fromLauncherEnv } }))).toMatchObject({ command: fromLauncherEnv, source: 'env' });
  });

  it("falls back to the curl installer's ~/.opencode/bin", async () => {
    const h = home();
    const bin = exe(join(h, '.opencode', 'bin', 'opencode'));
    expect(await resolveOpenCodeCommand({ homeDir: h, usePath: false, platform: 'linux', env: {} })).toMatchObject({ command: bin, source: 'install-dir' });
  });

  it('returns null when nothing is installed', async () => {
    expect(await resolveOpenCodeCommand({ homeDir: home(), usePath: false, platform: 'linux', env: {} })).toBeNull();
  });

  it('turns an npm launcher (symlinked opencode.cjs) into the platform binary', async () => {
    const h = home();
    const pkg = join(h, 'lib', 'node_modules', '@opencode', 'cli');
    const launcher = join(pkg, 'bin', 'opencode.cjs');
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    writeFileSync(launcher, '#!/usr/bin/env node\n');
    const native = exe(join(h, 'lib', 'node_modules', '@opencode', `cli-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode'));
    expect(await nativeOpenCodeForLauncher(launcher)).toBe(native);
    if (process.platform !== 'win32') {
      const link = join(h, 'bin', 'opencode');
      mkdirSync(join(h, 'bin'), { recursive: true });
      symlinkSync(launcher, link);
      chmodSync(launcher, 0o755);
      expect(await resolveOpenCodeCommand({ configuredPath: link, homeDir: h, usePath: false, env: {} })).toMatchObject({ command: native, path: link });
    }
  });

  it("resolves Windows npm's opencode.cmd shim to opencode.exe (a .cmd cannot be spawned without a shell)", async () => {
    const h = home();
    const npm = join(h, 'AppData', 'Roaming', 'npm');
    writeFileSync(exe(join(npm, 'opencode.cmd')), '@echo off\n');
    const pkg = join(npm, 'node_modules', '@opencode', 'cli');
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    writeFileSync(join(pkg, 'bin', 'opencode.cjs'), '');
    const native = exe(join(npm, 'node_modules', '@opencode', 'cli-windows-x64', 'bin', 'opencode.exe'));
    const found = await resolveOpenCodeCommand({ homeDir: h, usePath: false, platform: 'win32', arch: 'x64', env: { APPDATA: join(h, 'AppData', 'Roaming') } });
    expect(found).toMatchObject({ command: native, source: 'install-dir' });
  });
});

describe('sessionRules (the permission-mode contract)', () => {
  const last = (rules: ReturnType<typeof sessionRules>, action: string, resource = '*') =>
    [...rules].reverse().find((r) => r.action === action && r.resource === resource)?.effect;

  it('default asks for everything but reads, and never turns Code Mode on', () => {
    const r = sessionRules({ mode: 'default' });
    expect(r[0]).toEqual({ action: '*', resource: '*', effect: 'ask' });
    expect(last(r, 'read')).toBe('allow');
    expect(last(r, 'read', '*.env')).toBe('ask');
    expect(last(r, 'edit')).toBeUndefined(); // falls to `* * ask`
    expect(r.at(-1)).toEqual({ action: 'execute', resource: '*', effect: 'deny' });
    expect(last(r, 'generatorai_*')).toBe('allow');
  });

  it('acceptEdits allows edits; plan does not', () => {
    expect(last(sessionRules({ mode: 'acceptEdits' }), 'edit')).toBe('allow');
    expect(last(sessionRules({ mode: 'plan' }), 'edit')).toBeUndefined();
  });

  it('dontAsk denies by default and drops remembered allows', () => {
    const r = sessionRules({ mode: 'dontAsk', remembered: [{ action: 'shell', resource: 'rm *', effect: 'allow' }] });
    expect(r[0]!.effect).toBe('deny');
    expect(r.some((x) => x.action === 'shell')).toBe(false);
  });

  it('bypass allows all; extra roots and skill lists become rules', () => {
    expect(sessionRules({ mode: 'bypassPermissions' })[0]).toEqual({ action: '*', resource: '*', effect: 'allow' });
    const r = sessionRules({ mode: 'default', additionalDirectories: ['C:\\work\\b\\'], skills: ['lint'], disabledSkills: ['deploy'] });
    expect(r).toContainEqual({ action: 'external_directory', resource: 'C:/work/b/*', effect: 'allow' });
    expect(last(r, 'skill')).toBe('deny');
    expect(last(r, 'skill', 'lint')).toBe('allow');
    expect(last(r, 'skill', 'deploy')).toBe('deny');
  });

  it('maps asks to request kinds and remembers save patterns', () => {
    expect(toPermissionRequest({ id: 'p', sessionID: 's', action: 'edit', resources: ['src/a.ts'] })).toMatchObject({ type: 'file_write', details: { paths: ['src/a.ts'] } });
    expect(toPermissionRequest({ id: 'p', sessionID: 's', action: 'webfetch', resources: ['https://x'] }).type).toBe('network');
    expect(toPermissionRequest({ id: 'p', sessionID: 's', action: 'mcp_tool', resources: ['*'] }).type).toBe('other');
    expect(rememberRules({ id: 'p', sessionID: 's', action: 'shell', resources: ['git push origin'], save: ['git push *'] })).toEqual([{ action: 'shell', resource: 'git push *', effect: 'allow' }]);
  });
});

describe('forms', () => {
  const form: FormInfo = {
    id: 'f', sessionID: 's', title: 'Questions', metadata: { kind: 'question' },
    fields: [
      { key: 'q0', type: 'string', title: 'Pkg', description: 'Which?', options: [{ value: 'bun', label: 'Bun' }], custom: true },
      { key: 'q1', type: 'multiselect', title: 'Extras', options: [{ value: 'l', label: 'Lint' }, { value: 't', label: 'Test' }] },
    ],
  };

  it('maps fields to questions and answers back to option values', () => {
    expect(questionsFromForm(form)).toMatchObject([
      { id: 'q0', header: 'Pkg', question: 'Which?', multiSelect: false, allowFreeform: true },
      { id: 'q1', multiSelect: true, allowFreeform: false },
    ]);
    expect(answerFromResponse(form, { answers: { q0: ['Bun'], q1: ['Lint', 'Test'] } })).toEqual({ q0: 'bun', q1: ['l', 't'] });
    expect(answerFromResponse(form, { answers: { q0: ['my own'] } })).toEqual({ q0: 'my own' });
    expect(answerFromResponse(form, { answers: {}, freeformResponse: 'x' })).toBeNull();
  });

  it('refuses fields the card cannot render', () => {
    expect(questionsFromForm({ ...form, fields: [{ key: 'n', type: 'number' }] })).toBeNull();
  });
});

describe('small contracts', () => {
  it('compaction config and threshold follow the app setting', () => {
    expect(compactionConfig(undefined)).toBeUndefined();
    expect(compactionConfig({ enabled: false })).toEqual({ auto: false });
    expect(compactionConfig({ enabled: true, thresholdPct: 80 })).toEqual({ auto: true, buffer: '20%' });
    expect(compactionThreshold(200_000, undefined)).toBe(170_000);
    expect(compactionThreshold(64_000, undefined)).toBe(48_000); // the 16K floor
    expect(compactionThreshold(200_000, { enabled: false })).toBeUndefined();
  });

  it('compares versions and parses model refs', () => {
    expect(compareVersions('2.2.7', '2.0.0')).toBe(1);
    expect(compareVersions('1.19.5', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBe(0);
    expect(parseModelRef('openrouter/anthropic/claude')).toEqual({ providerID: 'openrouter', id: 'anthropic/claude' });
    expect(parseModelRef('bare')).toBeNull();
  });
});
