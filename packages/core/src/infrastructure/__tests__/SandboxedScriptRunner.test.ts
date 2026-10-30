import { describe, expect, it } from 'vitest';
import * as os from 'node:os';
import { SandboxedScriptRunner } from '../SandboxedScriptRunner.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;

describe('SandboxedScriptRunner pwsh confinement', () => {
  const runner = new SandboxedScriptRunner(logger);
  const dir = os.tmpdir();
  const run = (args: string[], confined: boolean) =>
    runner.run('pwsh', args, { cwd: dir, timeout: 30_000, ...(confined ? { confineTo: dir } : {}) });

  it('refuses a prefix of -Command, -Command after a value-taking switch, and -enc anywhere', async () => {
    await expect(run(['-NoProfile', '-Comm', 'Write-Output x'], true)).rejects.toThrow(/inline code/);
    await expect(run(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'Write-Output x'], true)).rejects.toThrow(/inline code/);
    await expect(run(['-NoProfile', '-enc', 'VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAB4AA=='], false)).rejects.toThrow(/encoded command/);
    await expect(run(['/EN', 'VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAB4AA=='], false)).rejects.toThrow(/encoded command/);
    await expect(run(['-WorkingDirectory', '..', '-File', 'x.ps1'], true)).rejects.toThrow(/not permitted in a check/);
  });
});

describe('SandboxedScriptRunner commands allowed in the app (D-174)', () => {
  it('adds bare names on top of the defaults and config extras, and replaces them as a set', async () => {
    const runner = new SandboxedScriptRunner(logger, { extraAllowlist: ['make'] });
    runner.setAllowedCommands(['Cargo', 'node', '../evil', 'make']);
    expect(runner.getAppAllowed()).toEqual(['cargo']);
    expect(runner.getAllowlist()).toEqual(expect.arrayContaining(['cargo', 'make', 'node']));
    expect(runner.getAllowlist()).not.toContain('../evil');
    runner.setAllowedCommands([]);
    expect(runner.getAppAllowed()).toEqual([]);
    expect(runner.getAllowlist()).not.toContain('cargo');
    expect(runner.getAllowlist()).toContain('make');
    await expect(runner.run('cargo', ['build'], { cwd: os.tmpdir() })).rejects.toThrow(/not in the allowlist/);
  });
});
