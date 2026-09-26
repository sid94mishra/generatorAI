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
