import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copilotPlatformPackage, downloadedCopilotCliPath, fileIntegrity, installCopilotCli } from '../copilotCli.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'copilot-cli-'));
  dirs.push(d);
  return d;
}

/** An npm-style tarball: `package/package.json` whose `exports["."]` names the CLI entry. */
function tarball(): string {
  const src = tmp();
  mkdirSync(path.join(src, 'package'));
  writeFileSync(path.join(src, 'package', 'package.json'), JSON.stringify({ name: copilotPlatformPackage(), exports: { '.': './copilot' } }));
  writeFileSync(path.join(src, 'package', 'copilot'), '#!/bin/sh\necho fake\n', { mode: 0o755 });
  const out = path.join(src, 'cli.tgz');
  execFileSync('tar', ['-czf', out, '-C', src, 'package']);
  return out;
}

function registry(file: string, integrity: string): typeof fetch {
  return (async (url: string) => {
    if (url.endsWith('.tgz')) {
      const body = readFileSync(file);
      return new Response(body, { headers: { 'content-length': String(body.length) } });
    }
    return Response.json({ dist: { tarball: 'https://registry.test/cli.tgz', integrity } });
  }) as unknown as typeof fetch;
}

describe('the Copilot CLI downloaded on first use', () => {
  it('downloads, verifies the sha512 integrity, unpacks and returns the runnable entry; a second call reuses it', async () => {
    const file = tarball();
    const dir = tmp();
    const seen: number[] = [];
    const entry = await installCopilotCli({ dir, version: '1.2.3', fetchImpl: registry(file, await fileIntegrity(file)), onProgress: (p) => seen.push(p.receivedBytes) });
    expect(entry).toBe(path.join(dir, '1.2.3', 'package', 'copilot'));
    expect(downloadedCopilotCliPath(dir, '1.2.3')).toBe(entry);
    expect(seen.at(-1)).toBeGreaterThan(0);
    const never = (async () => {
      throw new Error('fetched again');
    }) as unknown as typeof fetch;
    await expect(installCopilotCli({ dir, version: '1.2.3', fetchImpl: never })).resolves.toBe(entry);
  });

  it('refuses a tarball that does not match the registry checksum and leaves nothing behind', async () => {
    const file = tarball();
    const dir = tmp();
    const wrong = `sha512-${Buffer.alloc(64).toString('base64')}`;
    await expect(installCopilotCli({ dir, version: '1.2.3', fetchImpl: registry(file, wrong) })).rejects.toThrow(/checksum/);
    expect(downloadedCopilotCliPath(dir, '1.2.3')).toBeUndefined();
  });

  it('refuses a registry entry without a sha512 integrity', async () => {
    const file = tarball();
    await expect(installCopilotCli({ dir: tmp(), version: '1.2.3', fetchImpl: registry(file, 'sha1-abc') })).rejects.toThrow(/sha512/);
  });
});
