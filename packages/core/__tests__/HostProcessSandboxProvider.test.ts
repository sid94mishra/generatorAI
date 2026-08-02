// ────────────────────────────────────────────────────────────────
// HostProcessSandboxProvider tests (TEST-2)
//
// Covers the host-fallback sandbox's command execution, the cwd
// traversal guard, the safe-env allowlist, and lifecycle — previously
// the sandbox/script-runner infrastructure had no tests.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostProcessSandboxProvider } from '../src/infrastructure/HostProcessSandboxProvider.js';
import type { ILogger } from '@generatorai/shared';

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
} as unknown as ILogger;

// Cross-platform command: run the current Node binary with -e.
function nodeCmd(script: string): string[] {
  return [process.execPath, '-e', script];
}

describe('HostProcessSandboxProvider (TEST-2)', () => {
  let provider: HostProcessSandboxProvider;
  let workDir: string;
  const NAME = 'test-sbx';

  beforeEach(async () => {
    provider = new HostProcessSandboxProvider(noopLogger);
    workDir = await mkdtemp(join(tmpdir(), 'genai-sbx-'));
    await provider.create({
      name: NAME,
      image: 'host',
      mounts: [{ source: workDir, target: workDir }],
    } as never);
  });

  afterEach(async () => {
    await provider.remove(NAME);
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  });

  it('executes a command and returns exitCode 0 + stdout', async () => {
    const res = await provider.exec(NAME, nodeCmd("process.stdout.write('hello-sbx')"));
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('hello-sbx');
  });

  it('returns a non-zero exit code when the command fails', async () => {
    const res = await provider.exec(NAME, nodeCmd('process.exit(3)'));
    expect(res.exitCode).toBe(3);
  });

  it('errors for a non-existent sandbox', async () => {
    const res = await provider.exec('no-such-sandbox', nodeCmd('1'));
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('does not exist');
  });

  it('rejects an empty command', async () => {
    const res = await provider.exec(NAME, []);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('No command');
  });

  it('blocks a cwd that escapes the sandbox workspace (traversal guard)', async () => {
    const res = await provider.exec(NAME, nodeCmd('1'), { cwd: '../../etc' } as never);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/outside sandbox workspace/i);
  });

  it('only forwards allowlisted host env vars (drops secrets)', async () => {
    process.env['GENAI_TEST_SECRET_XYZ'] = 'super-secret';
    try {
      const res = await provider.exec(
        NAME,
        nodeCmd("process.stdout.write(JSON.stringify({secret: process.env.GENAI_TEST_SECRET_XYZ ?? null, path: !!process.env.PATH}))"),
      );
      const parsed = JSON.parse(res.stdout) as { secret: string | null; path: boolean };
      expect(parsed.secret).toBeNull(); // not allowlisted → dropped
      expect(parsed.path).toBe(true);   // PATH is allowlisted → forwarded
    } finally {
      delete process.env['GENAI_TEST_SECRET_XYZ'];
    }
  });

  it('forwards explicit exec env on top of the allowlist', async () => {
    const res = await provider.exec(
      NAME,
      nodeCmd("process.stdout.write(process.env.MY_EXEC_VAR ?? 'none')"),
      { env: { MY_EXEC_VAR: 'injected' } } as never,
    );
    expect(res.stdout).toContain('injected');
  });

  it('reports availability and inspect status', async () => {
    expect(await provider.isAvailable()).toBe(true);
    const info = await provider.inspect(NAME);
    expect(info.status).toBe('running');
  });
});
